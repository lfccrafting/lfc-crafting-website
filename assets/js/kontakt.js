(function () {
  "use strict";

  let calendarSettings = null;

  const DAY_KEYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
  ];

  const DAY_LABELS = {
    monday: "Montag",
    tuesday: "Dienstag",
    wednesday: "Mittwoch",
    thursday: "Donnerstag",
    friday: "Freitag",
    saturday: "Samstag",
    sunday: "Sonntag"
  };

  const JS_DAY_TO_KEY = {
    0: "sunday",
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday"
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, function (m) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[m];
    });
  }

  function fallbackCalendarSettings() {
    return {
      enabled: true,
      days: {
        monday: { enabled: true, from: "10:00", to: "18:00" },
        tuesday: { enabled: true, from: "10:00", to: "18:00" },
        wednesday: { enabled: true, from: "10:00", to: "18:00" },
        thursday: { enabled: true, from: "10:00", to: "18:00" },
        friday: { enabled: true, from: "10:00", to: "18:00" },
        saturday: { enabled: false, from: "10:00", to: "14:00" },
        sunday: { enabled: false, from: "10:00", to: "14:00" }
      }
    };
  }

  function setStatus(id, message, ok = true) {
    const el = $(id);
    if (!el) return;

    el.textContent = message || "";
    el.className = ok ? "shop-form-status ok" : "shop-form-status err";
  }

  function getContactForm() {
    return $("contactForm") || $("kontaktForm");
  }

  function getAppointmentForm() {
    return $("appointmentForm") || $("terminForm");
  }

  function getAppointmentNameInput() {
    return (
      $("appointmentName") ||
      $("terminName") ||
      document.querySelector('[name="appointment_name"]') ||
      document.querySelector('[name="termin_name"]') ||
      document.querySelector('[name="name"]')
    );
  }

  function getAppointmentReasonInput() {
    return (
      $("appointmentReason") ||
      $("terminGrund") ||
      document.querySelector('[name="appointment_reason"]') ||
      document.querySelector('[name="termin_grund"]') ||
      document.querySelector('[name="reason"]')
    );
  }

  function getAppointmentDateInput() {
    return (
      $("appointmentDate") ||
      $("terminDatum") ||
      $("date") ||
      document.querySelector('[name="requested_date"]') ||
      document.querySelector('[name="appointment_date"]') ||
      document.querySelector('[name="termin_datum"]')
    );
  }

  function getAppointmentTimeInput() {
    return (
      $("appointmentTime") ||
      $("terminUhrzeit") ||
      $("time") ||
      document.querySelector('[name="requested_time"]') ||
      document.querySelector('[name="appointment_time"]') ||
      document.querySelector('[name="termin_uhrzeit"]')
    );
  }

  function getOrCreateCalendarInfoBox() {
    let box =
      $("appointmentCalendarInfo") ||
      $("terminCalendarInfo") ||
      document.querySelector("[data-appointment-calendar-info]");

    const form = getAppointmentForm();

    if (!box && form) {
      box = document.createElement("div");
      box.id = "appointmentCalendarInfo";
      box.className = "bt-hint";
      box.setAttribute("data-appointment-calendar-info", "true");

      form.insertBefore(box, form.firstChild);
    }

    return box;
  }

  function getOrCreateAppointmentHint() {
    let hint =
      $("appointmentHint") ||
      $("terminHint") ||
      document.querySelector("[data-appointment-hint]");

    const timeInput = getAppointmentTimeInput();
    const dateInput = getAppointmentDateInput();

    if (!hint && timeInput) {
      hint = document.createElement("div");
      hint.id = "appointmentHint";
      hint.className = "small";
      hint.setAttribute("data-appointment-hint", "true");
      timeInput.insertAdjacentElement("afterend", hint);
    } else if (!hint && dateInput) {
      hint = document.createElement("div");
      hint.id = "appointmentHint";
      hint.className = "small";
      hint.setAttribute("data-appointment-hint", "true");
      dateInput.insertAdjacentElement("afterend", hint);
    }

    return hint;
  }

  async function triggerDiscordNotify() {
    try {
      if (!window.LFC_SUPABASE_CONFIG?.url) return;

      await fetch(`${window.LFC_SUPABASE_CONFIG.url}/functions/v1/discord-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ mode: "queue" })
      });
    } catch (error) {
      console.warn("Discord notify konnte nicht ausgelöst werden:", error);
    }
  }

  async function loadCalendarSettings() {
    const fallback = fallbackCalendarSettings();

    try {
      const { data, error } = await window.lfcSupabase
        .from("public_appointment_calendar_settings")
        .select("setting_value")
        .maybeSingle();

      if (error) {
        console.warn("Kalender-Einstellungen konnten nicht geladen werden:", error);
        calendarSettings = fallback;
        return;
      }

      calendarSettings = data?.setting_value || fallback;
    } catch (error) {
      console.warn("Kalender-Einstellungen Fallback aktiv:", error);
      calendarSettings = fallback;
    }
  }

  function renderCalendarSettingsInfo() {
    const box = getOrCreateCalendarInfoBox();
    if (!box) return;

    if (!calendarSettings) {
      box.innerHTML = "Kalenderzeiten werden geladen …";
      return;
    }

    if (!calendarSettings.enabled) {
      box.innerHTML = `
        <strong>Terminanfragen sind aktuell deaktiviert.</strong>
      `;
      return;
    }

    const rows = DAY_KEYS.map((key) => {
      const cfg = calendarSettings.days?.[key] || {
        enabled: false,
        from: "10:00",
        to: "18:00"
      };

      if (!cfg.enabled) {
        return `
          <tr>
            <td>${escHtml(DAY_LABELS[key])}</td>
            <td>geschlossen</td>
          </tr>
        `;
      }

      return `
        <tr>
          <td>${escHtml(DAY_LABELS[key])}</td>
          <td>${escHtml(cfg.from)} – ${escHtml(cfg.to)} Uhr</td>
        </tr>
      `;
    }).join("");

    box.innerHTML = `
      <strong>Mögliche Terminanfragen</strong>
      <div class="small">Termine können nur an den hier freigegebenen Tagen und Zeiten angefragt werden.</div>
      <table class="admin-table" style="margin-top:8px;">
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  function timeToMinutes(value) {
    const parts = String(value || "").split(":");
    const h = Number(parts[0] || 0);
    const m = Number(parts[1] || 0);
    return h * 60 + m;
  }

  function validateAppointmentDateTime(dateValue, timeValue) {
    if (!calendarSettings) {
      return {
        ok: true,
        message: ""
      };
    }

    if (!calendarSettings.enabled) {
      return {
        ok: false,
        message: "Terminanfragen sind aktuell deaktiviert."
      };
    }

    if (!dateValue || !timeValue) {
      return {
        ok: false,
        message: "Bitte Datum und Uhrzeit auswählen."
      };
    }

    const dateObj = new Date(dateValue + "T00:00:00");
    const key = JS_DAY_TO_KEY[dateObj.getDay()];
    const cfg = calendarSettings.days?.[key];

    if (!cfg || !cfg.enabled) {
      return {
        ok: false,
        message: `Am ${DAY_LABELS[key]} sind keine Terminanfragen möglich.`
      };
    }

    const selected = timeToMinutes(timeValue);
    const from = timeToMinutes(cfg.from);
    const to = timeToMinutes(cfg.to);

    if (selected < from || selected > to) {
      return {
        ok: false,
        message: `An diesem Tag sind Termine nur zwischen ${cfg.from} und ${cfg.to} Uhr möglich.`
      };
    }

    return {
      ok: true,
      message: "Terminzeit ist möglich."
    };
  }

  function applyCalendarInputBehavior() {
    const dateInput = getAppointmentDateInput();
    const timeInput = getAppointmentTimeInput();
    const hint = getOrCreateAppointmentHint();

    if (dateInput) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");

      dateInput.min = `${yyyy}-${mm}-${dd}`;
    }

    function refreshTimeRestrictions() {
      if (!dateInput || !timeInput || !calendarSettings) return;

      const dateValue = dateInput.value;

      if (!dateValue) {
        timeInput.removeAttribute("min");
        timeInput.removeAttribute("max");
        if (hint) {
          hint.textContent = "Bitte zuerst ein Datum auswählen.";
          hint.className = "small";
        }
        return;
      }

      const dateObj = new Date(dateValue + "T00:00:00");
      const key = JS_DAY_TO_KEY[dateObj.getDay()];
      const cfg = calendarSettings.days?.[key];

      if (!calendarSettings.enabled) {
        timeInput.disabled = true;
        if (hint) {
          hint.textContent = "Terminanfragen sind aktuell deaktiviert.";
          hint.className = "small err";
        }
        return;
      }

      if (!cfg || !cfg.enabled) {
        timeInput.disabled = true;
        timeInput.value = "";
        timeInput.removeAttribute("min");
        timeInput.removeAttribute("max");

        if (hint) {
          hint.textContent = `Am ${DAY_LABELS[key]} sind keine Terminanfragen möglich.`;
          hint.className = "small err";
        }
        return;
      }

      timeInput.disabled = false;
      timeInput.min = cfg.from;
      timeInput.max = cfg.to;

      const result = validateAppointmentDateTime(dateInput.value, timeInput.value);

      if (hint) {
        if (!timeInput.value) {
          hint.textContent = `Am ${DAY_LABELS[key]} sind Termine von ${cfg.from} bis ${cfg.to} Uhr möglich.`;
          hint.className = "small";
        } else {
          hint.textContent = result.message;
          hint.className = result.ok ? "small ok" : "small err";
        }
      }
    }

    if (dateInput) dateInput.addEventListener("change", refreshTimeRestrictions);
    if (timeInput) timeInput.addEventListener("input", refreshTimeRestrictions);
    if (timeInput) timeInput.addEventListener("change", refreshTimeRestrictions);

    refreshTimeRestrictions();
  }

  async function submitContactForm(ev) {
    ev.preventDefault();

    const form = ev.target;

    const name =
      (form.querySelector('[name="name"]') ||
        $("contactName") ||
        $("kontaktName"))?.value?.trim() || "";

    const subject =
      (form.querySelector('[name="subject"]') ||
        $("contactSubject") ||
        $("kontaktBetreff"))?.value?.trim() || "Kontaktanfrage";

    const message =
      (form.querySelector('[name="message"]') ||
        $("contactMessage") ||
        $("kontaktNachricht"))?.value?.trim() || "";

    if (!name || !message) {
      setStatus("contactStatus", "Bitte Name und Nachricht ausfüllen.", false);
      return;
    }

    const btn = form.querySelector("button[type='submit']");
    if (btn) btn.disabled = true;

    try {
      const { error } = await window.lfcSupabase
        .from("contact_requests")
        .insert({
          name,
          subject,
          message
        });

      if (error) throw error;

      await triggerDiscordNotify();

      setStatus("contactStatus", "✅ Kontaktanfrage gesendet.", true);
      form.reset();
    } catch (error) {
      console.error(error);
      setStatus("contactStatus", "❌ Kontaktanfrage konnte nicht gesendet werden.", false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function submitAppointmentForm(ev) {
    ev.preventDefault();

    const form = ev.target;

    const name = getAppointmentNameInput()?.value?.trim() || "";
    const reason = getAppointmentReasonInput()?.value?.trim() || "";
    const requestedDate = getAppointmentDateInput()?.value || "";
    const requestedTime = getAppointmentTimeInput()?.value || "";

    if (!name || !reason || !requestedDate || !requestedTime) {
      setStatus("appointmentStatus", "Bitte alle Terminfelder ausfüllen.", false);
      return;
    }

    const valid = validateAppointmentDateTime(requestedDate, requestedTime);

    if (!valid.ok) {
      setStatus("appointmentStatus", valid.message, false);
      return;
    }

    const btn = form.querySelector("button[type='submit']");
    if (btn) btn.disabled = true;

    try {
      const { error } = await window.lfcSupabase
        .from("appointment_requests")
        .insert({
          name,
          reason,
          requested_date: requestedDate,
          requested_time: requestedTime
        });

      if (error) throw error;

      await triggerDiscordNotify();

      setStatus("appointmentStatus", "✅ Terminanfrage gesendet.", true);
      form.reset();

      applyCalendarInputBehavior();
    } catch (error) {
      console.error(error);
      setStatus("appointmentStatus", "❌ Terminanfrage konnte nicht gesendet werden.", false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await loadCalendarSettings();

    renderCalendarSettingsInfo();
    applyCalendarInputBehavior();

    const contactForm = getContactForm();
    const appointmentForm = getAppointmentForm();

    if (contactForm) contactForm.addEventListener("submit", submitContactForm);
    if (appointmentForm) appointmentForm.addEventListener("submit", submitAppointmentForm);
  });
})();
