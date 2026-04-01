// Chat widget — floating bottom-right bubble that expands to a chat panel
// Loaded on every page, persists conversation across navigation
(function() {
  var C = window.COSMO || {};
  var API_BASE = C.apiUrl || 'http://localhost:3001';
  var TURNSTILE_SITE_KEY = C.turnstileSiteKey || '';
  var MSG_LIMIT = 20;

  var messages = [];
  var isStreaming = false;
  var msgCount = 0;
  var conversationId = null;
  var isOpen = false;
  var turnstileToken = null;
  var turnstileWidgetId = null;
  var handoffOffered = false;

  // Load Turnstile script only if site key is configured
  var tsScript = null;
  if (TURNSTILE_SITE_KEY) {
    tsScript = document.createElement('script');
    tsScript.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    tsScript.defer = true;
    document.head.appendChild(tsScript);
  }

  // ─── DOM ────────────────────────────────────────────────────────────────
  var botName = C.botName || 'Cosmo';
  var welcomeText = C.chatWelcome || 'Hey! Ask me anything about ' + (C.name || 'this person') + '.';
  var suggestions = C.chatSuggestions || [];
  var poweredBy = C.footerPoweredBy || { label: 'Cosmo', url: 'https://github.com/PureGrain/cosmo' };

  var suggestionsHtml = suggestions.map(function(s) {
    return '<button class="chat-suggestion" data-msg="' + s.message.replace(/"/g, '&quot;') + '">' + s.label + '</button>';
  }).join('');

  var widget = document.createElement('div');
  widget.className = 'chat-widget';
  widget.innerHTML = '\
    <button class="chat-bubble chat-bubble-pulse" id="chatBubble" aria-label="Chat with AI">\
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>\
      </svg>\
    </button>\
    <div class="chat-panel" id="chatPanel">\
      <div class="chat-header">\
        <div class="chat-header-info">\
          <div class="chat-header-avatar">AI</div>\
          <div>\
            <div class="chat-header-title">' + botName + '</div>\
            <div class="chat-header-subtitle">Powered by <a href="' + poweredBy.url + '" target="_blank" rel="noopener">' + poweredBy.label + '</a></div>\
          </div>\
        </div>\
        <div class="chat-header-actions">\
          <span class="chat-msg-counter" id="chatMsgCounter"></span>\
          <button class="chat-new-conv" id="chatNewConv" aria-label="Start new conversation" title="Start new conversation">\
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>\
          </button>\
          <button class="chat-close" id="chatClose" aria-label="Close chat">&times;</button>\
        </div>\
      </div>\
      <div class="chat-messages" id="chatMessages">\
        <div class="chat-welcome" id="chatWelcome">\
          <p>' + welcomeText + '</p>\
          <div class="chat-suggestions">' + suggestionsHtml + '</div>\
        </div>\
      </div>\
      <div class="chat-turnstile-row" id="chatTurnstile"></div>\
      <div class="chat-input-area">\
        <textarea id="chatInput" placeholder="Ask me anything..." rows="1"></textarea>\
        <button id="chatSend" aria-label="Send message">\
          <svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>\
        </button>\
      </div>\
    </div>';
  document.body.appendChild(widget);

  var bubble = document.getElementById('chatBubble');
  var panel = document.getElementById('chatPanel');
  var closeBtn = document.getElementById('chatClose');
  var newConvBtn = document.getElementById('chatNewConv');
  var messagesEl = document.getElementById('chatMessages');
  var welcomeEl = document.getElementById('chatWelcome');
  var inputEl = document.getElementById('chatInput');
  var sendBtn = document.getElementById('chatSend');
  var counterEl = document.getElementById('chatMsgCounter');

  // ─── CONVERSATION PERSISTENCE ──────────────────────────────────────────
  function getConversationId() {
    var id = localStorage.getItem('cosmo_conv_id');
    if (!id) {
      id = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('cosmo_conv_id', id);
    }
    return id;
  }

  async function saveConversation() {
    if (!conversationId || messages.length === 0) return;
    try {
      await fetch(API_BASE + '/api/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conversationId, messages: messages }),
      });
    } catch(e) {}
  }

  async function loadConversation(id) {
    try {
      var res = await fetch(API_BASE + '/api/conversation/' + id);
      if (!res.ok) return null;
      return await res.json();
    } catch(e) { return null; }
  }

  async function resumeConversation() {
    var saved = await loadConversation(conversationId);
    if (saved && saved.messages && saved.messages.length > 0) {
      messages = saved.messages;
      welcomeEl.style.display = 'none';
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var bubbleEl = addMessageBubble(msg.role, '');
        if (msg.role === 'user') {
          bubbleEl.innerHTML = '<p>' + msg.content.replace(/</g, '&lt;') + '</p>';
        } else {
          bubbleEl.innerHTML = renderMarkdown(msg.content);
        }
      }
      msgCount = messages.filter(function(m) { return m.role === 'user'; }).length;
      updateCounter();
      scrollToBottom();
      return true;
    }
    return false;
  }

  function startNewConversation() {
    conversationId = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('cosmo_conv_id', conversationId);
    messages = [];
    msgCount = 0;
    updateCounter();
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeEl);
    welcomeEl.style.display = '';
  }

  function updateCounter() {
    if (msgCount > 0) {
      counterEl.textContent = msgCount + '/' + MSG_LIMIT;
      if (msgCount >= MSG_LIMIT - 3) {
        counterEl.classList.add('near-limit');
      } else {
        counterEl.classList.remove('near-limit');
      }
    } else {
      counterEl.textContent = '';
      counterEl.classList.remove('near-limit');
    }
  }

  // ─── MESSAGES ──────────────────────────────────────────────────────────
  function addMessageBubble(role, content) {
    welcomeEl.style.display = 'none';

    var wrapper = document.createElement('div');
    wrapper.className = 'chat-msg chat-msg-' + role;

    var bubbleEl = document.createElement('div');
    bubbleEl.className = 'chat-msg-bubble';
    if (content) {
      bubbleEl.innerHTML = role === 'user'
        ? '<p>' + content.replace(/</g, '&lt;') + '</p>'
        : renderMarkdown(content);
    }

    wrapper.appendChild(bubbleEl);
    messagesEl.appendChild(wrapper);
    scrollToBottom();
    return bubbleEl;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ─── TURNSTILE TOKEN WAIT ────────────────────────────────────────────
  function waitForTurnstile(timeout) {
    if (!TURNSTILE_SITE_KEY) return Promise.resolve(null);
    if (turnstileToken) return Promise.resolve(turnstileToken);
    return new Promise(function(resolve) {
      var start = Date.now();
      var check = setInterval(function() {
        initTurnstile();
        if (turnstileToken) { clearInterval(check); resolve(turnstileToken); }
        else if (Date.now() - start > timeout) { clearInterval(check); resolve(null); }
      }, 200);
    });
  }

  // ─── SEND MESSAGE ─────────────────────────────────────────────────────
  async function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isStreaming) return;

    initTurnstile();

    if (msgCount >= MSG_LIMIT) {
      addMessageBubble('assistant', '').innerHTML =
        '<p class="chat-error">Session limit reached. Please refresh to start a new conversation.</p>';
      return;
    }
    msgCount++;
    updateCounter();

    isStreaming = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';

    messages.push({ role: 'user', content: text });
    addMessageBubble('user', text);

    var responseBubble = addMessageBubble('assistant', '');
    responseBubble.innerHTML = '<div class="chat-typing"><span></span><span></span><span></span></div>';

    try {
      var token = await waitForTurnstile(5000);

      var res = await fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages, turnstileToken: token }),
      });

      if (!res.ok) {
        var err = await res.json();
        throw new Error(err.error || 'Request failed');
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var fullText = '';
      var buffer = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith('data: ')) continue;
          try {
            var data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
              fullText += data.text;
              responseBubble.innerHTML = renderMarkdown(fullText);
              scrollToBottom();
            } else if (data.type === 'error') {
              responseBubble.innerHTML = '<p class="chat-error">' + data.message + '</p>';
            }
          } catch(e) {}
        }
      }

      messages.push({ role: 'assistant', content: fullText });
      saveConversation();

      // Offer email handoff after 5th user message
      if (msgCount >= 5 && !handoffOffered) {
        handoffOffered = true;
        var card = document.createElement('div');
        card.className = 'chat-handoff-card';
        card.innerHTML =
          '<p>Want to continue this over email?</p>' +
          '<div class="chat-handoff-row">' +
            '<input type="email" class="chat-handoff-email" placeholder="your@email.com">' +
            '<button class="chat-handoff-btn">Send Summary</button>' +
          '</div>' +
          '<div class="chat-handoff-status"></div>';
        messagesEl.appendChild(card);
        scrollToBottom();

        var hInput = card.querySelector('.chat-handoff-email');
        var hBtn = card.querySelector('.chat-handoff-btn');
        var hStatus = card.querySelector('.chat-handoff-status');

        hBtn.addEventListener('click', async function() {
          var hEmail = hInput.value.trim();
          if (!hEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hEmail)) {
            hStatus.textContent = 'Please enter a valid email.';
            hStatus.className = 'chat-handoff-status chat-handoff-error';
            return;
          }
          hBtn.disabled = true;
          hBtn.textContent = 'Sending...';
          try {
            var hToken = await waitForTurnstile(5000);
            var hRes = await fetch(API_BASE + '/api/chat-handoff', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: hEmail, messages: messages, turnstileToken: hToken })
            });
            var hData = await hRes.json();
            if (!hRes.ok) throw new Error(hData.error || 'Failed');
            card.innerHTML = '<p class="chat-handoff-success">Conversation summary sent! Check your inbox and reply to continue over email.</p>';
          } catch(err) {
            hStatus.textContent = err.message || 'Something went wrong.';
            hStatus.className = 'chat-handoff-status chat-handoff-error';
            hBtn.disabled = false;
            hBtn.textContent = 'Send Summary';
          }
        });
      }
    } catch (err) {
      responseBubble.innerHTML = '<p class="chat-error">Error: ' + err.message + '</p>';
    }

    isStreaming = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  // ─── EVENT LISTENERS ──────────────────────────────────────────────────
  var turnstileVerified = false;

  function initTurnstile() {
    if (!TURNSTILE_SITE_KEY) return;
    if (turnstileWidgetId !== null || typeof turnstile === 'undefined') return;
    var container = document.getElementById('chatTurnstile');
    if (!container) return;
    turnstileWidgetId = turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: function(token) {
        turnstileToken = token;
        window._cosmoTurnstileToken = token;
        turnstileVerified = true;
        container.style.display = 'none';
      },
      'error-callback': function() { turnstileToken = null; },
      'expired-callback': function() {
        turnstileToken = null;
        var c = document.getElementById('chatTurnstile');
        if (c) c.style.display = '';
        if (turnstileWidgetId !== null) turnstile.reset(turnstileWidgetId);
      },
      appearance: 'interaction-only',
      size: 'compact',
    });
  }

  bubble.addEventListener('click', function() {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    bubble.classList.toggle('hidden', isOpen);
    bubble.classList.remove('chat-bubble-pulse');
    if (isOpen) {
      initTurnstile();
      inputEl.focus();
      scrollToBottom();
    }
  });

  closeBtn.addEventListener('click', function() {
    isOpen = false;
    panel.classList.remove('open');
    bubble.classList.remove('hidden');
  });

  newConvBtn.addEventListener('click', function() {
    startNewConversation();
    inputEl.focus();
  });

  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  inputEl.addEventListener('input', function() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  // Suggestion buttons
  messagesEl.addEventListener('click', function(e) {
    var btn = e.target.closest('.chat-suggestion');
    if (btn) {
      inputEl.value = btn.dataset.msg;
      sendMessage();
    }
  });

  // "Chat with my AI" / "Ask about X" buttons
  document.addEventListener('click', function(e) {
    var trigger = e.target.closest('[data-open-chat]');
    if (trigger) {
      e.preventDefault();
      isOpen = true;
      panel.classList.add('open');
      bubble.classList.add('hidden');
      bubble.classList.remove('chat-bubble-pulse');
      initTurnstile();
      var prefill = trigger.getAttribute('data-chat-msg');
      if (prefill) {
        inputEl.value = prefill;
        sendMessage();
      } else {
        inputEl.focus();
      }
    }
  });

  // ─── INIT ─────────────────────────────────────────────────────────────
  conversationId = getConversationId();
  resumeConversation();

  // Expose Turnstile helpers globally for contact form
  window._cosmoInitTurnstile = initTurnstile;
  window._cosmoWaitForTurnstile = waitForTurnstile;

  // Auto-init Turnstile on page load
  if (tsScript) {
    if (tsScript.complete || tsScript.readyState === 'complete') {
      initTurnstile();
    } else {
      tsScript.addEventListener('load', function() { initTurnstile(); });
    }
  }
})();
