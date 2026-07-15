// Volunteer signup form (#frivillig): fetches the current event's vakter
// (shifts) and oppgaver (roles) from the public API, lets a visitor pick
// one or more of each, register with just an email, and sign up for the
// chosen vakter in one go. No password -- volunteers don't need one.
//
// API base URL comes from js/config.js (window.API_BASE_URL), which Render
// generates per-environment at deploy time — see the Build Command in the
// Render static site settings. Falls back to config.js's committed default
// (preprod) for local dev.
const API_BASE_URL = window.API_BASE_URL;

const loadingEl = document.getElementById("signup-loading");
const errorEl = document.getElementById("signup-error");
const closedEl = document.getElementById("signup-closed");
const formEl = document.getElementById("signup-form");
const vakterEl = document.getElementById("signup-vakter");
const oppgaverEl = document.getElementById("signup-oppgaver");
const submitButton = document.getElementById("signup-submit");
const statusEl = document.getElementById("signup-status");

const formatOpenDate = (isoString) =>
  new Date(isoString).toLocaleDateString("no-NO", { day: "numeric", month: "long", year: "numeric" });

const signupClosedMessage = (event) => {
  const now = new Date();
  if (event.signup_opens_at && now < new Date(event.signup_opens_at)) {
    return `Påmeldingen åpner ${formatOpenDate(event.signup_opens_at)}. Sjekk tilbake da!`;
  }
  if (event.signup_closes_at && now > new Date(event.signup_closes_at)) {
    return "Påmeldingen er dessverre stengt for i år.";
  }
  return "Påmeldingen er ikke åpen akkurat nå.";
};

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

// Mirrors the backend's signup validation (ShiftViewSet.signup) so an
// impossible combination greys out live as you check boxes, with a reason,
// instead of only failing after you submit. Populated once the vakter/
// oppgaver are rendered -- see renderVakter/renderOppgaver.
let shiftsById = {};
let orderedShiftIds = [];
let skillsById = {};

const shiftRange = (shift) => {
  const start = new Date(`${shift.date}T${shift.start_time}`);
  const endSameDay = new Date(`${shift.date}T${shift.end_time}`);
  const end = endSameDay > start ? endSameDay : new Date(endSameDay.getTime() + 24 * 60 * 60 * 1000);
  return [start, end];
};

const shiftsOverlap = (a, b) => {
  const [aStart, aEnd] = shiftRange(a);
  const [bStart, bEnd] = shiftRange(b);
  return aStart < bEnd && bStart < aEnd;
};

const wouldCompleteThreeConsecutive = (candidateId, checkedIds) => {
  const index = orderedShiftIds.indexOf(candidateId);
  if (index === -1) return false;
  const simulated = new Set(checkedIds);
  simulated.add(candidateId);
  for (const windowStart of [index - 2, index - 1, index]) {
    if (windowStart < 0 || windowStart + 3 > orderedShiftIds.length) continue;
    const window = orderedShiftIds.slice(windowStart, windowStart + 3);
    if (window.every((id) => simulated.has(id))) return true;
  }
  return false;
};

// null = no restriction (matches the backend: a user with zero oppgaver
// picked isn't blocked from any vakt).
const allowedPhasesFromSkillIds = (checkedSkillIds) => {
  if (checkedSkillIds.size === 0) return null;
  const allowed = new Set();
  checkedSkillIds.forEach((id) => {
    const skill = skillsById[id];
    if (!skill) return;
    if (skill.allowed_in_setup) allowed.add("setup");
    if (skill.allowed_in_guest) allowed.add("guest");
    if (skill.allowed_in_teardown) allowed.add("teardown");
  });
  return allowed;
};

// Re-run on every vakt/oppgave checkbox change. Never disables a vakt the
// visitor already checked -- only prevents adding a new one that would
// conflict with the current selection, so nothing gets silently unchecked
// out from under them.
const updateVaktAvailability = () => {
  const vaktCheckboxes = Array.from(vakterEl.querySelectorAll('input[type="checkbox"]'));
  const checkedVaktIds = new Set(vaktCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value));
  const checkedSkillIds = new Set(
    Array.from(oppgaverEl.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value)
  );
  const allowedPhases = allowedPhasesFromSkillIds(checkedSkillIds);

  vaktCheckboxes.forEach((checkbox) => {
    const shift = shiftsById[checkbox.value];
    if (!shift || shift.is_full) return;

    const option = checkbox.closest(".oppgave-option");
    const reasonEl = option.querySelector(".oppgave-option-reason");

    if (checkbox.checked) {
      checkbox.disabled = false;
      option.classList.remove("oppgave-option-disabled");
      if (reasonEl) reasonEl.hidden = true;
      return;
    }

    let reason = null;
    if ([...checkedVaktIds].some((id) => shiftsOverlap(shift, shiftsById[id]))) {
      reason = "Overlapper med en valgt vakt.";
    } else if (wouldCompleteThreeConsecutive(checkbox.value, checkedVaktIds)) {
      reason = "Ville gitt tre vakter på rad.";
    } else if (allowedPhases && shift.phase && !allowedPhases.has(shift.phase)) {
      reason = "Ingen valgte oppgaver gjelder for denne vakten.";
    }

    checkbox.disabled = Boolean(reason);
    option.classList.toggle("oppgave-option-disabled", Boolean(reason));
    if (reasonEl) {
      reasonEl.hidden = !reason;
      reasonEl.textContent = reason || "";
    }
  });
};

