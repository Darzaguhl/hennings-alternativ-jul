// Lets a volunteer who registered passwordless on the website (the normal
// path -- see signup.js) set a password afterward, so they can log in to
// the mobile app. Reached via a link emailed at registration time (see
// backend PasswordSetupToken / send_password_setup_email).
const API_BASE_URL = window.API_BASE_URL;

const introEl = document.getElementById("set-password-intro");
const errorEl = document.getElementById("set-password-error");
const formEl = document.getElementById("set-password-form");
const submitButton = document.getElementById("set-password-submit");
const statusEl = document.getElementById("set-password-status");
const passwordEl = document.getElementById("password");
const passwordConfirmEl = document.getElementById("password-confirm");

const token = new URLSearchParams(window.location.search).get("token");

const showError = (message) => {
  introEl.hidden = true;
  errorEl.textContent = message;
  errorEl.hidden = false;
};

const loadPreview = async () => {
  if (!token) {
    showError("Denne lenken mangler informasjon. Sjekk at du brukte hele lenken fra e-posten.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/password-setup/${encodeURIComponent(token)}/`);
    if (response.status === 404) {
      showError("Fant ikke denne lenken. Den kan ha blitt brukt allerede, eller vært feil kopiert.");
      return;
    }
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = await response.json();

    if (!data.is_usable) {
      showError("Denne lenken er ikke lenger gyldig — den kan være brukt eller utløpt.");
      return;
    }

    introEl.textContent = `Sett et passord for ${data.email} — så kan du logge inn i appen.`;
    formEl.hidden = false;
  } catch (err) {
    console.error("Error loading password setup link", err);
    showError("Kunne ikke laste denne siden akkurat nå. Prøv å laste siden på nytt.");
  }
};

loadPreview();

formEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";

  const password = passwordEl.value;
  if (password !== passwordConfirmEl.value) {
    statusEl.textContent = "Passordene er ikke like.";
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Setter passord …";

  try {
    const response = await fetch(`${API_BASE_URL}/api/password-setup/confirm/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail = body?.password?.[0] || body?.token?.[0] || body?.detail;
      throw new Error(detail || "Kunne ikke sette passord.");
    }

    formEl.hidden = true;
    introEl.hidden = false;
    introEl.textContent = "Passordet er satt! Du kan nå logge inn i appen med denne e-posten og passordet du nettopp valgte.";
  } catch (err) {
    console.error("Error setting password", err);
    statusEl.textContent = err.message || "Noe gikk galt. Prøv igjen.";
    submitButton.disabled = false;
    submitButton.textContent = "Sett passord";
  }
});
