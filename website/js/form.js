const form    = document.getElementById('contact-form');
const submitBtn = document.getElementById('form-submit');
const success = document.getElementById('form-success');

if (!form) throw new Error('Contact form not found');

function getVal(id) { return document.getElementById(id).value.trim(); }
function setError(id, show) {
  const input = document.getElementById(id);
  const err   = document.getElementById('err-' + id.replace('f-', ''));
  input.classList.toggle('error', show);
  err.classList.toggle('visible', show);
}

function validate() {
  let valid = true;

  if (!getVal('f-name')) { setError('f-name', true); valid = false; } else setError('f-name', false);

  const phone = getVal('f-phone');
  const phoneOk = !phone || /[\d\s\-().+]{7,}/.test(phone);
  setError('f-phone', !phoneOk);
  if (!phoneOk) valid = false;

  const email = getVal('f-email');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  setError('f-email', !emailOk);
  if (!emailOk) valid = false;

  if (!getVal('f-type')) { setError('f-type', true); valid = false; } else setError('f-type', false);
  if (!getVal('f-message')) { setError('f-message', true); valid = false; } else setError('f-message', false);

  return valid;
}

form.addEventListener('submit', e => {
  e.preventDefault();
  if (!validate()) {
    // Scroll first error into view
    const firstErr = form.querySelector('.error');
    if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';

  // Simulate async submission (no real endpoint)
  setTimeout(() => {
    form.style.display = 'none';
    success.classList.add('visible');
  }, 1200);
});
