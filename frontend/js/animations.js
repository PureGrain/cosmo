// Scroll reveal + hero parallax — respects prefers-reduced-motion
(function() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function init() {
    // Scroll reveal via IntersectionObserver
    var reveals = document.querySelectorAll('.reveal');
    if (reveals.length) {
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
      reveals.forEach(function(el) { observer.observe(el); });
    }

    // Hero parallax for gradient mesh blobs
    var meshBlobs = document.querySelectorAll('.hero-mesh-blob');
    if (meshBlobs.length) {
      var ticking = false;
      window.addEventListener('scroll', function() {
        if (!ticking) {
          requestAnimationFrame(function() {
            var y = window.pageYOffset * 0.3;
            meshBlobs.forEach(function(blob) {
              blob.style.transform = 'translateY(' + y + 'px)';
            });
            ticking = false;
          });
          ticking = true;
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
