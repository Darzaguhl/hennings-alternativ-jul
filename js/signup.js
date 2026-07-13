// Volunteer signup form (#frivillig): fetches the current event's oppgaver
// from the public API, lets a visitor pick one or more, register with
// email+password, and sign up for each chosen oppgave in one go.
//
// API base URL comes from js/config.js (window.API_BASE_URL), which Render
// generates per-environment at deploy time — see the Build Command in the
// Render static site settings. Falls back to config.js's committed default
// (preprod) for local dev.
const API_BASE_URL = window.API_BASE_URL;

const loadingEl = document.getElementById("signup-loading");
const errorEl = document.getElementById("signup-error");
const formEl = document.getElementById("signup-form");
const oppgaverEl = document.getElementById("signup-oppgaver");
const submitButton = document.getElementById("signup-submit");
const statusEl = document.getElementById("signup-status");

const formatTimeRange = (shift) => `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`;
const formatDate = (isoDate) => {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("no-NO", { day: "numeric", month: "long" });
};

const renderOppgaver = (shifts) => {
  if (!shifts.length) {
    oppgaverEl.innerHTML = '<p class="signup-empty">Ingen oppgaver er lagt ut ennå — sjekk tilbake snart.</p>';
    return;
  }

  oppgaverEl.innerHTML = shifts
    .map((shift) => {
      const disabled = shift.is_full;
      return `
        <label class="oppgave-option ${disabled ? "oppgave-option-disabled" : ""}" data-shift-id="${shift.id}">
          <input type="checkbox" value="${shift.id}" data-critical="${shift.is_critical}" ${disabled ? "disabled" : ""}>
          <div class="oppgave-option-body">
            <div class="oppgave-option-title">
              ${shift.title}
              ${shift.is_critical ? '<span class="badge-critical">Krever erfaring</span>' : ""}
              ${disabled ? '<span class="badge-full">Fullt</span>' : ""}
            </div>
            <div class="oppgave-option-meta">${formatDate(shift.date)} · ${formatTimeRange(shift)}</div>
            ${
              shift.is_critical
                ? `<div class="oppgave-experience" hidden>
                    <p class="oppgave-experience-question">Har du relevant erfaring eller utdanning?</p>
                    <label class="oppgave-experience-option"><input type="radio" name="exp-${shift.id}" value="yes"> Ja</label>
                    <label class="oppgave-experience-option"><input type="radio" name="exp-${shift.id}" value="no"> Nei</label>
                    <textarea class="oppgave-experience-notes" placeholder="Fortell kort om erfaringen din (valgfritt)"></textarea>
                  </div>`
                : ""
            }
          </div>
        </label>
      `;
    })
    .join("");

  oppgaverEl.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const option = checkbox.closest(".oppgave-option");
      const experiencePanel = option.querySelector(".oppgave-experience");
      if (experiencePanel) {
        experiencePanel.hidden = !checkbox.checked;
      }
    });
  });
};

const loadEvent = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/public/event/`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const event = await response.json();
    renderOppgaver(event.shifts || []);
    loadingEl.hidden = true;
    formEl.hidden = false;
  } catch (err) {
    console.error("Error loading event", err);
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = "Kunne ikke laste oppgaver akkurat nå. Prøv å laste siden på nytt.";
  }
};

loadEvent();

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";

  const selectedBoxes = Array.from(oppgaverEl.querySelectorAll('input[type="checkbox"]:checked'));
  if (!selectedBoxes.length) {
    statusEl.textContent = "Velg minst én oppgave.";
    return;
  }

  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  const signups = selectedBoxes.map((checkbox) => {
    const shiftId = checkbox.value;
    const isCritical = checkbox.dataset.critical === "true";
    if (!isCritical) return { shiftId, body: {} };

    const option = checkbox.closest(".oppgave-option");
    const experienceAnswer = option.querySelector(`input[name="exp-${shiftId}"]:checked`);
    const notes = option.querySelector(".oppgave-experience-notes");
    return {
      shiftId,
      body: {
        has_relevant_experience: experienceAnswer ? experienceAnswer.value === "yes" : null,
        experience_notes: notes ? notes.value.trim() : "",
      },
    };
  });

  submitButton.disabled = true;
  submitButton.textContent = "Sender …";

  try {
    const registerResponse = await fetch(`${API_BASE_URL}/api/register/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const registerBody = await registerResponse.json().catch(() => ({}));

    if (!registerResponse.ok) {
      const detail = registerBody?.email?.[0] || registerBody?.password?.[0] || registerBody?.detail;
      throw new Error(detail || "Kunne ikke opprette bruker.");
    }

    const accessToken = registerBody.access;

    const results = await Promise.all(
      signups.map(({ shiftId, body }) =>
        fetch(`${API_BASE_URL}/api/shifts/${shiftId}/signup/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(body),
        })
      )
    );

    const failures = results.filter((r) => !r.ok).length;

    if (failures === 0) {
      statusEl.textContent = "Takk for at du melder deg! Du får beskjed nærmere jul. Last ned appen for å se oppgavene dine.";
      formEl.reset();
      oppgaverEl.querySelectorAll(".oppgave-experience").forEach((panel) => (panel.hidden = true));
    } else if (failures < signups.length) {
      statusEl.textContent = "Kontoen din ble opprettet, men én eller flere oppgaver kunne ikke registreres (kanskje de ble fulle akkurat nå). Logg inn i appen for å velge på nytt.";
    } else {
      statusEl.textContent = "Kontoen din ble opprettet, men oppgavene kunne ikke registreres. Logg inn i appen for å velge oppgaver.";
    }
  } catch (err) {
    console.error("Error signing up", err);
    statusEl.textContent = err.message || "Noe gikk galt. Prøv igjen.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Meld deg på";
  }
});
