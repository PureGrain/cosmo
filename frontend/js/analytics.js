// Visitor analytics — behavioral tracking with server-side enrichment
// Sends session_start (arrival) and session_end (summary) to CF Pages Function
// All IP/geo enrichment happens server-side via Cloudflare headers
(function() {
  'use strict';

  var TRACK_URL = '/api/track';
  var SESSION_KEY = '_cosmo_sid';
  var JOURNEY_KEY = '_cosmo_journey';
  var NAV_KEY = '_cosmo_nav';
  var CHAT_KEY = '_cosmo_chat';
  var START_KEY = '_cosmo_started';
  var REF_KEY = '_cosmo_ref';

  // Respect Do Not Track
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;

  // Owner opt-out: set localStorage._cosmo_notrack = '1' in console to disable
  try { if (localStorage.getItem('_cosmo_notrack')) return; } catch(e) {}

  // --- Storage helpers (safe for private browsing) ---
  var store = {
    get: function(k) { try { return sessionStorage.getItem(k); } catch(e) { return null; } },
    set: function(k, v) { try { sessionStorage.setItem(k, v); } catch(e) {} },
    json: function(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch(e) { return null; } },
    save: function(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch(e) {} },
  };

  // --- Session ID ---
  var sessionId = store.get(SESSION_KEY);
  var isNewSession = !sessionId;
  if (isNewSession) {
    sessionId = (crypto.randomUUID ? crypto.randomUUID() : genId());
    store.set(SESSION_KEY, sessionId);
  }

  function genId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // Clear internal navigation flag from previous page
  store.set(NAV_KEY, '');

  // --- Device data (collected once per session) ---
  var deviceData = {
    screen: { width: screen.width, height: screen.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    language: navigator.language || 'unknown',
    timezone: (function() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e) { return 'unknown'; } })(),
    darkMode: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches,
  };

  // --- Page tracking state ---
  var currentPage = window.location.pathname;
  var pageStart = Date.now();
  var maxScroll = 0;
  var clicks = [];

  var journey = store.json(JOURNEY_KEY) || [];
  var lastEntry = journey.length > 0 ? journey[journey.length - 1] : null;
  if (lastEntry && lastEntry.page === currentPage) {
    lastEntry.enteredAt = pageStart;
    lastEntry.duration = 0;
    lastEntry.scrollDepth = 0;
    lastEntry.clicks = [];
  } else {
    journey.push({
      page: currentPage,
      enteredAt: pageStart,
      duration: 0,
      scrollDepth: 0,
      clicks: [],
    });
  }
  store.save(JOURNEY_KEY, journey);

  // --- Send event to server ---
  function track(event, data) {
    var payload = JSON.stringify(merge({
      event: event,
      sessionId: sessionId,
      timestamp: Date.now(),
    }, deviceData, data));

    if (event === 'session_end') {
      var blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(TRACK_URL, blob);
      } else {
        try { fetch(TRACK_URL, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true }); } catch(e) {}
      }
    } else {
      fetch(TRACK_URL, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json' },
      }).catch(function() {});
    }
  }

  function merge() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var obj = arguments[i];
      if (obj) { for (var k in obj) { if (obj.hasOwnProperty(k)) out[k] = obj[k]; } }
    }
    return out;
  }

  // --- Fire session_start on first visit ---
  if (isNewSession && !store.get(START_KEY)) {
    store.set(START_KEY, '1');
    store.set(REF_KEY, document.referrer || '');
    track('session_start', {
      page: currentPage,
      referrer: document.referrer || null,
    });
  }

  // --- Scroll depth tracking ---
  function updateScroll() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    var docHeight = Math.max(
      document.body.scrollHeight || 0,
      document.documentElement.scrollHeight || 0
    );
    var winHeight = window.innerHeight;
    var scrollable = docHeight - winHeight;
    if (scrollable > 0) {
      var pct = Math.round((scrollTop / scrollable) * 100);
      if (pct > maxScroll) maxScroll = Math.min(pct, 100);
    } else {
      maxScroll = 100;
    }
  }
  window.addEventListener('scroll', updateScroll, { passive: true });
  setTimeout(updateScroll, 500);

  // --- Click tracking ---
  document.addEventListener('click', function(e) {
    var target = e.target.closest('a, button, [data-track], [data-open-chat]');
    if (!target) return;

    var label = '';
    if (target.dataset.track) {
      label = target.dataset.track;
    } else if (target.dataset.openChat !== undefined) {
      label = target.dataset.chatMsg || 'Open chat';
    } else if (target.tagName === 'A') {
      label = (target.textContent || '').trim().slice(0, 50);
      if (target.hostname && target.hostname !== window.location.hostname) {
        label = '[ext] ' + label;
      }
    } else if (target.tagName === 'BUTTON') {
      label = (target.textContent || '').trim().slice(0, 50) || target.getAttribute('aria-label') || 'button';
    }

    if (label && clicks.length < 30) {
      clicks.push(label);
    }

    if (target.tagName === 'A' && target.hostname === window.location.hostname && !target.hash) {
      store.set(NAV_KEY, 'true');
    }
  }, true);

  // --- Chat widget tracking ---
  var chatData = store.json(CHAT_KEY) || { opened: false, messagesSent: 0 };

  var chatObserverStarted = false;
  function startChatObserver() {
    if (chatObserverStarted) return;
    chatObserverStarted = true;

    var observer = new MutationObserver(function() {
      var panel = document.querySelector('.chat-panel');
      if (panel && panel.classList.contains('open') && !chatData.opened) {
        chatData.opened = true;
        store.save(CHAT_KEY, chatData);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startChatObserver);
  } else {
    startChatObserver();
  }

  document.addEventListener('click', function(e) {
    if (e.target.closest('#chatSend, .chat-suggestion')) {
      chatData.messagesSent++;
      store.save(CHAT_KEY, chatData);
    }
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chatInput') {
      chatData.messagesSent++;
      store.save(CHAT_KEY, chatData);
    }
  }, true);

  // --- Page data save ---
  function savePageData() {
    var duration = Math.round((Date.now() - pageStart) / 1000);
    var journey = store.json(JOURNEY_KEY) || [];
    var lastIdx = journey.length - 1;
    if (lastIdx >= 0) {
      journey[lastIdx].duration = duration;
      journey[lastIdx].scrollDepth = maxScroll;
      journey[lastIdx].clicks = clicks;
      store.save(JOURNEY_KEY, journey);
    }
    return journey;
  }

  // --- Page exit handling ---
  var sessionEndSent = false;

  function sendSessionEnd() {
    if (sessionEndSent) return;
    sessionEndSent = true;

    var journey = savePageData();
    var isNavigating = store.get(NAV_KEY) === 'true';
    if (!isNavigating) {
      track('session_end', {
        journey: journey,
        chat: store.json(CHAT_KEY) || { opened: false, messagesSent: 0 },
        totalDuration: journey.reduce(function(sum, p) { return sum + (p.duration || 0); }, 0),
        referrer: store.get(REF_KEY) || null,
      });
    }
  }

  window.addEventListener('beforeunload', sendSessionEnd);

  window.addEventListener('pagehide', function(e) {
    if (!e.persisted) {
      sendSessionEnd();
    } else {
      savePageData();
    }
  });

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      savePageData();
    }
  });
})();
