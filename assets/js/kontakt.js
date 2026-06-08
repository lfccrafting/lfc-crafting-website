(function () {
  "use strict";

  let calendarSettings = null;

  const dayKeyByJsDay = {
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

  function setStatus(id, message, ok = true) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || "";
    el.className = ok ? "shop-form-status ok" : "shop-form-status err";
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
    const fallback = {
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

    try {
      const { data, error } = await window.lfcSupabase
        .from("app_settings")
        .select("setting_value")
        .eq("setting_key", "appointment_calendar_settings")
        .maybeSingle();

      if (error || !data) {
        calendarSettings = fallback;
      } else {
        calendarSettings = data.setting_value || fallback;
      }
    } catch {
      calendarSettings = fallback;
    }
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

    const d = new Date(dateValue + "T00:00:00");
    const key = dayKeyByJsDay[d.getDay()];
    const cfg = calendarSettings.days?.[key];

    if (!cfg || !cfg.enabled) {
      return {
        ok: false,
        message: "An diesem Wochentag sind keine Terminanfragen möglich."
      };
    }

    if (timeValue < cfg.from || timeValue > cfg.to) {
      return {
        ok: false,
        message: `An diesem Tag sind Termine nur zwischen ${cfg.from} und ${cfg.to} möglich.`
      };
    }

    return {
      ok: true,
      message: ""
    };
  }

  function applyCalendarHints() {
    const dateInput = $("appointmentDate") || $("terminDatum") || $("date");
    const timeInput = $("appointmentTime") || $("terminUhrzeit") || $("time");
    const hint = $("appointmentHint") || $("terminHint");

    if (dateInput) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      dateInput.min = `${yyyy}-${mm}-${dd}`;
    }

    function refreshHint() {
      if (!dateInput || !timeInput || !hint) return;
      const result = validateAppointmentDateTime(dateInput.value, timeInput.value);
      hint.textContent = result.ok ? "Terminzeit ist möglich." : result.message;
      hint.className = result.ok ? "small ok" : "small err";
    }

    if (dateInput) dateInput.addEventListener("change", refreshHint);
    if (timeInput) timeInput.addEventListener("change", refreshHint);
  }

  async function submitContactForm(ev) {
    ev.preventDefault();

    const form = ev.target;
    const name = (form.querySelector('[name="name"]') || $("contactName") || $("kontaktName"))?.value?.trim() || "";
    const subject = (form.querySelector('[name="subject"]') || $("contactSubject") || $("kontaktBetreff"))?.value?.trim() || "Kontaktanfrage";
    const message = (form.querySelector('[name="message"]') || $("contactMessage") || $("kontaktNachricht"))?.value?.trim() || "";

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

    const name = (form.querySelector('[name="name"]') || $("appointmentName") || $("terminName"))?.value?.trim() || "";
    const reason = (form.querySelector('[name="reason"]') || $("appointmentReason") || $("terminGrund"))?.value?.trim() || "";
    const requestedDate = (form.querySelector('[name="requested_date"]') || $("appointmentDate") || $("terminDatum"))?.value || "";
    const requestedTime = (form.querySelector('[name="requested_time"]') || $("appointmentTime") || $("terminUhrzeit"))?.value || "";

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
    } catch (error) {
      console.error(error);
      setStatus("appointmentStatus", "❌ Terminanfrage konnte nicht gesendet werden.", false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await loadCalendarSettings();
    applyCalendarHints();

    const contactForm = $("contactForm") || $("kontaktForm");
    const appointmentForm = $("appointmentForm") || $("terminForm");

    if (contactForm) contactForm.addEventListener("submit", submitContactForm);
    if (appointmentForm) appointmentForm.addEventListener("submit", submitAppointmentForm);
  });
})();
