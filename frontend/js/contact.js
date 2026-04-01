// Contact form handler — own Turnstile widget, POST to /api/contact
(function() {
  var C = window.COSMO || {};
  var API_BASE = C.apiUrl || 'http://localhost:3001';
  var TURNSTILE_SITE_KEY = C.turnstileSiteKey || '';

  var form = document.getElementById('contactForm');
  if (!form) return;

  var statusEl = document.getElementById('contactStatus');
  var submitBtn = form.querySelector('button[type="submit"]');
  var token = null;
  var widgetId = null;

  // Render Turnstile widget in the contact form's own container
  function initWidget() {
    if (!TURNSTILE_SITE_KEY) return;
    if (widgetId !== null || typeof turnstile === 'undefined') return;
    var container = document.getElementById('contactTurnstile');
    if (!container) return;
    widgetId = turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: function(t) { token = t; container.style.display = 'none'; },
      'error-callback': function() { token = null; },
      'expired-callback': function() {
        token = null;
        var c = document.getElementById('contactTurnstile');
        if (c) c.style.display = '';
        if (widgetId !== null) turnstile.reset(widgetId);
      },
      appearance: 'interaction-only',
      size: 'compact',
    });
  }

  // Try to init once Turnstile script is loaded (loaded by chat-widget.js)
  function tryInit() {
    if (!TURNSTILE_SITE_KEY) return;
    if (typeof turnstile !== 'undefined') {
      initWidget();
    } else {
      var attempts = 0;
      var poll = setInterval(function() {
        attempts++;
        if (typeof turnstile !== 'undefined') { clearInterval(poll); initWidget(); }
        else if (attempts > 50) clearInterval(poll);
      }, 200);
    }
  }
  tryInit();

  function waitForToken(timeout) {
    if (!TURNSTILE_SITE_KEY) return Promise.resolve(null);
    if (token) return Promise.resolve(token);
    return new Promise(function(resolve) {
      initWidget();
      var start = Date.now();
      var check = setInterval(function() {
        if (token) { clearInterval(check); resolve(token); }
        else if (Date.now() - start > timeout) { clearInterval(check); resolve(null); }
      }, 200);
    });
  }

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (submitBtn.disabled) return;

    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var message = form.message.value.trim();

    if (!name || !email || !message) {
      statusEl.textContent = 'Please fill in all fields.';
      statusEl.className = 'contact-status contact-error';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    statusEl.textContent = '';
    statusEl.className = 'contact-status';

    try {
      var t = await waitForToken(8000);

      var res = await fetch(API_BASE + '/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          email: email,
          message: message,
          turnstileToken: t
        })
      });

      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      statusEl.textContent = 'Message sent! Check your inbox for a reply from the AI.';
      statusEl.className = 'contact-status contact-success';
      form.reset();
    } catch (err) {
      statusEl.textContent = err.message || 'Something went wrong. Please try again.';
      statusEl.className = 'contact-status contact-error';
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Message';
  });
})();
