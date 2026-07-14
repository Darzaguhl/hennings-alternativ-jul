document.getElementById('year').textContent = new Date().getFullYear();
document.getElementById('admin-link').href = window.ADMIN_URL;

const navToggle = document.getElementById('nav-toggle');
const mainNav = document.getElementById('main-nav');

navToggle.addEventListener('click', () => {
  const isOpen = mainNav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

mainNav.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    mainNav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

// Placeholder handler: no email service is connected yet.
// Replace with a real submit (Mailchimp/Substack/etc.) once one is chosen.
const newsletterForm = document.getElementById('newsletter-form');
const newsletterStatus = document.getElementById('newsletter-status');

newsletterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  newsletterStatus.textContent = 'Takk! (Nyhetsbrevet er ikke koblet til en e-posttjeneste ennå.)';
  newsletterForm.reset();
});
