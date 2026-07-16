// Volunteer signup form (#frivillig): fetches the current event's vakter
// (shifts) and its oppgave slots (which oppgave is offered on which vakt,
// with how much room) from the public API, lets a visitor check off
// specific (vakt, oppgave) combinations, register with just an email, and
// sign up for each chosen combination in one go. No password -- volunteers
// don't need one.
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

// Groups shifts by phase -- purely a display grouping, unrelated to any
// backend concept (the old Shift.phase field is gone; compatibility
// between a vakt and an oppgave is now just "does a slot exist for this
// pair"). Falls back to a catch-all group for dates outside the usual Dec
// 20-29 window, so next year's event still renders sensibly if dates shift.
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

// Mirrors the backend's signup validation (OppgaveSlotViewSet.signup) so an
// impossible vakt combination greys out live as you check boxes, with a
// reason, instead of only failing after you submit. Populated once the
// vakter/slots are rendered -- see renderVakter/loadEvent.
let shiftsById = {};
let orderedShiftIds = [];
// [idA, idB] string pairs an admin has declared can't be combined -- not
// computed from start/end times. An earlier version of this file computed
// real time overlap instead, which incorrectly also blocked vakt 5+6 and
// 8+9 (which genuinely overlap but aren't forbidden) -- see the backend's
// ShiftConflict model docstring for why that's not a rule that generalizes
// from the two named pairs (vakt 6+7, 9+10).
let conflictPairs = [];

const shiftsConflict = (idA, idB) =>
  conflictPairs.some(([a, b]) => (a === idA && b === idB) || (a === idB && b === idA));

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

// Re-run on every oppgave-slot checkbox change. The conflict/3-consecutive
// rules apply per vakt, not per slot -- checking a second oppgave on a vakt
// you've already picked one on is always fine, so a vakt with any checked
// slot never gets its *other* slots disabled by this logic. Never disables
// a slot the visitor already checked -- only prevents adding a new one that
// would conflict with the current selection, so nothing gets silently
// unchecked out from under them. A slot that's simply full (no room left)
// stays disabled regardless -- that's set once at render time, not here.
const updateVaktAvailability = () => {
  const slotCheckboxes = Array.from(vakterEl.querySelectorAll('input[type="checkbox"]'));

  const checkboxesByShift = new Map();
  slotCheckboxes.forEach((checkbox) => {
    const shiftId = checkbox.dataset.shiftId;
    if (!checkboxesByShift.has(shiftId)) checkboxesByShift.set(shiftId, []);
    checkboxesByShift.get(shiftId).push(checkbox);
  });

  const checkedShiftIds = new Set(
    slotCheckboxes.filter((cb) => cb.checked).map((cb) => cb.dataset.shiftId)
  );

  checkboxesByShift.forEach((checkboxes, shiftId) => {
    const shift = shiftsById[shiftId];
    if (!shift) return;

    const shiftAlreadyChecked = checkboxes.some((cb) => cb.checked);
    let reason = null;
    if (!shiftAlreadyChecked) {
      if ([...checkedShiftIds].some((id) => id !== shiftId && shiftsConflict(shiftId, id))) {
        reason = "Kan ikke kombineres med en valgt vakt.";
      } else if (wouldCompleteThreeConsecutive(shiftId, checkedShiftIds)) {
        reason = "Ville gitt tre vakter på rad.";
      }
    }

    checkboxes.forEach((checkbox) => {
      if (checkbox.dataset.full === "true") return; // permanently disabled, leave as-is
      const option = checkbox.closest(".oppgave-option");
      const reasonEl = option.querySelector(".oppgave-option-reason");

      if (checkbox.checked) {
        checkbox.disabled = false;
        option.classList.remove("oppgave-option-disabled");
        if (reasonEl) reasonEl.hidden = true;
        return;
      }

      checkbox.disabled = Boolean(reason);
      option.classList.toggle("oppgave-option-disabled", Boolean(reason));
      if (reasonEl) {
        reasonEl.hidden = !reason;
        reasonEl.textContent = reason || "";
      }
    });
  });
};

