// Theme detection + toggle — runs synchronously in <head> to prevent flash
(function() {
  var saved = localStorage.getItem('cosmo-theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  var theme = saved || (prefersDark.matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);

  // Listen for OS theme changes (only if no manual override)
  prefersDark.addEventListener('change', function(e) {
    if (!localStorage.getItem('cosmo-theme')) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });

  // Global toggle function used by nav button
  window.__toggleTheme = function() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('cosmo-theme', next);
  };
})();