// Builds real DOM nodes rather than an HTML string -- shift.title comes
// from whoever has admin access on the event, and interpolating it into
// innerHTML would make a compromised/phished admin account a stored-XSS
// vector against every visitor to this public page. textContent/append
// with a string always inserts a text node, never markup.
const shiftOptionEl = (shift) => {
  const disabled = shift.is_full;

  const label = document.createElement("label");
  label.className = disabled ? "oppgave-option oppgave-option-disabled" : "oppgave-option";
  label.dataset.shiftId = shift.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = shift.id;
  checkbox.dataset.critical = shift.is_critical;
  checkbox.disabled = disabled;
  label.appendChild(checkbox);

  const body = document.createElement("div");
  body.className = "oppgave-option-body";

  const titleRow = document.createElement("div");
  titleRow.className = "oppgave-option-title";
  titleRow.append(shift.title);
  if (shift.is_critical) {
    const badge = document.createElement("span");
    badge.className = "badge-critical";
    badge.textContent = "Krever erfaring";
    titleRow.appendChild(badge);
  }
  if (disabled) {
    const fullBadge = document.createElement("span");
    fullBadge.className = "badge-full";
    fullBadge.textContent = "Fullt";
    titleRow.appendChild(fullBadge);
  }
  body.appendChild(titleRow);

  const meta = document.createElement("div");
  meta.className = "oppgave-option-meta";
  meta.textContent = `${formatDate(shift.date)} · ${formatTimeRange(shift)}`;
  body.appendChild(meta);

  const reason = document.createElement("div");
  reason.className = "oppgave-option-reason";
  reason.hidden = true;
  body.appendChild(reason);

  if (shift.is_critical) {
    const experience = document.createElement("div");
    experience.className = "oppgave-experience";
    experience.hidden = true;

    const question = document.createElement("p");
    question.className = "oppgave-experience-question";
    question.textContent = "Har du relevant erfaring eller utdanning?";
    experience.appendChild(question);

    const yesLabel = document.createElement("label");
    yesLabel.className = "oppgave-experience-option";
    const yesRadio = document.createElement("input");
    yesRadio.type = "radio";
    yesRadio.name = `exp-${shift.id}`;
    yesRadio.value = "yes";
    yesLabel.append(yesRadio, " Ja");
    experience.appendChild(yesLabel);

    const noLabel = document.createElement("label");
    noLabel.className = "oppgave-experience-option";
    const noRadio = document.createElement("input");
    noRadio.type = "radio";
    noRadio.name = `exp-${shift.id}`;
    noRadio.value = "no";
    noLabel.append(noRadio, " Nei");
    experience.appendChild(noLabel);

    const notes = document.createElement("textarea");
    notes.className = "oppgave-experience-notes";
    notes.placeholder = "Fortell kort om erfaringen din (valgfritt)";
    experience.appendChild(notes);

    body.appendChild(experience);
  }

  label.appendChild(body);
  return label;
};

const renderVakter = (shifts) => {
  vakterEl.innerHTML = "";

  if (!shifts.length) {
    const empty = document.createElement("p");
    empty.className = "signup-empty";
    empty.textContent = "Ingen vakter er lagt ut ennå — sjekk tilbake snart.";
    vakterEl.appendChild(empty);
    return;
  }

  shiftsById = {};
  shifts.forEach((shift) => {
    shiftsById[shift.id] = shift;
  });
  // Matches the backend's ordering (Shift.Meta.ordering = date, start_time)
  // -- computed client-side too rather than assumed from API response
  // order, so wouldCompleteThreeConsecutive stays correct even if that
  // ever changes.
  orderedShiftIds = [...shifts]
    .sort((a, b) => `${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`))
    .map((shift) => String(shift.id));

  const groups = new Map();
  shifts.forEach((shift) => {
    const label = phaseForShift(shift);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(shift);
  });

  VAKT_PHASES.map((p) => p.label)
    .concat(groups.has("Andre vakter") ? ["Andre vakter"] : [])
    .filter((label) => groups.has(label))
    .forEach((label) => {
      const groupEl = document.createElement("div");
      groupEl.className = "signup-vakt-group";

      const heading = document.createElement("h5");
      heading.className = "signup-vakt-group-title";
      heading.textContent = label;
      groupEl.appendChild(heading);

      const optionsEl = document.createElement("div");
      optionsEl.className = "signup-vakt-options";
      groups.get(label).forEach((shift) => optionsEl.appendChild(shiftOptionEl(shift)));
      groupEl.appendChild(optionsEl);

      vakterEl.appendChild(groupEl);
    });

  vakterEl.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const option = checkbox.closest(".oppgave-option");
      const experiencePanel = option.querySelector(".oppgave-experience");
      if (experiencePanel) {
        experiencePanel.hidden = !checkbox.checked;
      }
      updateVaktAvailability();
    });
  });
};

