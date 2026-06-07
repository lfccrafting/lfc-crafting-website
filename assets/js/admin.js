let currentTab = "vehicles";

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

function input(value, name, type = "text") {
  return `<input class="input" data-name="${name}" type="${type}" value="${escHtml(value ?? "")}">`;
}

function setAdminStatus(message, type = "") {
  const el = document.getElementById("adminStatus");
  if (!el) return;

  el.textContent = message || "";
  el.className = "status-line small";

  if (type) el.classList.add(type);
}

function normalizePreviewImageUrl(url) {
  const s = String(url || "").trim();

  if (!s) return "";

  // Nur HTTPS-Bildlinks sind gültig.
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

  document.getElementById("authStatus").textContent =
    `✅ Eingeloggt als ${data.user.email} (${profile.role})`;

  return true;
}

async function loadVehicles() {
  const c = document.getElementById("content");
  c.innerHTML = "Lade Katalog…";
  setAdminStatus("");

  const { data, error } = await window.lfcSupabase
    .from("vehicle_catalog_entries")
    .select(`
      id,
      craft_key,
      display_name,
      blueprint_name,
      description,
      price,
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

  if (error) {
    c.textContent = "Fehler: " + error.message;
    return;
  }

  c.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Name</th>
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

                  <div class="small">Anzeigename</div>
                  ${input(v.display_name || "", "display_name")}

                  <div class="small">Bauplan</div>
                  ${input(v.blueprint_name || "", "blueprint_name")}
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
                  <textarea class="input" data-name="description">${escHtml(v.description || "")}</textarea>
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
    const { error: vehicleError } = await window.lfcSupabase
      .from("vehicle_catalog_entries")
      .update(vehicleUpdate)
      .eq("id", id);

    if (vehicleError) throw vehicleError;

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

    setAdminStatus("✅ Fahrzeug und Bilder gespeichert.");
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

async function loadOrders() {
  const c = document.getElementById("content");
  c.innerHTML = "Lade Aufträge…";
  setAdminStatus("");

  const { data, error } = await window.lfcSupabase
    .from("orders")
    .select(`
      id,
      created_at,
      order_number,
      status,
      public_info,
      public_status_label,
      customer_name,
      customer_contact,
      internal_notes,
      total_price
    `)
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
          <th>Auftrag</th>
          <th>Kunde</th>
          <th>Status</th>
          <th>Info</th>
          <th>Notizen</th>
          <th>Aktion</th>
        </tr>
      </thead>
      <tbody>
        ${(data || [])
          .map((o) => `
            <tr data-id="${escHtml(o.id)}">
              <td>
                <strong>${escHtml(o.order_number)}</strong>
                <div class="small">${new Date(o.created_at).toLocaleString("de-DE")}</div>
              </td>

              <td>
                ${escHtml(o.customer_name || "")}<br>
                <span class="small">${escHtml(o.customer_contact || "")}</span>
              </td>

              <td>
                <select class="input" data-name="status">
                  ${[
                    "new",
                    "accepted",
                    "in_progress",
                    "waiting_for_customer",
                    "ready",
                    "completed",
                    "rejected",
                    "cancelled"
                  ]
                    .map((s) => `<option value="${s}" ${o.status === s ? "selected" : ""}>${s}</option>`)
                    .join("")}
                </select>
              </td>

              <td>
                <div class="small">Öffentliche Zusatzinfos</div>
                ${input(o.public_info || "", "public_info")}

                <div class="small">Öffentlicher Status-Text</div>
                ${input(o.public_status_label || "", "public_status_label")}
              </td>

              <td>
                <textarea class="input" data-name="internal_notes">${escHtml(o.internal_notes || "")}</textarea>
              </td>

              <td>
                <button class="btn saveOrder" type="button">Speichern</button>
              </td>
            </tr>
          `)
          .join("")}
      </tbody>
    </table>
  `;

  document.querySelectorAll(".saveOrder").forEach((btn) => {
    btn.onclick = saveOrder;
  });
}

async function saveOrder(e) {
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;
  const obj = {};

  tr.querySelectorAll("[data-name]").forEach((el) => {
    obj[el.dataset.name] = el.value;
  });

  const saveButton = e.target;
  saveButton.disabled = true;
  saveButton.textContent = "Speichere…";

  try {
    const { error } = await window.lfcSupabase
      .from("orders")
      .update(obj)
      .eq("id", id);

    if (error) throw error;

    setAdminStatus("✅ Auftrag gespeichert.");
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern des Auftrags.");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Speichern";
  }
}

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

async function loadTab() {
  if (currentTab === "vehicles") return loadVehicles();
  if (currentTab === "orders") return loadOrders();
  if (currentTab === "contacts") return loadContacts();

  return loadVehicles();
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".tab").forEach((button) => {
    button.onclick = () => {
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
