let currentTab = "vehicles";
let vehicleGroupsCache = [];
let profilesCache = [];
let currentUserRole = null;

const FINISHED_STATUSES = ["completed", "cancelled", "rejected"];

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

function input(value, name, type = "text", extra = "") {
  return `<input class="input" data-name="${name}" type="${type}" value="${escHtml(value ?? "")}" ${extra}>`;
}

function textarea(value, name, extra = "") {
  return `<textarea class="input" data-name="${name}" ${extra}>${escHtml(value || "")}</textarea>`;
}

function setAdminStatus(message, type = "") {
  const el = document.getElementById("adminStatus");
  if (!el) return;

  el.textContent = message || "";
  el.className = "status-line small";

  if (type) el.classList.add(type);
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("de-DE");
  } catch {
    return String(value);
  }
}

function formatDateInput(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  } catch {
    return "";
  }
}

function euro(value) {
  const n = Number(value || 0);
  return n.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function normalizePreviewImageUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  if (!/^https:\/\//i.test(s)) return "";
  return s;
}

function parseImageTextarea(value) {
  const seen = new Set();

  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((url) => /^https:\/\//i.test(url))
    .filter((url) => {
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function imagesToTextarea(images) {
  return (images || [])
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((img) => String(img.image_url || "").trim())
    .filter(Boolean)
    .filter((url) => /^https:\/\//i.test(url))
    .join("\n");
}

function renderImagePreview(imageText) {
  const urls = parseImageTextarea(imageText);

  if (!urls.length) {
    return `<div class="img-preview-empty">Keine gültigen https:// Bilder eingetragen</div>`;
  }

  return `
    <div class="img-preview">
      ${urls
        .slice(0, 10)
        .map((url, index) => {
          const previewUrl = normalizePreviewImageUrl(url);

          return `
            <div class="img-preview-item" title="${escHtml(url)}">
              <span>${index + 1}${index === 0 ? " ★" : ""}</span>
              <img src="${escHtml(previewUrl)}" alt="" loading="lazy" onerror="this.style.opacity='.25'">
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderGroupOptions(selectedGroupId) {
  const selected = selectedGroupId ? String(selectedGroupId) : "";

  return `
    <option value="">Ohne Gruppe</option>
    ${vehicleGroupsCache
      .map((g) => {
        const id = String(g.id);
        return `
          <option value="${escHtml(id)}" ${id === selected ? "selected" : ""}>
            ${escHtml(g.name)}
          </option>
        `;
      })
      .join("")}
  `;
}

function renderProfileOptions(selectedUserId) {
  const selected = selectedUserId ? String(selectedUserId) : "";

  return `
    <option value="">Nicht zugewiesen</option>
    ${profilesCache
      .map((p) => {
        const id = String(p.id);
        const label = p.display_name || p.email || id;
        return `
          <option value="${escHtml(id)}" ${id === selected ? "selected" : ""}>
            ${escHtml(label)}
          </option>
        `;
      })
      .join("")}
  `;
}

function renderStatusOptions(selected) {
  const statuses = [
    "new",
    "accepted",
    "in_progress",
    "waiting_for_customer",
    "ready",
    "completed",
    "rejected",
    "cancelled"
  ];

  return statuses
    .map((s) => `<option value="${s}" ${selected === s ? "selected" : ""}>${s}</option>`)
    .join("");
}

async function loadVehicleGroups() {
  const { data, error } = await window.lfcSupabase
    .from("vehicle_groups")
    .select("id,name,sort_order,is_active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;

  vehicleGroupsCache = data || [];
}

async function loadProfiles() {
  const { data, error } = await window.lfcSupabase
    .from("profiles")
    .select("id,email,display_name,role,is_active")
    .eq("is_active", true)
    .in("role", ["employee", "manager", "admin"])
    .order("display_name", { ascending: true });

  if (error) throw error;

  profilesCache = data || [];
}

async function requireLogin() {
  const { data, error } = await window.lfcSupabase.auth.getUser();

  if (error || !data.user) {
    document.getElementById("authStatus").innerHTML =
      'Nicht eingeloggt. <a href="login.html">Zum Login</a>';
    return false;
  }

  const { data: profile } = await window.lfcSupabase
    .from("profiles")
    .select("role,is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active || !["employee", "manager", "admin"].includes(profile.role)) {
    document.getElementById("authStatus").innerHTML =
      "Eingeloggt, aber kein Zugriff auf die Verwaltung.";
    return false;
  }

  currentUserRole = profile.role;

  document.getElementById("authStatus").textContent =
    `✅ Eingeloggt als ${data.user.email} (${profile.role})`;

  if (currentUserRole !== "admin") {
    document.querySelectorAll(".admin-only-tab").forEach((el) => {
      el.style.display = "none";
    });
  }

  return true;
}

/* =========================================================
   KATALOG
   ========================================================= */

async function loadVehicles() {
  const c = document.getElementById("content");
  c.innerHTML = "Lade Katalog…";
  setAdminStatus("");

  try {
    await loadVehicleGroups();

    const { data, error } = await window.lfcSupabase
      .from("vehicle_catalog_entries")
      .select(`
        id,
        craft_key,
        display_name,
        blueprint_name,
        description,
        price,
        group_id,
        trunk_size,
        is_visible,
        sort_order,
        vehicle_images (
          id,
          image_url,
          sort_order,
          is_primary
        )
      `)
      .order("display_name", { ascending: true });

    if (error) throw error;

    c.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Fahrzeug</th>
            <th>Gruppe</th>
            <th>Preis</th>
            <th>Sichtbar</th>
            <th>Beschreibung</th>
            <th>Kofferraum</th>
            <th>Bilder</th>
            <th>Aktion</th>
          </tr>
        </thead>
        <tbody>
          ${(data || [])
            .map((v) => {
              const imageText = imagesToTextarea(v.vehicle_images || []);

              return `
                <tr data-id="${escHtml(v.id)}">
                  <td>
                    <div class="small">${escHtml(v.craft_key)}</div>

                    <div class="small">Anzeigename / Katalogtitel</div>
                    ${input(v.display_name || "", "display_name")}

                    <div class="small">
                      Dieser Anzeigename wird im öffentlichen Katalog als <strong>shop-card-title</strong> verwendet.
                    </div>

                    <div class="small">Bauplan</div>
                    ${input(v.blueprint_name || "", "blueprint_name")}
                  </td>

                  <td>
                    <div class="small">Gruppe</div>
                    <select class="input" data-name="group_id">
                      ${renderGroupOptions(v.group_id)}
                    </select>
                    <div class="small">
                      Fahrzeuge ohne Gruppe werden im öffentlichen Katalog nicht angezeigt.
                    </div>
                  </td>

                  <td>
                    <div class="small">Preis</div>
                    ${input(v.price ?? 0, "price", "number")}

                    <div class="small">Sortierung</div>
                    ${input(v.sort_order ?? 1000, "sort_order", "number")}
                  </td>

                  <td>
                    <label class="small">
                      <input data-name="is_visible" type="checkbox" ${v.is_visible ? "checked" : ""}>
                      sichtbar
                    </label>
                  </td>

                  <td>
                    ${textarea(v.description || "", "description")}
                  </td>

                  <td>
                    ${input(v.trunk_size || "", "trunk_size")}
                  </td>

                  <td class="img-editor">
                    <div class="small">
                      Bild-URLs, eine URL pro Zeile.<br>
                      Nur https:// Links sind gültig.<br>
                      Erstes Bild = Hauptbild.
                    </div>

                    <textarea class="input imageUrls" data-name="_image_urls">${escHtml(imageText)}</textarea>

                    <div class="imagePreview">
                      ${renderImagePreview(imageText)}
                    </div>
                  </td>

                  <td>
                    <div class="admin-row-actions">
                      <button class="btn previewImages" type="button">Vorschau</button>
                      <button class="btn saveVehicle" type="button">Speichern</button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;

    document.querySelectorAll(".saveVehicle").forEach((btn) => {
      btn.onclick = saveVehicle;
    });

    document.querySelectorAll(".previewImages").forEach((btn) => {
      btn.onclick = updateImagePreviewForRow;
    });

    document.querySelectorAll(".imageUrls").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        const tr = textarea.closest("tr");
        updateImagePreview(tr);
      });
    });
  } catch (error) {
    console.error(error);
    c.textContent = "Fehler: " + (error.message || String(error));
  }
}

function updateImagePreviewForRow(e) {
  const tr = e.target.closest("tr");
  updateImagePreview(tr);
}

function updateImagePreview(tr) {
  if (!tr) return;

  const textarea = tr.querySelector(".imageUrls");
  const preview = tr.querySelector(".imagePreview");

  if (!textarea || !preview) return;

  preview.innerHTML = renderImagePreview(textarea.value);
}

async function saveVehicle(e) {
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;

  const vehicleUpdate = {};

  tr.querySelectorAll("[data-name]").forEach((el) => {
    const name = el.dataset.name;

    if (name === "_image_urls") return;

    if (el.type === "checkbox") {
      vehicleUpdate[name] = el.checked;
    } else if (name === "price") {
      vehicleUpdate[name] = Number(el.value || 0);
    } else if (name === "sort_order") {
      vehicleUpdate[name] = Number(el.value || 1000);
    } else if (name === "group_id") {
      vehicleUpdate[name] = el.value ? el.value : null;
    } else {
      vehicleUpdate[name] = el.value;
    }
  });

  const imageTextarea = tr.querySelector('[data-name="_image_urls"]');
  const rawImageLines = String(imageTextarea ? imageTextarea.value : "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const invalidImageLines = rawImageLines.filter((url) => !/^https:\/\//i.test(url));

  if (invalidImageLines.length) {
    alert(
      "Es sind ungültige Bildlinks vorhanden.\n\n" +
      "Erlaubt sind nur Links, die mit https:// beginnen.\n\n" +
      invalidImageLines.join("\n")
    );
    return;
  }

  const imageUrls = parseImageTextarea(imageTextarea ? imageTextarea.value : "");

  const saveButton = e.target;
  saveButton.disabled = true;
  saveButton.textContent = "Speichere…";
  setAdminStatus("");

  try {
    const { data: updatedRows, error: vehicleError } = await window.lfcSupabase
      .from("vehicle_catalog_entries")
      .update(vehicleUpdate)
      .eq("id", id)
      .select("id, display_name, group_id")
      .maybeSingle();

    if (vehicleError) throw vehicleError;

    if (!updatedRows) {
      throw new Error(
        "Fahrzeug wurde nicht aktualisiert. Wahrscheinlich blockiert RLS die Änderung oder die ID wurde nicht gefunden."
      );
    }

    const { error: deleteImagesError } = await window.lfcSupabase
      .from("vehicle_images")
      .delete()
      .eq("vehicle_catalog_entry_id", id);

    if (deleteImagesError) throw deleteImagesError;

    if (imageUrls.length) {
      const imageRows = imageUrls.map((url, index) => ({
        vehicle_catalog_entry_id: id,
        image_url: url,
        sort_order: index + 1,
        is_primary: index === 0
      }));

      const { error: insertImagesError } = await window.lfcSupabase
        .from("vehicle_images")
        .insert(imageRows);

      if (insertImagesError) throw insertImagesError;
    }

    setAdminStatus("✅ Fahrzeug, Gruppe und Bilder gespeichert.");
    updateImagePreview(tr);
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern.");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Speichern";
  }
}

/* =========================================================
   AUFTRÄGE
   ========================================================= */

function orderItemsSummary(order) {
  const items = order.order_items || [];

  if (!items.length) {
    return order.production_summary || order.public_info || "";
  }

  return items
    .map((item) => {
      const qty = Number(item.quantity || 1);
      return (qty !== 1 ? qty + "× " : "") + (item.title || "");
    })
    .filter(Boolean)
    .join(", ");
}

function buildOrdersTable(data, mode) {
  const isFinishedMode = mode === "finished";
  const canEditAll = currentUserRole === "admin" && isFinishedMode;

  return `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Bestell-Datum</th>
          <th>Bestellnummer</th>
          <th>Kunden-Namen</th>
          <th>Was wird hergestellt</th>
          <th>Status</th>
          <th>Anzahlung</th>
          <th>Anzahlungs-Betrag</th>
          <th>Anzahlung erhalten?</th>
          <th>Wer ist zuständig?</th>
          <th>Gesamtbetrag Rechnung</th>
          <th>Restbetrag Rechnung</th>
          <th>Zusätzliche Infos</th>
          <th>Rechnungsstatus</th>
          <th>Aktion</th>
        </tr>
      </thead>
      <tbody>
        ${(data || [])
          .map((o) => {
            const summary = orderItemsSummary(o);
            const rowEditableAll = canEditAll;
            const openEditable = !isFinishedMode;

            return `
              <tr data-id="${escHtml(o.id)}">
                <td>
                  ${
                    rowEditableAll
                      ? input(formatDateInput(o.created_at), "created_at", "datetime-local")
                      : escHtml(formatDate(o.created_at))
                  }
                </td>

                <td>
                  ${
                    rowEditableAll
                      ? input(o.order_number || "", "order_number")
                      : `<strong>${escHtml(o.order_number || "")}</strong>`
                  }
                </td>

                <td>
                  ${
                    rowEditableAll
                      ? input(o.customer_name || "", "customer_name")
                      : escHtml(o.customer_name || "")
                  }
                </td>

                <td>
                  ${
                    rowEditableAll
                      ? textarea(o.production_summary || summary || "", "production_summary")
                      : escHtml(summary || "")
                  }
                </td>

                <td>
                  ${
                    openEditable || rowEditableAll
                      ? `<select class="input" data-name="status">${renderStatusOptions(o.status)}</select>`
                      : escHtml(o.status || "")
                  }
                </td>

                <td>
                  ${
                    openEditable || rowEditableAll
                      ? `<label class="small"><input data-name="deposit_required" type="checkbox" ${o.deposit_required ? "checked" : ""}> ja</label>`
                      : o.deposit_required
                        ? "Ja"
                        : "Nein"
                  }
                </td>

                <td>
                  ${
                    rowEditableAll
                      ? input(o.deposit_amount ?? 0, "deposit_amount", "number")
                      : euro(o.deposit_amount || 0)
                  }
                </td>

                <td>
                  ${
                    openEditable || rowEditableAll
                      ? `<label class="small"><input data-name="deposit_received" type="checkbox" ${o.deposit_received ? "checked" : ""}> erhalten</label>`
                      : o.deposit_received
                        ? "Ja"
                        : "Nein"
                  }
                </td>

                <td>
                  ${
                    openEditable || rowEditableAll
                      ? `<select class="input" data-name="assigned_to">${renderProfileOptions(o.assigned_to)}</select>`
                      : escHtml(
                          profilesCache.find((p) => p.id === o.assigned_to)?.display_name ||
                          profilesCache.find((p) => p.id === o.assigned_to)?.email ||
                          ""
                        )
                  }
                </td>

                <td>
                  ${
                    rowEditableAll
                      ? input(o.invoice_total ?? o.total_price ?? 0, "invoice_total", "number")
                      : euro(o.invoice_total || o.total_price || 0)
                  }
                </td>

                <td>
                  ${
                    rowEditableAll
                      ? input(o.invoice_remaining ?? 0, "invoice_remaining", "number")
                      : euro(o.invoice_remaining || 0)
                  }
                </td>

                <td>
                  ${
                    openEditable || rowEditableAll
                      ? textarea(o.public_info || "", "public_info")
                      : escHtml(o.public_info || "")
                  }
                </td>

                <td>
                  ${
                    rowEditableAll
                      ? input(o.invoice_status || "", "invoice_status")
                      : escHtml(o.invoice_status || "")
                  }
                </td>

                <td>
                  ${
                    openEditable || rowEditableAll
                      ? `<button class="btn saveOrder" type="button" data-mode="${mode}">Speichern</button>`
                      : ""
                  }
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

async function loadOrdersByMode(mode) {
  const c = document.getElementById("content");
  const isFinishedMode = mode === "finished";

  c.innerHTML = isFinishedMode ? "Lade fertige Aufträge…" : "Lade offene Aufträge…";
  setAdminStatus("");

  if (isFinishedMode && currentUserRole !== "admin") {
    c.innerHTML = "Fertige Aufträge dürfen nur von Admins geöffnet werden.";
    return;
  }

  try {
    await loadProfiles();

    let query = window.lfcSupabase
      .from("orders")
      .select(`
        id,
        created_at,
        order_number,
        customer_name,
        customer_contact,
        production_summary,
        status,
        deposit_required,
        deposit_amount,
        deposit_received,
        assigned_to,
        invoice_total,
        invoice_remaining,
        total_price,
        public_info,
        public_status_label,
        invoice_status,
        internal_notes,
        order_items (
          id,
          title,
          quantity,
          unit_price,
          total_price
        )
      `)
      .order("created_at", { ascending: false });

    if (isFinishedMode) {
      query = query.in("status", FINISHED_STATUSES);
    } else {
      query = query.not("status", "in", `(${FINISHED_STATUSES.join(",")})`);
    }

    const { data, error } = await query.limit(500);

    if (error) throw error;

    c.innerHTML = buildOrdersTable(data || [], mode);

    document.querySelectorAll(".saveOrder").forEach((btn) => {
      btn.onclick = saveOrder;
    });
  } catch (error) {
    console.error(error);
    c.textContent = "Fehler: " + (error.message || String(error));
  }
}

async function saveOrder(e) {
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;
  const mode = e.target.dataset.mode || "open";
  const isFinishedMode = mode === "finished";

  const obj = {};

  tr.querySelectorAll("[data-name]").forEach((el) => {
    const name = el.dataset.name;

    if (el.type === "checkbox") {
      obj[name] = el.checked;
    } else if (
      [
        "deposit_amount",
        "invoice_total",
        "invoice_remaining"
      ].includes(name)
    ) {
      obj[name] = Number(el.value || 0);
    } else if (name === "assigned_to") {
      obj[name] = el.value ? el.value : null;
    } else if (name === "created_at") {
      obj[name] = el.value ? new Date(el.value).toISOString() : null;
    } else {
      obj[name] = el.value;
    }
  });

  if (!isFinishedMode && currentUserRole !== "admin") {
    const allowed = [
      "deposit_required",
      "deposit_received",
      "assigned_to",
      "status",
      "public_info"
    ];

    Object.keys(obj).forEach((key) => {
      if (!allowed.includes(key)) delete obj[key];
    });
  }

  const saveButton = e.target;
  saveButton.disabled = true;
  saveButton.textContent = "Speichere…";
  setAdminStatus("");

  try {
    const { data, error } = await window.lfcSupabase
      .from("orders")
      .update(obj)
      .eq("id", id)
      .select("id, order_number, status")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error("Auftrag wurde nicht aktualisiert. Prüfe RLS/Rechte.");
    }

    setAdminStatus("✅ Auftrag gespeichert: " + data.order_number);

    if (
      currentTab === "openOrders" &&
      FINISHED_STATUSES.includes(data.status)
    ) {
      await loadOrdersByMode("open");
    }
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern des Auftrags.");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Speichern";
  }
}

/* =========================================================
   KONTAKTANFRAGEN
   ========================================================= */

async function loadContacts() {
  const c = document.getElementById("content");
  c.innerHTML = "Lade Anfragen…";
  setAdminStatus("");

  const { data, error } = await window.lfcSupabase
    .from("contact_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    c.textContent = "Fehler: " + error.message;
    return;
  }

  c.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Zeit</th>
          <th>Name</th>
          <th>Betreff</th>
          <th>Nachricht</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${(data || [])
          .map((r) => `
            <tr>
              <td>${new Date(r.created_at).toLocaleString("de-DE")}</td>
              <td>${escHtml(r.name)}</td>
              <td>${escHtml(r.subject)}</td>
              <td><pre>${escHtml(r.message)}</pre></td>
              <td>${escHtml(r.status)}</td>
            </tr>
          `)
          .join("")}
      </tbody>
    </table>
  `;
}

/* =========================================================
   TABS
   ========================================================= */

async function loadTab() {
  if (currentTab === "vehicles") return loadVehicles();
  if (currentTab === "openOrders") return loadOrdersByMode("open");
  if (currentTab === "finishedOrders") return loadOrdersByMode("finished");
  if (currentTab === "contacts") return loadContacts();

  return loadVehicles();
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".tab").forEach((button) => {
    button.onclick = () => {
      if (button.dataset.tab === "finishedOrders" && currentUserRole !== "admin") {
        alert("Fertige Aufträge dürfen nur von Admins geöffnet werden.");
        return;
      }

      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      button.classList.add("active");
      currentTab = button.dataset.tab;
      loadTab();
    };
  });

  if (await requireLogin()) {
    loadTab();
  }
});