// Skill carries which vakt phases it applies to (set by an admin on the
// Oppgaver page) -- derive the hint from that instead of hardcoding text,
// so it can't drift out of sync with what's actually configured. All
// three (or none, before an admin has curated it) means unrestricted, so
// no hint is shown.
const PHASE_LABELS = { allowed_in_setup: "forberedelse", allowed_in_guest: "vakter med gjester", allowed_in_teardown: "rydding" };
const phaseHint = (skill) => {
  const allowed = Object.keys(PHASE_LABELS).filter((field) => skill[field]);
  if (allowed.length === 0 || allowed.length === Object.keys(PHASE_LABELS).length) return null;
  return `kun ${allowed.map((field) => PHASE_LABELS[field]).join(" og ")}`;
};

const renderOppgaver = (skills) => {
  oppgaverEl.innerHTML = "";
  if (!skills.length) return;

  skillsById = {};
  skills.forEach((skill) => {
    skillsById[skill.id] = skill;
  });

  skills.forEach((skill) => {
    const isFlexible = /^fleksibel\b/i.test(skill.name);

    const chip = document.createElement("label");
    chip.className = "oppgave-chip";
    if (isFlexible) chip.dataset.flexible = "true";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = skill.id;
    if (isFlexible) checkbox.id = "oppgave-flexible";
    chip.appendChild(checkbox);

    const span = document.createElement("span");
    span.textContent = skill.name;
    const hint = phaseHint(skill);
    if (hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "oppgave-chip-hint";
      hintEl.textContent = ` (${hint})`;
      span.appendChild(hintEl);
    }
    chip.appendChild(span);

    oppgaverEl.appendChild(chip);
  });

  oppgaverEl.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", updateVaktAvailability);
  });

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
      updateVaktAvailability();
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

    loadingEl.hidden = true;

    if (event.signups_open === false) {
      closedEl.textContent = signupClosedMessage(event);
      closedEl.hidden = false;
      return;
    }

    renderVakter(event.shifts || []);
    renderOppgaver(skills);
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
      body: JSON.stringify({ email, skill_ids: selectedSkillIds }),
    });
    const registerBody = await registerResponse.json().catch(() => ({}));

    if (!registerResponse.ok) {
      const detail = registerBody?.email?.[0] || registerBody?.detail;
      throw new Error(detail || "Kunne ikke opprette bruker.");
    }

    const accessToken = registerBody.access;

    // Sequential, not Promise.all: the backend rejects a vakt that would
    // overlap or complete a run of 3 consecutive vakter *already signed up
    // for* -- submitting in parallel means two vakter in the same batch
    // might each see the other as "not yet signed up" and both pass a
    // check that should have caught their combination. Awaiting each one
    // in turn means every request sees the prior ones in this same
    // submission as already persisted, so the checks apply correctly.
    const signupResults = [];
    for (const { shiftId, body } of signups) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/shifts/${shiftId}/signup/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(body),
        });
        const resBody = await res.json().catch(() => ({}));
        signupResults.push({ ok: res.ok, detail: resBody?.detail });
      } catch (err) {
        signupResults.push({ ok: false, detail: null });
      }
    }

    const failures = signupResults.filter((r) => !r.ok);
    const reasons = failures.map((f) => f.detail).filter(Boolean).join(" ");

    if (failures.length === 0) {
      statusEl.textContent = "Takk for at du melder deg! Sjekk e-posten din for en lenke til å sette et passord, så kan du logge inn i appen og se oppgavene dine. Du får også beskjed nærmere jul.";
      formEl.reset();
      vakterEl.querySelectorAll(".oppgave-experience").forEach((panel) => (panel.hidden = true));
      // reset() doesn't fire change events, so re-run explicitly -- otherwise
      // vakter disabled by the just-submitted selection would stay disabled.
      updateVaktAvailability();
    } else if (failures.length < signups.length) {
      statusEl.textContent = `Kontoen din ble opprettet, men ${failures.length} av ${signups.length} vakter kunne ikke registreres. ${reasons} Logg inn i appen for å velge på nytt.`;
    } else {
      statusEl.textContent = `Kontoen din ble opprettet, men vaktene kunne ikke registreres. ${reasons} Logg inn i appen for å velge vakter.`;
    }
  } catch (err) {
    console.error("Error signing up", err);
    statusEl.textContent = err.message || "Noe gikk galt. Prøv igjen.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Meld deg på";
  }
});
