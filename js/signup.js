// Volunteer signup form (#frivillig): fetches the current event's vakter
// (shifts) and oppgaver (roles) from the public API, lets a visitor pick
// one or more of each, register with email+password, and sign up for the
// chosen vakter in one go.
//
// API base URL comes from js/config.js (window.API_BASE_URL), which Render
// generates per-environment at deploy time — see the Build Command in the
// Render static site settings. Falls back to config.js's committed default
// (preprod) for local dev.
const API_BASE_URL = window.API_BASE_URL;

const loadingEl = document.getElementById("signup-loading");
const errorEl = document.getElementById("signup-error");
const formEl = document.getElementById("signup-form");
const vakterEl = document.getElementById("signup-vakter");
const oppgaverEl = document.getElementById("signup-oppgaver");
const submitButton = document.getElementById("signup-submit");
const statusEl = document.getElementById("signup-status");

const formatTimeRange = (shift) => `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`;
const formatDate = (isoDate) => {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("no-NO", { day: "numeric", month: "long" });
};

// Groups shifts by phase to match the informational Vakter section above.
// Falls back to a catch-all group for dates outside the usual Dec 20-29
// window, so next year's event still renders sensibly if dates shift.
const VAKT_PHASES = [
  { label: "Oppsett", from: 20, to: 22 },
  { label: "Siste innspurt", from: 23, to: 23 },
  { label: "Julaften", from: 24, to: 24 },
  { label: "Juledagene", from: 25, to: 26 },
  { label: "Rydding & tilbakelevering", from: 27, to: 29 },
];

const phaseForShift = (shift) => {
  const day = Number(shift.date.split("-")[2]);
  const phase = VAKT_PHASES.find((p) => day >= p.from && day <= p.to);
  return phase ? phase.label : "Andre vakter";
};

const shiftOptionHTML = (shift) => {
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
};

const renderVakter = (shifts) => {
  if (!shifts.length) {
    vakterEl.innerHTML = '<p class="signup-empty">Ingen vakter er lagt ut ennå — sjekk tilbake snart.</p>';
    return;
  }

  const groups = new Map();
  shifts.forEach((shift) => {
    const label = phaseForShift(shift);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(shift);
  });

  vakterEl.innerHTML = VAKT_PHASES.map((p) => p.label)
    .concat(groups.has("Andre vakter") ? ["Andre vakter"] : [])
    .filter((label) => groups.has(label))
    .map(
      (label) => `
        <div class="signup-vakt-group">
          <h5 class="signup-vakt-group-title">${label}</h5>
          <div class="signup-vakt-options">${groups.get(label).map(shiftOptionHTML).join("")}</div>
        </div>
      `
    )
    .join("");

  vakterEl.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const option = checkbox.closest(".oppgave-option");
      const experiencePanel = option.querySelector(".oppgave-experience");
      if (experiencePanel) {
        experiencePanel.hidden = !checkbox.checked;
      }
    });
  });
};

const renderOppgaver = (skills) => {
  if (!skills.length) {
    oppgaverEl.innerHTML = "";
    return;
  }
  oppgaverEl.innerHTML = skills
    .map((skill) => {
      const isFlexible = /^fleksibel\b/i.test(skill.name);
      return `
        <label class="oppgave-chip" ${isFlexible ? 'data-flexible="true"' : ""}>
          <input type="checkbox" value="${skill.id}" ${isFlexible ? 'id="oppgave-flexible"' : ""}>
          <span>${skill.name}</span>
        </label>
      `;
    })
    .join("");

  // Picking "Fleksibel" means you're happy to help wherever needed, so the
  // specific role choices below it stop being meaningful — grey them out
  // rather than leave a confusing mix of a flexible pick plus specifics.
  const flexibleBox = document.getElementById("oppgave-flexible");
  if (flexibleBox) {
    const otherChips = Array.from(oppgaverEl.querySelectorAll(".oppgave-chip")).filter(
      (chip) => chip.dataset.flexible !== "true"
    );
    flexibleBox.addEventListener("change", () => {
      otherChips.forEach((chip) => {
        const checkbox = chip.querySelector('input[type="checkbox"]');
        checkbox.checked = false;
        checkbox.disabled = flexibleBox.checked;
        chip.classList.toggle("oppgave-chip-disabled", flexibleBox.checked);
      });
    });
  }
};

const loadEvent = async () => {
  try {
    const [eventResponse, skillsResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/api/public/event/`),
      fetch(`${API_BASE_URL}/api/public/skills/`),
    ]);
    if (!eventResponse.ok) throw new Error(`event status ${eventResponse.status}`);
    const event = await eventResponse.json();
    const skills = skillsResponse.ok ? await skillsResponse.json() : [];

    renderVakter(event.shifts || []);
    renderOppgaver(skills);
    loadingEl.hidden = true;
    formEl.hidden = false;
  } catch (err) {
    console.error("Error loading event", err);
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = "Kunne ikke laste vakter og oppgaver akkurat nå. Prøv å laste siden på nytt.";
  }
};

loadEvent();

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";

  const selectedShiftBoxes = Array.from(vakterEl.querySelectorAll('input[type="checkbox"]:checked'));
  if (!selectedShiftBoxes.length) {
    statusEl.textContent = "Velg minst én vakt.";
    return;
  }

  const selectedSkillIds = Array.from(oppgaverEl.querySelectorAll('input[type="checkbox"]:checked')).map(
    (checkbox) => Number(checkbox.value)
  );

  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  const signups = selectedShiftBoxes.map((checkbox) => {
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
      body: JSON.stringify({ email, password, skill_ids: selectedSkillIds }),
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
      vakterEl.querySelectorAll(".oppgave-experience").forEach((panel) => (panel.hidden = true));
    } else if (failures < signups.length) {
      statusEl.textContent = "Kontoen din ble opprettet, men én eller flere vakter kunne ikke registreres (kanskje de ble fulle akkurat nå). Logg inn i appen for å velge på nytt.";
    } else {
      statusEl.textContent = "Kontoen din ble opprettet, men vaktene kunne ikke registreres. Logg inn i appen for å velge vakter.";
    }
  } catch (err) {
    console.error("Error signing up", err);
    statusEl.textContent = err.message || "Noe gikk galt. Prøv igjen.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Meld deg på";
  }
});
