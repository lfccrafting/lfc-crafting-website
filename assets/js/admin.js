let currentTab = "vehicles";
let vehicleGroupsCache = [];
let orderProductsCache = [];
let orderUpgradeCache = [];
let currentUserRole = null;

const FINISHED_STATUSES = ["completed", "cancelled", "rejected"];

const ORDER_STATUS_OPTIONS = [
  { label: "Bestellung ist eingegangen", status: "new", publicLabel: "Bestellung ist eingegangen" },
  { label: "Warte auf Anzahlung", status: "waiting_for_customer", publicLabel: "Warte auf Anzahlung" },
  { label: "In Warteschlange", status: "accepted", publicLabel: "In Warteschlange" },
  { label: "In Produktion", status: "in_progress", publicLabel: "In Produktion" },
  { label: "Abholbereit", status: "ready", publicLabel: "Abholbereit" },
  { label: "Storniert", status: "cancelled", publicLabel: "Storniert" }
];

const ROLE_OPTIONS = ["employee", "manager", "admin"];

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

function roleLevel(role) {
  if (role === "employee") return 1;
  if (role === "manager") return 2;
  if (role === "admin") return 3;
  return 0;
}

function canAccessRole(minRole) {
  return roleLevel(currentUserRole) >= roleLevel(minRole || "employee");
}

function applyTabVisibility() {
  document.querySelectorAll(".tab").forEach((tab) => {
    const minRole = tab.dataset.minRole || "employee";
    tab.style.display = canAccessRole(minRole) ? "" : "none";
  });

  const activeTab = document.querySelector(".tab.active");

  if (!activeTab || activeTab.style.display === "none") {
    const firstAllowed = Array.from(document.querySelectorAll(".tab"))
      .find((tab) => tab.style.display !== "none");

    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));

    if (firstAllowed) {
      firstAllowed.classList.add("active");
      currentTab = firstAllowed.dataset.tab;
    }
  }
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
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
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
      ${urls.slice(0, 10).map((url, index) => `
        <div class="img-preview-item" title="${escHtml(url)}">
          <span>${index + 1}${index === 0 ? " ★" : ""}</span>
          <img src="${escHtml(normalizePreviewImageUrl(url))}" alt="" loading="lazy" onerror="this.style.opacity='.25'">
        </div>
      `).join("")}
    </div>
  `;
}

function renderGroupOptions(selectedGroupId) {
  const selected = selectedGroupId ? String(selectedGroupId) : "";

  return `
    <option value="">Ohne Gruppe</option>
    ${vehicleGroupsCache.map((g) => {
      const id = String(g.id);
      return `<option value="${escHtml(id)}" ${id === selected ? "selected" : ""}>${escHtml(g.name)}</option>`;
    }).join("")}
  `;
}

function optionKey(status, publicLabel) {
  const found = ORDER_STATUS_OPTIONS.find((x) => x.status === status && x.publicLabel === publicLabel);
  if (found) return found.label;

  const fallback = ORDER_STATUS_OPTIONS.find((x) => x.status === status);
  return fallback ? fallback.label : "Bestellung ist eingegangen";
}

function renderStatusOptions(status, publicLabel) {
  const selectedKey = optionKey(status, publicLabel);

  return ORDER_STATUS_OPTIONS.map((x) => `
    <option value="${escHtml(x.label)}" ${selectedKey === x.label ? "selected" : ""}>
      ${escHtml(x.label)}
    </option>
  `).join("");
}

function getStatusPayloadFromLabel(label) {
  const found = ORDER_STATUS_OPTIONS.find((x) => x.label === label) || ORDER_STATUS_OPTIONS[0];

  return {
    status: found.status,
    public_status_label: found.publicLabel
  };
}

function calcRemaining(invoiceTotal, depositRequired, depositAmount) {
  const total = Number(invoiceTotal || 0);
  const deposit = depositRequired ? Number(depositAmount || 0) : 0;
  return Math.max(0, total - deposit);
}

function recalcOrderRowRemaining(tr) {
  if (!tr) return;

  const invoiceTotalEl = tr.querySelector('[data-name="invoice_total"]');
  const depositRequiredEl = tr.querySelector('[data-name="deposit_required"]');
  const depositAmountEl = tr.querySelector('[data-name="deposit_amount"]');
  const remainingEl = tr.querySelector('[data-role="invoice_remaining_display"]');

  if (!remainingEl) return;

  const invoiceTotal = invoiceTotalEl ? Number(invoiceTotalEl.value || 0) : Number(tr.dataset.invoiceTotal || 0);
  const depositRequired = depositRequiredEl ? depositRequiredEl.checked : String(tr.dataset.depositRequired || "false") === "true";
  const depositAmount = depositAmountEl ? Number(depositAmountEl.value || 0) : Number(tr.dataset.depositAmount || 0);

  remainingEl.textContent = euro(calcRemaining(invoiceTotal, depositRequired, depositAmount));
}

function bindOrderCalculationEvents() {
  document.querySelectorAll(".orders-table tbody tr").forEach((tr) => {
    ["invoice_total", "deposit_amount", "deposit_required"].forEach((name) => {
      const el = tr.querySelector(`[data-name="${name}"]`);
      if (!el) return;
      el.addEventListener("input", () => recalcOrderRowRemaining(tr));
      el.addEventListener("change", () => recalcOrderRowRemaining(tr));
    });

    recalcOrderRowRemaining(tr);
  });
}

function generateOrderNumber() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return "LFC-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

async function triggerDiscordNotify() {
  try {
    await fetch(`${window.LFC_SUPABASE_CONFIG.url}/functions/v1/discord-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode: "queue" })
    });
  } catch (error) {
    console.warn("Discord Notify konnte nicht ausgelöst werden:", error);
  }
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

