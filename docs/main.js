// PortPilot Landing Page - Interactive Features

(function () {
  'use strict';

  document.documentElement.classList.add('js');

  // --- Mobile Navigation ---
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.getElementById('nav-menu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function () {
      const isOpen = navMenu.classList.toggle('open');
      navToggle.classList.toggle('open', isOpen);
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });

    // Close menu when a link is clicked
    navMenu.querySelectorAll('.nav-link').forEach(function (link) {
      link.addEventListener('click', function () {
        navMenu.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // --- Smooth Scroll ---
  document.querySelectorAll("a[href^='#']").forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var href = this.getAttribute('href');
      if (href === '#') return;
      var target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // --- Active Nav Link on Scroll ---
  var sections = document.querySelectorAll('section[id]');
  var navLinks = document.querySelectorAll('.nav-link');

  function updateActiveNavLink() {
    var scrollPos = window.pageYOffset + 120;
    var current = '';

    sections.forEach(function (section) {
      if (scrollPos >= section.offsetTop) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('href') === '#' + current);
    });
  }

  window.addEventListener('scroll', updateActiveNavLink, { passive: true });
  updateActiveNavLink();

  // --- Screenshot Lightbox (click any zoomable shot to enlarge) ---
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = document.getElementById('lightbox-img');
  var lightboxClose = lightbox ? lightbox.querySelector('.lightbox-close') : null;
  var lastFocus = null;

  function openLightbox(img) {
    if (!lightbox) return;
    lastFocus = img;
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt || '';
    lightbox.hidden = false;
    document.body.classList.add('lightbox-open');
    if (lightboxClose) lightboxClose.focus();
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lightboxImg.src = '';
    document.body.classList.remove('lightbox-open');
    if (lastFocus) lastFocus.focus();
  }

  document.querySelectorAll('img.zoomable').forEach(function (img) {
    img.setAttribute('role', 'button');
    img.setAttribute('title', 'Click to enlarge');
    img.addEventListener('click', function () { openLightbox(img); });
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(img); }
    });
  });

  if (lightbox) {
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox || e.target === lightboxClose || e.target === lightboxImg) closeLightbox();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLightbox();
    });
  }

  // Logo click - scroll to top
  var brand = document.querySelector('.nav-brand');
  if (brand) {
    brand.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // --- Scroll-triggered Animations ---
  var animateElements = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    animateElements.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    animateElements.forEach(function (el) {
      el.classList.add('animate-in');
    });
  }
})();
