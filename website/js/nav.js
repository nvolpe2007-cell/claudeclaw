const header   = document.getElementById('site-header');
const hamburger = document.getElementById('nav-hamburger');
const drawer    = document.getElementById('nav-drawer');
const overlay   = document.getElementById('nav-overlay');

// Solid nav on scroll
window.addEventListener('scroll', () => {
  header.classList.toggle('nav--solid', window.scrollY > 80);
}, { passive: true });

function openMenu() {
  hamburger.setAttribute('aria-expanded', 'true');
  drawer.setAttribute('aria-hidden', 'false');
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeMenu() {
  hamburger.setAttribute('aria-expanded', 'false');
  drawer.setAttribute('aria-hidden', 'true');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

hamburger.addEventListener('click', () => {
  hamburger.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu();
});

overlay.addEventListener('click', closeMenu);

drawer.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', closeMenu);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenu();
});