async function loadOrderProducts() {
  const { data, error } = await window.lfcSupabase
    .from("vehicle_catalog_entries")
    .select("id,craft_key,display_name,price,is_visible,group_id")
    .order("display_name", { ascending: true });

  if (error) throw error;

  const all = (data || []).filter((x) => x.group_id);

  orderProductsCache = all.filter((x) => {
    const name = String(x.display_name || "").toLowerCase();
    return !name.includes("upgrade") && !name.includes("→") && !name.includes(" zu ");
  });

  orderUpgradeCache = all.filter((x) => !orderProductsCache.includes(x));

  if (!orderUpgradeCache.length) {
    orderUpgradeCache = all;
  }
}

async function loadDefaultDepositPercent() {
  const { data, error } = await window.lfcSupabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", "default_deposit_percent")
    .maybeSingle();

  if (error || !data) return 15;

  const raw = data.setting_value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 15;
}

async function requireLogin() {
  const { data, error } = await window.lfcSupabase.auth.getUser();

  if (error || !data.user) {
    document.getElementById("authStatus").innerHTML = 'Nicht eingeloggt. <a href="login.html">Zum Login</a>';
    return false;
  }

  const { data: profile } = await window.lfcSupabase
    .from("profiles")
    .select("role,is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active || !["employee", "manager", "admin"].includes(profile.role)) {
    document.getElementById("authStatus").innerHTML = "Eingeloggt, aber kein Zugriff auf die Verwaltung.";
    return false;
  }

  currentUserRole = profile.role;
  document.getElementById("authStatus").textContent = `✅ Eingeloggt als ${data.user.email} (${profile.role})`;
  applyTabVisibility();
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
          ${(data || []).map((v) => {
            const imageText = imagesToTextarea(v.vehicle_images || "");

            return `
              <tr data-id="${escHtml(v.id)}">
                <td>
                  <div class="small">${escHtml(v.craft_key)}</div>
                  <div class="small">Anzeigename / Katalogtitel</div>
                  ${input(v.display_name || "", "display_name")}
                  <div class="small">Dieser Anzeigename wird im öffentlichen Katalog als <strong>shop-card-title</strong> verwendet.</div>
                  <div class="small">Bauplan</div>
                  ${input(v.blueprint_name || "", "blueprint_name")}
                </td>

                <td>
                  <div class="small">Gruppe</div>
                  <select class="input" data-name="group_id">${renderGroupOptions(v.group_id)}</select>
                  <div class="small">Fahrzeuge ohne Gruppe werden im öffentlichen Katalog nicht angezeigt.</div>
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

                <td>${textarea(v.description || "", "description")}</td>
                <td>${input(v.trunk_size || "", "trunk_size")}</td>

                <td class="img-editor">
                  <div class="small">Bild-URLs, eine URL pro Zeile.<br>Nur https:// Links sind gültig.<br>Erstes Bild = Hauptbild.</div>
                  <textarea class="input imageUrls" data-name="_image_urls">${escHtml(imageText)}</textarea>
                  <div class="imagePreview">${renderImagePreview(imageText)}</div>
                </td>

                <td>
                  <div class="admin-row-actions">
                    <button class="btn previewImages" type="button">Vorschau</button>
                    <button class="btn saveVehicle" type="button">Speichern</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;

    document.querySelectorAll(".saveVehicle").forEach((btn) => btn.onclick = saveVehicle);
    document.querySelectorAll(".previewImages").forEach((btn) => btn.onclick = updateImagePreviewForRow);

    document.querySelectorAll(".imageUrls").forEach((textareaEl) => {
      textareaEl.addEventListener("input", () => {
        updateImagePreview(textareaEl.closest("tr"));
      });
    });
  } catch (error) {
    console.error(error);
    c.textContent = "Fehler: " + (error.message || String(error));
  }
}

function updateImagePreviewForRow(e) {
  updateImagePreview(e.target.closest("tr"));
}

function updateImagePreview(tr) {
  if (!tr) return;

  const textareaEl = tr.querySelector(".imageUrls");
  const preview = tr.querySelector(".imagePreview");

  if (!textareaEl || !preview) return;

  preview.innerHTML = renderImagePreview(textareaEl.value);
}

async function saveVehicle(e) {
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;
  const vehicleUpdate = {};

  tr.querySelectorAll("[data-name]").forEach((el) => {
    const name = el.dataset.name;
    if (name === "_image_urls") return;

    if (el.type === "checkbox") vehicleUpdate[name] = el.checked;
    else if (name === "price") vehicleUpdate[name] = Number(el.value || 0);
    else if (name === "sort_order") vehicleUpdate[name] = Number(el.value || 1000);
    else if (name === "group_id") vehicleUpdate[name] = el.value ? el.value : null;
    else vehicleUpdate[name] = el.value;
  });

  const imageTextarea = tr.querySelector('[data-name="_image_urls"]');
  const rawImageLines = String(imageTextarea ? imageTextarea.value : "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const invalidImageLines = rawImageLines.filter((url) => !/^https:\/\//i.test(url));

  if (invalidImageLines.length) {
    alert("Es sind ungültige Bildlinks vorhanden.\n\nErlaubt sind nur Links, die mit https:// beginnen.\n\n" + invalidImageLines.join("\n"));
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
      throw new Error("Fahrzeug wurde nicht aktualisiert. Wahrscheinlich blockiert RLS die Änderung oder die ID wurde nicht gefunden.");
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
   NEUER AUFTRAG
========================================================= */

async function loadNewOrder() {
  const c = document.getElementById("content");
  c.innerHTML = "Lade Formular…";
  setAdminStatus("");

  try {
    await loadOrderProducts();

    c.innerHTML = `
      <section class="bt-card order-create-card">
        <h2>Neuen Auftrag erstellen</h2>

        <form id="newOrderForm" class="shop-form">
          <div class="order-create-grid">
            <div class="shop-field">
              <label for="newOrderCustomerName">Kundenname *</label>
              <input class="input" id="newOrderCustomerName" type="text" required placeholder="Kundenname">
            </div>

            <div class="shop-field">
              <label>Auftragsart</label>
              <select class="input" id="newOrderType">
                <option value="new">Neuwagen</option>
                <option value="upgrade">Upgrade</option>
              </select>
            </div>

            <div class="shop-field">
              <label for="newOrderProductSearch">Was wird hergestellt? *</label>
              <input class="input" id="newOrderProductSearch" list="orderProductList" required placeholder="Auswahl suchen…">
              <datalist id="orderProductList"></datalist>
              <div class="small" id="newOrderProductInfo">Bitte Auswahl treffen.</div>
            </div>
          </div>

          <div class="shop-field">
            <label for="newOrderPublicInfo">Zusätzliche Infos</label>
            <textarea class="input" id="newOrderPublicInfo" placeholder="Zusätzliche Infos für die öffentliche Bestellübersicht"></textarea>
          </div>

          <div class="bt-hint" id="newOrderSummary">Noch keine Auswahl getroffen.</div>

          <div class="shop-form-actions">
            <button class="btn" id="newOrderSubmit" type="submit">Auftrag erstellen</button>
          </div>
        </form>
      </section>
    `;

    document.getElementById("newOrderType").addEventListener("change", refreshNewOrderOptions);
    document.getElementById("newOrderProductSearch").addEventListener("input", updateNewOrderSummary);
    document.getElementById("newOrderForm").addEventListener("submit", submitNewOrder);

    refreshNewOrderOptions();
  } catch (error) {
    console.error(error);
    c.textContent = "Fehler: " + (error.message || String(error));
  }
}

function currentNewOrderList() {
  const type = document.getElementById("newOrderType")?.value || "new";
  return type === "upgrade" ? orderUpgradeCache : orderProductsCache;
}

function refreshNewOrderOptions() {
  const list = currentNewOrderList();
  const datalist = document.getElementById("orderProductList");
  const search = document.getElementById("newOrderProductSearch");

  if (search) search.value = "";

  datalist.innerHTML = list.map((p) => {
    const label = `${p.display_name} (${p.craft_key})`;
    return `<option value="${escHtml(label)}"></option>`;
  }).join("");

  updateNewOrderSummary();
}

function findSelectedOrderProduct() {
  const value = String(document.getElementById("newOrderProductSearch")?.value || "").trim();
  if (!value) return null;

  return currentNewOrderList().find((p) => {
    const label = `${p.display_name} (${p.craft_key})`;
    return label === value || p.display_name === value || p.craft_key === value;
  }) || null;
}

async function updateNewOrderSummary() {
  const product = findSelectedOrderProduct();
  const info = document.getElementById("newOrderProductInfo");
  const summary = document.getElementById("newOrderSummary");
  const type = document.getElementById("newOrderType")?.value || "new";

  if (!product) {
    info.textContent = type === "upgrade" ? "Kein gültiges Upgrade ausgewählt." : "Kein gültiger Neuwagen ausgewählt.";
    summary.textContent = "Noch keine Auswahl getroffen.";
    return;
  }

  const depositPercent = await loadDefaultDepositPercent();
  const total = Number(product.price || 0);
  const deposit = Math.round(total * (depositPercent / 100));
  const remaining = calcRemaining(total, false, deposit);

  info.textContent = `Ausgewählt: ${product.display_name}`;

  summary.innerHTML =
    `<strong>${escHtml(product.display_name)}</strong><br>` +
    `Auftragsart: <strong>${type === "upgrade" ? "Upgrade" : "Neuwagen"}</strong><br>` +
    `Gesamtbetrag: <strong>${escHtml(euro(total))}</strong><br>` +
    `Anzahlung wird nicht automatisch aktiviert.<br>` +
    `Möglicher Anzahlungsbetrag (${depositPercent}%): <strong>${escHtml(euro(deposit))}</strong><br>` +
    `Restbetrag aktuell: <strong>${escHtml(euro(remaining))}</strong>`;
}

async function submitNewOrder(e) {
  e.preventDefault();

  const customerName = document.getElementById("newOrderCustomerName").value.trim();
  const publicInfo = document.getElementById("newOrderPublicInfo").value.trim();
  const product = findSelectedOrderProduct();
  const type = document.getElementById("newOrderType")?.value || "new";

  if (!customerName) {
    alert("Bitte Kundenname eintragen.");
    return;
  }

  if (!product) {
    alert("Bitte eine gültige Auswahl treffen.");
    return;
  }

  const submitButton = document.getElementById("newOrderSubmit");
  submitButton.disabled = true;
  submitButton.textContent = "Erstelle…";
  setAdminStatus("");

  try {
    const depositPercent = await loadDefaultDepositPercent();
    const total = Number(product.price || 0);
    const deposit = Math.round(total * (depositPercent / 100));
    const depositRequired = false;
    const remaining = calcRemaining(total, depositRequired, deposit);
    const orderNumber = generateOrderNumber();

    const productionSummary =
      type === "upgrade"
        ? "Upgrade: " + product.display_name
        : product.display_name;

    const { data: order, error: orderError } = await window.lfcSupabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        customer_name: customerName,
        production_summary: productionSummary,
        status: "new",
        public_status_label: "Bestellung ist eingegangen",
        public_info: publicInfo,
        total_price: total,
        invoice_total: total,
        deposit_required: depositRequired,
        deposit_amount: deposit,
        invoice_remaining: remaining,
        invoice_paid: false,
        admin_hidden: false,
        source: "admin"
      })
      .select("id, order_number")
      .single();

    if (orderError) throw orderError;

    const { error: itemError } = await window.lfcSupabase
      .from("order_items")
      .insert({
        order_id: order.id,
        item_type: type === "upgrade" ? "vehicle_upgrade" : "vehicle",
        vehicle_catalog_entry_id: product.id,
        title: productionSummary,
        quantity: 1,
        unit_price: total,
        total_price: total
      });

    if (itemError) throw itemError;

    setAdminStatus("✅ Auftrag erstellt: " + order.order_number);

    currentTab = "openOrders";
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    const openTab = document.querySelector('.tab[data-tab="openOrders"]');
    if (openTab) openTab.classList.add("active");

    await loadOrdersByMode("open");
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Auftrag konnte nicht erstellt werden.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Auftrag erstellen";
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
    <table class="admin-table orders-table">
      <thead>
        <tr>
          <th>Bestell-Datum</th>
          <th>Bestellnummer</th>
          <th>Kunden-Namen</th>
          <th>Was wird hergestellt</th>
          <th>Status</th>
          <th>Anzahlung</th>
          <th>Anzahlungs-Betrag</th>
          <th>Wer ist zuständig?</th>
          <th>Gesamtbetrag Rechnung</th>
          <th>Restbetrag Rechnung</th>
          <th>Zusätzliche Infos</th>
          <th>Rechnung bezahlt?</th>
          <th>Aktion</th>
        </tr>
      </thead>

      <tbody>
        ${(data || []).map((o) => {
          const summary = orderItemsSummary(o);
          const rowEditableAll = canEditAll;
          const openEditable = !isFinishedMode;
          const calculatedRemaining = calcRemaining(o.invoice_total || o.total_price || 0, o.deposit_required, o.deposit_amount || 0);

          return `
            <tr
              data-id="${escHtml(o.id)}"
              data-invoice-total="${escHtml(o.invoice_total || o.total_price || 0)}"
              data-deposit-required="${o.deposit_required ? "true" : "false"}"
              data-deposit-amount="${escHtml(o.deposit_amount || 0)}"
            >
              <td>${rowEditableAll ? input(formatDateInput(o.created_at), "created_at", "datetime-local") : escHtml(formatDate(o.created_at))}</td>
              <td>${rowEditableAll ? input(o.order_number || "", "order_number") : `<strong>${escHtml(o.order_number || "")}</strong>`}</td>
              <td>${rowEditableAll ? input(o.customer_name || "", "customer_name") : escHtml(o.customer_name || "")}</td>
              <td>${rowEditableAll ? textarea(o.production_summary || summary || "", "production_summary") : escHtml(summary || "")}</td>
              <td>${openEditable || rowEditableAll ? `<select class="input" data-name="_status_label">${renderStatusOptions(o.status, o.public_status_label)}</select>` : escHtml(o.public_status_label || o.status || "")}</td>
              <td>${openEditable || rowEditableAll ? `<label class="small"><input data-name="deposit_required" type="checkbox" ${o.deposit_required ? "checked" : ""}> ja</label>` : o.deposit_required ? "Ja" : "Nein"}</td>
              <td>${rowEditableAll ? input(o.deposit_amount ?? 0, "deposit_amount", "number") : euro(o.deposit_amount || 0)}</td>
              <td>${openEditable || rowEditableAll ? input(o.responsible_text || "", "responsible_text") : escHtml(o.responsible_text || "")}</td>
              <td>${rowEditableAll ? input(o.invoice_total ?? o.total_price ?? 0, "invoice_total", "number") : euro(o.invoice_total || o.total_price || 0)}</td>
              <td><strong data-role="invoice_remaining_display">${escHtml(euro(calculatedRemaining))}</strong></td>
              <td>${openEditable || rowEditableAll ? textarea(o.public_info || "", "public_info") : escHtml(o.public_info || "")}</td>
              <td>${openEditable || rowEditableAll ? `<label class="small"><input data-name="invoice_paid" type="checkbox" ${o.invoice_paid ? "checked" : ""}> bezahlt</label>` : o.invoice_paid ? "Ja" : "Nein"}</td>
              <td>
                ${openEditable || rowEditableAll ? `<button class="btn saveOrder" type="button" data-mode="${mode}">Speichern</button>` : ""}
                ${isFinishedMode && currentUserRole === "admin" ? `<button class="btn btn-danger hideFinishedOrder" type="button">Ausblenden</button>` : ""}
              </td>
            </tr>
          `;
        }).join("")}
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
        public_status_label,
        deposit_required,
        deposit_amount,
        responsible_text,
        invoice_total,
        invoice_remaining,
        invoice_paid,
        admin_hidden,
        total_price,
        public_info,
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
      query = query
        .eq("invoice_paid", true)
        .eq("admin_hidden", false);
    } else {
      query = query
        .eq("invoice_paid", false)
        .eq("admin_hidden", false);
    }

    const { data, error } = await query.limit(500);

    if (error) throw error;

    c.innerHTML = buildOrdersTable(data || [], mode);

    document.querySelectorAll(".saveOrder").forEach((btn) => btn.onclick = saveOrder);
    document.querySelectorAll(".hideFinishedOrder").forEach((btn) => btn.onclick = hideFinishedOrder);

    bindOrderCalculationEvents();
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

    if (name === "_status_label") {
      const payload = getStatusPayloadFromLabel(el.value);
      obj.status = payload.status;
      obj.public_status_label = payload.public_status_label;
      return;
    }

    if (el.type === "checkbox") obj[name] = el.checked;
    else if (["deposit_amount", "invoice_total"].includes(name)) obj[name] = Number(el.value || 0);
    else if (name === "created_at") obj[name] = el.value ? new Date(el.value).toISOString() : null;
    else obj[name] = el.value;
  });

  const invoiceTotalEl = tr.querySelector('[data-name="invoice_total"]');
  const depositRequiredEl = tr.querySelector('[data-name="deposit_required"]');
  const depositAmountEl = tr.querySelector('[data-name="deposit_amount"]');

  const invoiceTotal = invoiceTotalEl ? Number(invoiceTotalEl.value || 0) : Number(tr.dataset.invoiceTotal || 0);
  const depositRequired = depositRequiredEl ? depositRequiredEl.checked : String(tr.dataset.depositRequired || "false") === "true";
  const depositAmount = depositAmountEl ? Number(depositAmountEl.value || 0) : Number(tr.dataset.depositAmount || 0);

  obj.invoice_remaining = calcRemaining(invoiceTotal, depositRequired, depositAmount);

  if (!isFinishedMode && currentUserRole !== "admin") {
    const allowed = [
      "deposit_required",
      "responsible_text",
      "status",
      "public_status_label",
      "public_info",
      "invoice_paid"
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
      .select("id, order_number, status, public_status_label, invoice_paid")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Auftrag wurde nicht aktualisiert. Prüfe RLS/Rechte.");

    setAdminStatus("✅ Auftrag gespeichert: " + data.order_number);

    if (currentTab === "openOrders" && FINISHED_STATUSES.includes(data.status)) {
      await loadOrdersByMode("open");
    } else if (currentTab === "finishedOrders" && !FINISHED_STATUSES.includes(data.status)) {
      await loadOrdersByMode("finished");
    } else {
      recalcOrderRowRemaining(tr);
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

async function hideFinishedOrder(e) {
  if (currentUserRole !== "admin") {
    alert("Nur Admins dürfen fertige Aufträge ausblenden.");
    return;
  }

  const tr = e.target.closest("tr");
  const id = tr.dataset.id;

  if (!confirm("Diesen Auftrag aus der fertigen Auftragsübersicht ausblenden? Er bleibt in der Datenbank erhalten.")) return;

  const btn = e.target;
  btn.disabled = true;
  btn.textContent = "Blende aus…";
  setAdminStatus("");

  try {
    const { data, error } = await window.lfcSupabase
      .from("orders")
      .update({ admin_hidden: true })
      .eq("id", id)
      .select("id, order_number")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Auftrag konnte nicht ausgeblendet werden. Prüfe RLS/Rechte.");

    setAdminStatus("✅ Auftrag ausgeblendet: " + data.order_number);
    tr.remove();
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Ausblenden.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Ausblenden";
  }
}

/* =========================================================
   ANFRAGEN
========================================================= */

async function loadContacts() {
  const c = document.getElementById("content");
  c.innerHTML = "Lade Anfragen…";
  setAdminStatus("");

  const { data, error } = await window.lfcSupabase
    .from("contact_requests")
    .select("*")
    .eq("admin_hidden", false)
    .order("created_at", { ascending: false })
    .limit(300);

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
          <th>Mitarbeiter</th>
          <th>Aktion</th>
        </tr>
      </thead>
      <tbody>
        ${(data || []).map((r) => `
          <tr data-id="${escHtml(r.id)}">
            <td>${formatDate(r.created_at)}</td>
            <td>${escHtml(r.name)}</td>
            <td>${escHtml(r.subject)}</td>
            <td><pre>${escHtml(r.message)}</pre></td>
            <td>${input(r.responsible_text || "", "responsible_text")}</td>
            <td>
              <button class="btn saveContactResponsible" type="button">Speichern</button>
              <button class="btn btn-danger hideContactRequest" type="button">Löschen</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  document.querySelectorAll(".saveContactResponsible").forEach((btn) => btn.onclick = saveContactResponsible);
  document.querySelectorAll(".hideContactRequest").forEach((btn) => btn.onclick = hideContactRequest);
}

async function saveContactResponsible(e) {
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;
  const responsibleText = tr.querySelector('[data-name="responsible_text"]').value;

  const btn = e.target;
  btn.disabled = true;
  btn.textContent = "Speichere…";

  try {
    const { error } = await window.lfcSupabase
      .from("contact_requests")
      .update({ responsible_text: responsibleText })
      .eq("id", id);

    if (error) throw error;

    setAdminStatus("✅ Anfrage gespeichert.");
  } catch (error) {
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Speichern";
  }
}

async function hideContactRequest(e) {
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;

  if (!confirm("Diese Anfrage ausblenden? Sie bleibt in der Datenbank erhalten.")) return;

  const { error } = await window.lfcSupabase
    .from("contact_requests")
    .update({ admin_hidden: true })
    .eq("id", id);

  if (error) {
    alert(error.message);
  } else {
    tr.remove();
    setAdminStatus("✅ Anfrage ausgeblendet.");
  }
}

/* =========================================================
   TERMINE
========================================================= */

async function loadAppointments() {
  const c = document.getElementById("content");
  c.innerHTML = "Lade Termine…";
  setAdminStatus("");

  const { data, error } = await window.lfcSupabase
    .from("appointment_requests")
    .select("*")
    .eq("admin_hidden", false)
    .order("requested_date", { ascending: false })
    .order("requested_time", { ascending: false })
    .limit(300);

  if (error) {
    c.textContent = "Fehler: " + error.message;
    return;
  }

  c.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Erstellt</th>
          <th>Name</th>
          <th>Datum</th>
          <th>Uhrzeit</th>
          <th>Grund</th>
          <th>Mitarbeiter</th>
          <th>Aktion</th>
        </tr>
      </thead>
      <tbody>
        ${(data || []).map((r) => `
          <tr data-id="${escHtml(r.id)}">
            <td>${formatDate(r.created_at)}</td>
            <td>${escHtml(r.name)}</td>
            <td>${escHtml(r.requested_date)}</td>
            <td>${escHtml(r.requested_time)}</td>
            <td><pre>${escHtml(r.reason)}</pre></td>
            <td>${input(r.responsible_text || "", "responsible_text")}</td>
            <td>
              <button class="btn saveAppointmentResponsible" type="button">Speichern</button>
              <button class="btn btn-danger hideAppointmentRequest" type="button">Löschen</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  document.querySelectorAll(".saveAppointmentResponsible").forEach((btn) => btn.onclick = saveAppointmentResponsible);
  document.querySelectorAll(".hideAppointmentRequest").forEach((btn) => btn.onclick = hideAppointmentRequest);
}

async function saveAppointmentResponsible(e) {
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;
  const responsibleText = tr.querySelector('[data-name="responsible_text"]').value;

  const btn = e.target;
  btn.disabled = true;
  btn.textContent = "Speichere…";

  try {
    const { error } = await window.lfcSupabase
      .from("appointment_requests")
      .update({ responsible_text: responsibleText })
      .eq("id", id);

    if (error) throw error;

    setAdminStatus("✅ Termin gespeichert.");
  } catch (error) {
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Speichern";
  }
}

async function hideAppointmentRequest(e) {
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;

  if (!confirm("Diese Terminanfrage ausblenden? Sie bleibt in der Datenbank erhalten.")) return;

  const { error } = await window.lfcSupabase
    .from("appointment_requests")
    .update({ admin_hidden: true })
    .eq("id", id);

  if (error) {
    alert(error.message);
  } else {
    tr.remove();
    setAdminStatus("✅ Terminanfrage ausgeblendet.");
  }
}

/* =========================================================
   EINSTELLUNGEN
========================================================= */

async function loadSettings() {
  const c = document.getElementById("content");
  c.innerHTML = "Lade Einstellungen…";
  setAdminStatus("");

  if (!canAccessRole("manager")) {
    c.textContent = "Kein Zugriff.";
    return;
  }

  const { data: profiles, error: profilesError } = await window.lfcSupabase
    .from("profiles")
    .select("id,email,display_name,role,is_active")
    .order("email", { ascending: true });

  if (profilesError) {
    c.textContent = "Fehler: " + profilesError.message;
    return;
  }

  const { data: calendarSetting } = await window.lfcSupabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", "appointment_calendar_settings")
    .maybeSingle();

  const calendar = calendarSetting?.setting_value || { enabled: true, days: {} };

  const dayLabels = {
    monday: "Montag",
    tuesday: "Dienstag",
    wednesday: "Mittwoch",
    thursday: "Donnerstag",
    friday: "Freitag",
    saturday: "Samstag",
    sunday: "Sonntag"
  };

  c.innerHTML = `
    <section class="settings-card">
      <h2>Einstellungen</h2>

      <article class="bt-card">
        <h3>Mitarbeiter-Verwaltung</h3>

        <form id="createUserForm" class="shop-form">
          <div class="settings-grid">
            <div class="shop-field">
              <label>E-Mail</label>
              <input class="input" id="newUserEmail" type="email" required placeholder="mitarbeiter@example.de">
            </div>

            <div class="shop-field">
              <label>Name</label>
              <input class="input" id="newUserName" type="text" placeholder="Anzeigename">
            </div>

            <div class="shop-field">
              <label>Passwort</label>
              <input class="input" id="newUserPassword" type="password" required placeholder="Start-Passwort">
            </div>

            <div class="shop-field">
              <label>Rang</label>
              <select class="input" id="newUserRole">
                ${ROLE_OPTIONS.map((r) => `<option value="${r}">${r}</option>`).join("")}
              </select>
            </div>
          </div>

          <button class="btn" type="submit">Mitarbeiter anlegen</button>
          <div class="small">Hinweis: Dafür muss die Supabase Edge Function <code>admin-create-user</code> eingerichtet sein.</div>
        </form>

        <hr>

        <table class="admin-table">
          <thead>
            <tr>
              <th>E-Mail</th>
              <th>Name</th>
              <th>Rang</th>
              <th>Aktiv</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            ${(profiles || []).map((p) => `
              <tr data-id="${escHtml(p.id)}">
                <td>${escHtml(p.email)}</td>
                <td>${input(p.display_name || "", "display_name")}</td>
                <td>
                  <select class="input" data-name="role">
                    ${ROLE_OPTIONS.map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${r}</option>`).join("")}
                  </select>
                </td>
                <td>
                  <label class="small"><input type="checkbox" data-name="is_active" ${p.is_active ? "checked" : ""}> aktiv</label>
                </td>
                <td><button class="btn saveProfile" type="button">Speichern</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </article>

      <article class="bt-card">
        <h3>Kalender-Einstellungen für Terminanfragen</h3>

        <form id="calendarSettingsForm" class="shop-form">
          <label class="small">
            <input type="checkbox" id="calendarEnabled" ${calendar.enabled ? "checked" : ""}>
            Terminanfragen aktiv
          </label>

          <table class="admin-table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Aktiv</th>
                <th>Von</th>
                <th>Bis</th>
              </tr>
            </thead>
            <tbody>
              ${Object.keys(dayLabels).map((key) => {
                const d = calendar.days?.[key] || { enabled: false, from: "10:00", to: "18:00" };
                return `
                  <tr data-day="${key}">
                    <td>${dayLabels[key]}</td>
                    <td><input type="checkbox" data-field="enabled" ${d.enabled ? "checked" : ""}></td>
                    <td><input class="input" type="time" data-field="from" value="${escHtml(d.from || "10:00")}"></td>
                    <td><input class="input" type="time" data-field="to" value="${escHtml(d.to || "18:00")}"></td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>

          <button class="btn" type="submit">Kalender-Einstellungen speichern</button>
        </form>
      </article>
    </section>
  `;

  document.getElementById("createUserForm").addEventListener("submit", createUserFromSettings);
  document.querySelectorAll(".saveProfile").forEach((btn) => btn.onclick = saveProfile);
  document.getElementById("calendarSettingsForm").addEventListener("submit", saveCalendarSettings);
}

async function createUserFromSettings(e) {
  e.preventDefault();

  const email = document.getElementById("newUserEmail").value.trim();
  const password = document.getElementById("newUserPassword").value;
  const displayName = document.getElementById("newUserName").value.trim();
  const role = document.getElementById("newUserRole").value;

  if (!email || !password) {
    alert("Bitte E-Mail und Passwort eintragen.");
    return;
  }

  const { data: sessionData } = await window.lfcSupabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    alert("Keine aktive Session gefunden.");
    return;
  }

  try {
    const res = await fetch(`${window.LFC_SUPABASE_CONFIG.url}/functions/v1/admin-create-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({
        email,
        password,
        display_name: displayName,
        role
      })
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok || body.ok === false) {
      throw new Error(body.error || "Benutzer konnte nicht angelegt werden.");
    }

    setAdminStatus("✅ Mitarbeiter angelegt.");
    loadSettings();
  } catch (error) {
    alert(error.message || String(error));
    setAdminStatus("❌ Mitarbeiter konnte nicht angelegt werden.");
  }
}

async function saveProfile(e) {
  const tr = e.target.closest("tr");
  const id = tr.dataset.id;
  const obj = {};

  tr.querySelectorAll("[data-name]").forEach((el) => {
    if (el.type === "checkbox") obj[el.dataset.name] = el.checked;
    else obj[el.dataset.name] = el.value;
  });

  const { error } = await window.lfcSupabase
    .from("profiles")
    .update(obj)
    .eq("id", id);

  if (error) {
    alert(error.message);
  } else {
    setAdminStatus("✅ Mitarbeiter gespeichert.");
  }
}

async function saveCalendarSettings(e) {
  e.preventDefault();

  const days = {};
  document.querySelectorAll("#calendarSettingsForm tr[data-day]").forEach((tr) => {
    const key = tr.dataset.day;
    days[key] = {
      enabled: tr.querySelector('[data-field="enabled"]').checked,
      from: tr.querySelector('[data-field="from"]').value,
      to: tr.querySelector('[data-field="to"]').value
    };
  });

  const setting = {
    enabled: document.getElementById("calendarEnabled").checked,
    days
  };

  const { error } = await window.lfcSupabase
    .from("app_settings")
    .update({ setting_value: setting })
    .eq("setting_key", "appointment_calendar_settings");

  if (error) {
    alert(error.message);
  } else {
    setAdminStatus("✅ Kalender-Einstellungen gespeichert.");
  }
}

/* =========================================================
   TABS
========================================================= */

async function loadTab() {
  if (currentTab === "vehicles") return loadVehicles();
  if (currentTab === "newOrder") return loadNewOrder();
  if (currentTab === "openOrders") return loadOrdersByMode("open");
  if (currentTab === "finishedOrders") return loadOrdersByMode("finished");
  if (currentTab === "contacts") return loadContacts();
  if (currentTab === "appointments") return loadAppointments();
  if (currentTab === "settings") return loadSettings();

  return loadVehicles();
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".tab").forEach((button) => {
    button.onclick = () => {
      const minRole = button.dataset.minRole || "employee";

      if (!canAccessRole(minRole)) {
        alert("Du hast keinen Zugriff auf diesen Bereich.");
        return;
      }

      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      button.classList.add("active");
      currentTab = button.dataset.tab;
      loadTab();
    };
  });

  if (await requireLogin()) {
    applyTabVisibility();
    loadTab();
  }
});