// Builds real DOM nodes rather than an HTML string -- shift.title/skill_name
// come from whoever has admin access on the event, and interpolating them
// into innerHTML would make a compromised/phished admin account a
// stored-XSS vector against every visitor to this public page.
// textContent/append with a string always inserts a text node, never markup.
const oppgaveSlotOptionEl = (slot, shift) => {
  const disabled = slot.is_full;

  const label = document.createElement("label");
  label.className = disabled ? "oppgave-option oppgave-option-disabled" : "oppgave-option";
  label.dataset.slotId = slot.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = slot.id;
  checkbox.dataset.shiftId = shift.id;
  checkbox.dataset.critical = shift.is_critical;
  checkbox.dataset.full = disabled;
  checkbox.disabled = disabled;
  label.appendChild(checkbox);

  const body = document.createElement("div");
  body.className = "oppgave-option-body";

  const titleRow = document.createElement("div");
  titleRow.className = "oppgave-option-title";
  titleRow.append(slot.skill_name);
  if (disabled) {
    const fullBadge = document.createElement("span");
    fullBadge.className = "badge-full";
    fullBadge.textContent = "Fullt";
    titleRow.appendChild(fullBadge);
  }
  body.appendChild(titleRow);

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
    yesRadio.name = `exp-${slot.id}`;
    yesRadio.value = "yes";
    yesLabel.append(yesRadio, " Ja");
    experience.appendChild(yesLabel);

    const noLabel = document.createElement("label");
    noLabel.className = "oppgave-experience-option";
    const noRadio = document.createElement("input");
    noRadio.type = "radio";
    noRadio.name = `exp-${slot.id}`;
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

const shiftGroupEl = (shift, slots) => {
  const groupEl = document.createElement("div");
  groupEl.className = "signup-shift-group";
  groupEl.dataset.shiftId = shift.id;

  const header = document.createElement("div");
  header.className = "signup-shift-header";

  const title = document.createElement("span");
  title.className = "signup-shift-title";
  title.textContent = shift.title;
  header.appendChild(title);

  if (shift.is_critical) {
    const badge = document.createElement("span");
    badge.className = "badge-critical";
    badge.textContent = "Krever erfaring";
    header.appendChild(badge);
  }

  const meta = document.createElement("span");
  meta.className = "signup-shift-meta";
  meta.textContent = `${formatDate(shift.date)} · ${formatTimeRange(shift)}`;
  header.appendChild(meta);

  groupEl.appendChild(header);

  const slotsEl = document.createElement("div");
  slotsEl.className = "signup-shift-slots";
  slots.forEach((slot) => slotsEl.appendChild(oppgaveSlotOptionEl(slot, shift)));
  groupEl.appendChild(slotsEl);

  return groupEl;
};

const renderVakter = (shifts, oppgaveSlots) => {
  vakterEl.innerHTML = "";

  const slotsByShift = new Map();
  oppgaveSlots.forEach((slot) => {
    if (!slotsByShift.has(slot.shift)) slotsByShift.set(slot.shift, []);
    slotsByShift.get(slot.shift).push(slot);
  });

  // A vakt with no oppgaver configured on it yet has nothing to sign up
  // for -- skip it rather than show an empty, unselectable vakt.
  const shiftsWithSlots = shifts.filter((shift) => (slotsByShift.get(shift.id) || []).length > 0);

  if (!shiftsWithSlots.length) {
    const empty = document.createElement("p");
    empty.className = "signup-empty";
    empty.textContent = "Ingen vakter er lagt ut ennå — sjekk tilbake snart.";
    vakterEl.appendChild(empty);
    return;
  }

  shiftsById = {};
  shiftsWithSlots.forEach((shift) => {
    shiftsById[shift.id] = shift;
  });
  // Matches the backend's ordering (Shift.Meta.ordering = date, start_time)
  // -- computed client-side too rather than assumed from API response
  // order, so wouldCompleteThreeConsecutive stays correct even if that
  // ever changes.
  orderedShiftIds = [...shiftsWithSlots]
    .sort((a, b) => `${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`))
    .map((shift) => String(shift.id));

  const groups = new Map();
  shiftsWithSlots.forEach((shift) => {
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
      groups.get(label).forEach((shift) => {
        optionsEl.appendChild(shiftGroupEl(shift, slotsByShift.get(shift.id) || []));
      });
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

const loadEvent = async () => {
  try {
    const eventResponse = await fetch(`${API_BASE_URL}/api/public/event/`);
    if (!eventResponse.ok) throw new Error(`event status ${eventResponse.status}`);
    const event = await eventResponse.json();

    loadingEl.hidden = true;

    if (event.signups_open === false) {
      closedEl.textContent = signupClosedMessage(event);
      closedEl.hidden = false;
      return;
    }

    conflictPairs = (event.conflicts || []).map((c) => [String(c.shift_a), String(c.shift_b)]);
    renderVakter(event.shifts || [], event.oppgave_slots || []);
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

  const selectedSlotBoxes = Array.from(vakterEl.querySelectorAll('input[type="checkbox"]:checked'));
  if (!selectedSlotBoxes.length) {
    statusEl.textContent = "Velg minst én oppgave på en vakt.";
    return;
  }

  const email = document.getElementById("signup-email").value.trim();

  const signups = selectedSlotBoxes.map((checkbox) => {
    const slotId = checkbox.value;
    const isCritical = checkbox.dataset.critical === "true";
    if (!isCritical) return { slotId, body: {} };

    const option = checkbox.closest(".oppgave-option");
    const experienceAnswer = option.querySelector(`input[name="exp-${slotId}"]:checked`);
    const notes = option.querySelector(".oppgave-experience-notes");
    return {
      slotId,
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
      body: JSON.stringify({ email }),
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
    for (const { slotId, body } of signups) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/oppgave-slots/${slotId}/signup/`, {
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
      statusEl.textContent = `Kontoen din ble opprettet, men ${failures.length} av ${signups.length} oppgaver kunne ikke registreres. ${reasons} Logg inn i appen for å velge på nytt.`;
    } else {
      statusEl.textContent = `Kontoen din ble opprettet, men oppgavene kunne ikke registreres. ${reasons} Logg inn i appen for å velge oppgaver.`;
    }
  } catch (err) {
    console.error("Error signing up", err);
    statusEl.textContent = err.message || "Noe gikk galt. Prøv igjen.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Meld deg på";
  }
});
