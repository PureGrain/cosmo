// Navigation component — injected on every page
(function() {
  var C = window.COSMO || {};
  var social = C.social || {};
  var currentPath = window.location.pathname;

  var navItems = [
    { label: 'Projects', href: '/projects.html' },
  ];
  if (C.services) navItems.push({ label: 'Services', href: '/services.html' });
  if (C.products) navItems.push({ label: 'Products', href: '/products.html' });
  navItems.push({ label: 'About', href: '/about.html' });
  navItems.push({ label: 'How It Works', href: '/colophon.html' });

  var navLinks = navItems.map(function(item) {
    var active = currentPath === item.href ? ' class="nav-active"' : '';
    return '<a href="' + item.href + '"' + active + '>' + item.label + '</a>';
  }).join('');

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  // Build external links from config
  var externalLinks = '';
  if (social.github) externalLinks += '<a href="' + social.github + '" target="_blank" rel="noopener">GitHub</a>';
  if (social.linkedin) externalLinks += '<a href="' + social.linkedin + '" target="_blank" rel="noopener">LinkedIn</a>';
  if (social.twitter) externalLinks += '<a href="' + social.twitter + '" target="_blank" rel="noopener">Twitter</a>';

  var mobileExternal = '';
  if (social.github) mobileExternal += '<a href="' + social.github + '" target="_blank" rel="noopener">GitHub</a>';
  if (social.linkedin) mobileExternal += '<a href="' + social.linkedin + '" target="_blank" rel="noopener">LinkedIn</a>';
  if (social.twitter) mobileExternal += '<a href="' + social.twitter + '" target="_blank" rel="noopener">Twitter</a>';

  var nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.innerHTML =
    '<div class="nav-inner">' +
      '<a href="/" class="nav-logo">' +
        '<span class="nav-logo-icon">' + (C.logoInitials || 'CO') + '</span>' +
        '<span class="nav-logo-text">' + (C.logoText || 'cosmo') + '</span>' +
      '</a>' +
      '<div class="nav-links">' + navLinks + '</div>' +
      '<div class="nav-external">' +
        externalLinks +
        '<button class="theme-toggle" id="themeToggle" aria-label="Toggle theme">' +
          getThemeIcon(isDark) +
        '</button>' +
        '<button class="nav-hamburger" id="navHamburger" aria-label="Open menu">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<div class="nav-mobile-menu" id="navMobileMenu">' +
      '<div class="nav-mobile-links">' + navLinks + '</div>' +
      '<div class="nav-mobile-external">' + mobileExternal + '</div>' +
    '</div>';

  document.body.prepend(nav);

  // Theme icons
  function getThemeIcon(dark) {
    return dark
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }

  // Theme toggle
  var toggleBtn = document.getElementById('themeToggle');
  toggleBtn.addEventListener('click', function() {
    window.__toggleTheme();
    updateToggleIcon();
  });

  function updateToggleIcon() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    toggleBtn.innerHTML = getThemeIcon(dark);
  }

  // Mobile menu toggle
  var hamburger = document.getElementById('navHamburger');
  var mobileMenu = document.getElementById('navMobileMenu');
  hamburger.addEventListener('click', function() {
    var open = mobileMenu.classList.toggle('open');
    hamburger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    hamburger.classList.toggle('active', open);
  });

  // Close mobile menu on link click
  mobileMenu.querySelectorAll('a').forEach(function(link) {
    link.addEventListener('click', function() {
      mobileMenu.classList.remove('open');
      hamburger.classList.remove('active');
    });
  });

  // Scroll detection for glass nav shadow
  window.addEventListener('scroll', function() {
    if (window.scrollY > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  });

  // Listen for theme changes
  new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.attributeName === 'data-theme') updateToggleIcon();
    });
  }).observe(document.documentElement, { attributes: true });
})();
