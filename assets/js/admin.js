let currentTab = "vehicles";
let vehicleGroupsCache = [];
let orderVehiclesCache = [];
let orderFamiliesCache = [];
let orderResourcesCache = [];
let currentUserRole = null;

let craftDeps = {};
let craftLoaded = false;

const CRAFT_SHEET_ID = "1ObAKUBNv5IjXEyY0TD85gK9dJhlm8Uq7Qj6QZgHkoZg";
const TAB_RECIPES = "recipes";
const TAB_RECIPE_ITEMS = "recipe_items";

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

function norm(str) {
  return String(str ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normKey(str) {
  return String(str ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\u200B\t\n\r]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[;:]+$/, "")
    .toLowerCase();
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

function normalizeImageUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  if (!/^https:\/\//i.test(s)) return "";
  return s;
}

function getVehicleImages(v) {
  const arr = Array.isArray(v.images) ? v.images : [];
  return arr
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((x) => normalizeImageUrl(x.url || x.image_url))
    .filter(Boolean);
}

function firstVehicleImage(v) {
  return getVehicleImages(v)[0] || "";
}

function vehicleKey(v) {
  return normKey(v.craft_key || v.blueprint_name || v.display_name || v.id);
}

function isRucksackVehicle(v) {
  return norm(v.group_name).includes("rucksack");
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
    .map((img) => String(img.image_url || img.url || "").trim())
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
          <img src="${escHtml(url)}" alt="" loading="lazy" onerror="this.style.opacity='.25'">
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

function generateOrderNumber() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return "LFC-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/* =========================================================
   GVIZ / UPGRADE-LOGIK
========================================================= */

function gvizJSONP(sheetName, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cb =
      "__lfc_admin_gviz_" +
      sheetName.replace(/[^a-z0-9]/gi, "_") +
      "_" +
      Math.random().toString(36).slice(2);

    const url =
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(CRAFT_SHEET_ID) +
      "/gviz/tq?tqx=out:json;responseHandler:" +
      encodeURIComponent(cb) +
      "&sheet=" +
      encodeURIComponent(sheetName);

    const script = document.createElement("script");

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout beim Laden von Sheet: " + sheetName));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);

      try {
        delete window[cb];
      } catch {}

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    window[cb] = function (payload) {
      cleanup();

      try {
        const cols = (payload.table.cols || []).map((c, index) => {
          const label = String(c.label || c.id || `col_${index}`).trim();
          return label || `col_${index}`;
        });

        const rows = (payload.table.rows || []).map((row) => {
          const obj = {};

          (row.c || []).forEach((cell, index) => {
            const key = cols[index] || `col_${index}`;
            obj[key] = cell ? cell.v : "";
          });

          return obj;
        });

        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("GViz Fehler beim Laden von Sheet: " + sheetName));
    };

    script.src = url;
    document.head.appendChild(script);
  });
}

function getRowValue(row, names) {
  const entries = Object.entries(row || {});
  const normalized = entries.map(([key, value]) => [normKey(key), value]);

  for (const name of names) {
    const target = normKey(name);
    const found = normalized.find(([key]) => key === target);
    if (found) return found[1];
  }

  for (const name of names) {
    const target = normKey(name);
    const found = normalized.find(([key]) => key.includes(target));
    if (found) return found[1];
  }

  return "";
}

function addDependency(productKey, itemKey) {
  const product = normKey(productKey);
  const item = normKey(itemKey);

  if (!product || !item || product === item) return;

  if (!craftDeps[product]) craftDeps[product] = new Set();
  craftDeps[product].add(item);
}

async function loadCraftDependencies() {
  craftDeps = {};
  craftLoaded = false;

  try {
    const [itemsRows] = await Promise.all([
      gvizJSONP(TAB_RECIPE_ITEMS),
      gvizJSONP(TAB_RECIPES).catch(() => [])
    ]);

    itemsRows.forEach((row) => {
      const product =
        getRowValue(row, [
          "product",
          "produkt",
          "recipe",
          "recipe_key",
          "craft_key",
          "target",
          "result",
          "output",
          "output_key",
          "result_key"
        ]) || "";

      const item =
        getRowValue(row, [
          "item",
          "item_key",
          "input",
          "input_key",
          "ingredient",
          "ingredient_key",
          "source",
          "source_key",
          "required_item"
        ]) || "";

      const qty =
        getRowValue(row, [
          "qty",
          "quantity",
          "menge",
          "amount",
          "anzahl"
        ]) || "";

      if (!product || !item) return;
      if (qty !== "" && Number(qty) === 0) return;

      addDependency(product, item);
    });

    craftDeps = Object.fromEntries(
      Object.entries(craftDeps).map(([key, set]) => [key, Array.from(set)])
    );

    craftLoaded = Object.keys(craftDeps).length > 0;
  } catch (error) {
    console.warn("Upgrade-Daten konnten nicht geladen werden. Fallback aktiv.", error);
    craftDeps = {};
    craftLoaded = false;
  }
}

function craftDependsOn(childKey, ancestorKey) {
  const start = normKey(childKey);
  const target = normKey(ancestorKey);

  if (!start || !target || start === target) return false;

  const visited = new Set();
  const stack = [start];

  while (stack.length) {
    const key = stack.pop();

    if (visited.has(key)) continue;
    visited.add(key);

    const deps = craftDeps[key] || [];

    for (const dep of deps) {
      if (dep === target) return true;
      stack.push(dep);
    }
  }

  return false;
}

function fallbackFamilyKey(v) {
  let s = String(v.display_name || v.blueprint_name || "")
    .replace(/\s*Bauplan\s*$/i, "")
    .trim();

  s = s
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*S$/i, "")
    .replace(/\s*S$/i, "")
    .replace(/\s*-\s*R$/i, "")
    .replace(/\s+RAW$/i, "")
    .replace(/\s+D-Type$/i, "")
    .replace(/\s+Cisterne$/i, "")
    .replace(/\s+Gerät$/i, "")
    .replace(/\s+t\d+$/i, "")
    .replace(/\s+HardLiner.*$/i, " HardLiner")
    .replace(/\s+Highline.*$/i, " Highline")
    .trim();

  if (/cyberbeast/i.test(s)) s = "Tesla Cybertruck";
  if (/stingray/i.test(s)) s = "Corvette C2";
  if (/z-type/i.test(s)) s = "Truffade Z-Type";
  if (/viper/i.test(s)) s = "Dodge Viper SRT 10";
  if (/regalia/i.test(s)) s = "Quartz Regalia";
  if (/hotknife/i.test(s)) s = "Vapid Hotknife";
  if (/scania\s+s-520/i.test(s)) s = "Scania S-520";
  if (/actros\s+666/i.test(s)) s = "Mercedes-Benz Actros 666";

  return normKey((v.group_name || "") + "::" + s);
}

function connectedFamiliesByCraft(items) {
  const idToItem = new Map();
  const neighbors = new Map();

  items.forEach((v) => {
    idToItem.set(v.id, v);
    neighbors.set(v.id, new Set());
  });

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];

      const ak = vehicleKey(a);
      const bk = vehicleKey(b);

      const linked = craftDependsOn(ak, bk) || craftDependsOn(bk, ak);

      if (linked) {
        neighbors.get(a.id).add(b.id);
        neighbors.get(b.id).add(a.id);
      }
    }
  }

  const visited = new Set();
  const families = [];

  items.forEach((start) => {
    if (visited.has(start.id)) return;

    const queue = [start.id];
    const comp = [];
    visited.add(start.id);

    while (queue.length) {
      const id = queue.shift();
      const item = idToItem.get(id);
      if (item) comp.push(item);

      for (const next of neighbors.get(id) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    families.push(comp);
  });

  return families;
}

function fallbackFamiliesByName(items) {
  const map = new Map();

  items.forEach((v) => {
    const key = fallbackFamilyKey(v);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  });

  return Array.from(map.values());
}

function mergeSmallCraftFamiliesWithNameFallback(craftFamilies, items) {
  const byId = new Map();
  const used = new Set();
  const result = [];

  craftFamilies.forEach((family) => {
    if (family.length > 1) {
      family.forEach((v) => used.add(v.id));
      result.push(family);
    }
  });

  items.forEach((v) => {
    if (!used.has(v.id)) {
      byId.set(v.id, v);
    }
  });

  fallbackFamiliesByName(Array.from(byId.values())).forEach((family) => {
    result.push(family);
  });

  return result;
}

function familyLevel(v, allInFamily, memo = {}) {
  const key = vehicleKey(v);

  if (memo[key] != null) return memo[key];

  const parents = allInFamily.filter((candidate) => {
    if (candidate.id === v.id) return false;
    return craftDependsOn(key, vehicleKey(candidate));
  });

  if (!parents.length) {
    memo[key] = 0;
    return 0;
  }

  memo[key] =
    1 +
    Math.max(
      ...parents.map((parent) => familyLevel(parent, allInFamily, memo))
    );

  return memo[key];
}

function sortFamilyVariants(list) {
  const memo = {};

  return list.slice().sort((a, b) => {
    const la = familyLevel(a, list, memo);
    const lb = familyLevel(b, list, memo);

    return (
      la - lb ||
      Number(a.sort_order || 1000) - Number(b.sort_order || 1000) ||
      String(a.display_name || "").localeCompare(String(b.display_name || ""), "de")
    );
  });
}

function getBaseVariant(sorted) {
  if (!sorted.length) return null;

  const withLevel = sorted.map((v) => ({
    v,
    level: familyLevel(v, sorted, {})
  }));

  withLevel.sort((a, b) => {
    return (
      a.level - b.level ||
      Number(a.v.sort_order || 1000) - Number(b.v.sort_order || 1000) ||
      String(a.v.display_name || "").localeCompare(String(b.v.display_name || ""), "de")
    );
  });

  return withLevel[0].v;
}

function buildOrderFamilies() {
  const byGroup = new Map();

  orderVehiclesCache.forEach((v) => {
    const g = v.group_name || "Ohne Gruppe";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(v);
  });

  const families = [];

  for (const [, items] of byGroup) {
    const craftFamilies = connectedFamiliesByCraft(items);
    const mergedFamilies = mergeSmallCraftFamiliesWithNameFallback(craftFamilies, items);

    mergedFamilies.forEach((list) => {
      const variants = sortFamilyVariants(list);
      const base = getBaseVariant(variants) || variants[0];

      families.push({
        base,
        variants
      });
    });
  }

  return families;
}

function getUpgradePath(family, selected) {
  const path = family.variants
    .filter((v) => {
      if (v.id === selected.id) return true;
      return craftDependsOn(vehicleKey(selected), vehicleKey(v));
    })
    .sort((a, b) => {
      return (
        familyLevel(a, family.variants, {}) - familyLevel(b, family.variants, {}) ||
        Number(a.sort_order || 1000) - Number(b.sort_order || 1000)
      );
    });

  return path.length ? path : [selected];
}

function getFamilyForVehicle(vehicleId) {
  return orderFamiliesCache.find((family) =>
    family.variants.some((v) => String(v.id) === String(vehicleId))
  ) || null;
}

function getVehicleById(vehicleId) {
  return orderVehiclesCache.find((v) => String(v.id) === String(vehicleId)) || null;
}

function getResourceById(itemId) {
  return orderResourcesCache.find((x) => String(x.item_id) === String(itemId)) || null;
}

/* =========================================================
   LOGIN / BASISDATEN
========================================================= */

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

async function loadVehicleGroups() {
  const { data, error } = await window.lfcSupabase
    .from("vehicle_groups")
    .select("id,name,sort_order,is_active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  vehicleGroupsCache = data || [];
}

async function loadOrderData() {
  const [vehiclesRes, resourcesRes] = await Promise.all([
    window.lfcSupabase
      .from("public_vehicle_catalog")
      .select("*"),
    window.lfcSupabase
      .from("public_item_prices")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("item_name", { ascending: true })
  ]);

  if (vehiclesRes.error) throw vehiclesRes.error;
  if (resourcesRes.error) throw resourcesRes.error;

  orderVehiclesCache = (vehiclesRes.data || []).filter((v) => v.group_name);
  orderResourcesCache = resourcesRes.data || [];

  await loadCraftDependencies();
  orderFamiliesCache = buildOrderFamilies();
}

/* =========================================================
   KATALOG-VERWALTUNG
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
                  <div class="small">Bauplan</div>
                  ${input(v.blueprint_name || "", "blueprint_name")}
                </td>

                <td>
                  <div class="small">Gruppe</div>
                  <select class="input" data-name="group_id">${renderGroupOptions(v.group_id)}</select>
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
                  <div class="small">Bild-URLs, eine URL pro Zeile. Nur https:// Links.</div>
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
    alert("Es sind ungültige Bildlinks vorhanden. Erlaubt sind nur https:// Links.");
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
      .select("id")
      .maybeSingle();

    if (vehicleError) throw vehicleError;
    if (!updatedRows) throw new Error("Fahrzeug wurde nicht aktualisiert.");

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

    setAdminStatus("✅ Fahrzeug gespeichert.", "ok");
    updateImagePreview(tr);
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern.", "err");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Speichern";
  }
}

/* =========================================================
   ROHSTOFFPREISE TAB
========================================================= */

async function loadItemPricesAdmin() {
  const c = document.getElementById("content");
  c.innerHTML = "Lade Rohstoffpreise…";
  setAdminStatus("");

  if (!canAccessRole("manager")) {
    c.textContent = "Kein Zugriff.";
    return;
  }

  try {
    const { data, error } = await window.lfcSupabase
      .from("items")
      .select(`
        id,
        name,
        unit,
        is_active,
        sort_order,
        item_prices (
          id,
          price,
          is_active
        )
      `)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;

    c.innerHTML = `
      <section class="bt-card">
        <h2>Rohstoffpreise</h2>
        <p class="bt-hint">
          Diese Preise werden auf <strong>rohstoffpreise.html</strong> und bei <strong>Neuer Auftrag → Rohstoffe</strong> verwendet.
        </p>

        <form id="newItemForm" class="price-grid">
          <div class="shop-field">
            <label>Neuer Artikel</label>
            <input class="input" id="newItemName" required placeholder="z.B. Kupferbarren">
          </div>

          <div class="shop-field">
            <label>Einheit</label>
            <input class="input" id="newItemUnit" value="Stk.">
          </div>

          <div class="shop-field">
            <label>Preis</label>
            <input class="input" id="newItemPrice" type="number" min="0" step="1" value="0">
          </div>

          <div>
            <button class="btn" type="submit">Artikel anlegen</button>
          </div>
        </form>
      </section>

      <table class="admin-table">
        <thead>
          <tr>
            <th>Sortierung</th>
            <th>Artikel</th>
            <th>Einheit</th>
            <th>Preis</th>
            <th>Aktiv</th>
            <th>Aktion</th>
          </tr>
        </thead>
        <tbody>
          ${(data || []).map((item) => {
            const price = (item.item_prices || [])[0] || {};
            return `
              <tr data-item-id="${escHtml(item.id)}" data-price-id="${escHtml(price.id || "")}">
                <td>${input(item.sort_order ?? 1000, "sort_order", "number")}</td>
                <td>${input(item.name || "", "name")}</td>
                <td>${input(item.unit || "Stk.", "unit")}</td>
                <td>${input(price.price ?? 0, "price", "number")}</td>
                <td>
                  <label class="small">
                    <input data-name="is_active" type="checkbox" ${item.is_active ? "checked" : ""}>
                    aktiv
                  </label>
                </td>
                <td>
                  <button class="btn saveItemPrice" type="button">Speichern</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;

    document.getElementById("newItemForm").addEventListener("submit", createItemPrice);
    document.querySelectorAll(".saveItemPrice").forEach((btn) => btn.onclick = saveItemPrice);
  } catch (error) {
    console.error(error);
    c.textContent = "Fehler: " + (error.message || String(error));
  }
}

async function createItemPrice(e) {
  e.preventDefault();

  const name = document.getElementById("newItemName").value.trim();
  const unit = document.getElementById("newItemUnit").value.trim() || "Stk.";
  const price = Number(document.getElementById("newItemPrice").value || 0);

  if (!name) {
    alert("Bitte Artikelname eintragen.");
    return;
  }

  try {
    const { data: item, error: itemError } = await window.lfcSupabase
      .from("items")
      .insert({
        name,
        unit,
        is_active: true,
        sort_order: 1000
      })
      .select("id")
      .single();

    if (itemError) throw itemError;

    const { error: priceError } = await window.lfcSupabase
      .from("item_prices")
      .insert({
        item_id: item.id,
        price,
        is_active: true
      });

    if (priceError) throw priceError;

    setAdminStatus("✅ Artikel angelegt.", "ok");
    await loadItemPricesAdmin();
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Artikel konnte nicht angelegt werden.", "err");
  }
}

async function saveItemPrice(e) {
  const tr = e.target.closest("tr");
  const itemId = tr.dataset.itemId;
  const priceId = tr.dataset.priceId || "";

  const name = tr.querySelector('[data-name="name"]').value.trim();
  const unit = tr.querySelector('[data-name="unit"]').value.trim() || "Stk.";
  const sortOrder = Number(tr.querySelector('[data-name="sort_order"]').value || 1000);
  const price = Number(tr.querySelector('[data-name="price"]').value || 0);
  const isActive = tr.querySelector('[data-name="is_active"]').checked;

  const btn = e.target;
  btn.disabled = true;
  btn.textContent = "Speichere…";

  try {
    const { error: itemError } = await window.lfcSupabase
      .from("items")
      .update({
        name,
        unit,
        sort_order: sortOrder,
        is_active: isActive
      })
      .eq("id", itemId);

    if (itemError) throw itemError;

    if (priceId) {
      const { error: priceError } = await window.lfcSupabase
        .from("item_prices")
        .update({
          price,
          is_active: isActive
        })
        .eq("id", priceId);

      if (priceError) throw priceError;
    } else {
      const { error: priceError } = await window.lfcSupabase
        .from("item_prices")
        .insert({
          item_id: itemId,
          price,
          is_active: isActive
        });

      if (priceError) throw priceError;
    }

    setAdminStatus("✅ Rohstoffpreis gespeichert.", "ok");
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern.", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Speichern";
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
    await loadOrderData();

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
              <label for="newOrderType">Was wird bestellt? *</label>
              <select class="input" id="newOrderType" required>
                <option value="new_vehicle">Neuwagen</option>
                <option value="vehicle_upgrade">Upgrade eines Fahrzeuges</option>
                <option value="resources">Rohstoffe</option>
                <option value="backpack">Rucksack</option>
              </select>
            </div>
          </div>

          <div class="order-product-row">
            <div id="newOrderProductArea"></div>

            <div class="order-preview-img" id="newOrderPreviewImage">
              Kein Bild
            </div>
          </div>

          <div class="order-summary" id="newOrderSummary">
            Bitte Auswahl treffen.
          </div>

          <div class="shop-field">
            <label for="newOrderPublicInfo">Zusätzliche Infos</label>
            <textarea class="input" id="newOrderPublicInfo" placeholder="Zusätzliche Infos"></textarea>
          </div>

          <div class="shop-form-actions">
            <button class="btn" id="newOrderSubmit" type="submit">Auftrag erstellen</button>
          </div>
        </form>
      </section>
    `;

    document.getElementById("newOrderType").addEventListener("change", renderNewOrderProductArea);
    document.getElementById("newOrderForm").addEventListener("submit", submitNewOrder);

    renderNewOrderProductArea();
  } catch (error) {
    console.error(error);
    c.textContent = "Fehler: " + (error.message || String(error));
  }
}

function vehicleOptionLabel(v) {
  return `${v.display_name} (${euro(v.price)})`;
}

function getNewVehicleOptions() {
  return orderVehiclesCache
    .filter((v) => !isRucksackVehicle(v))
    .slice()
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), "de"));
}

function getUpgradeVehicleOptions() {
  return orderVehiclesCache
    .filter((v) => {
      if (isRucksackVehicle(v)) return false;
      const family = getFamilyForVehicle(v.id);
      if (!family) return false;
      const path = getUpgradePath(family, v);
      return path.length > 1;
    })
    .slice()
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), "de"));
}

function getBackpackOptions() {
  return orderVehiclesCache
    .filter((v) => isRucksackVehicle(v))
    .slice()
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), "de"));
}

function renderNewOrderProductArea() {
  const type = document.getElementById("newOrderType").value;
  const area = document.getElementById("newOrderProductArea");

  if (type === "new_vehicle") {
    const options = getNewVehicleOptions();

    area.innerHTML = `
      <div class="shop-field">
        <label for="newOrderVehicleSelect">Fertige Produktauswahl: Neuwagen</label>
        <select class="input" id="newOrderVehicleSelect" required>
          <option value="">Bitte Fahrzeug wählen</option>
          ${options.map((v) => `<option value="${escHtml(v.id)}">${escHtml(vehicleOptionLabel(v))}</option>`).join("")}
        </select>
        <div class="small">Wenn ein upgegradetes Fahrzeug gewählt wird, werden die darunterliegenden Fahrzeuge automatisch mitberechnet.</div>
      </div>
    `;

    document.getElementById("newOrderVehicleSelect").addEventListener("change", updateNewOrderSummary);
  }

  if (type === "vehicle_upgrade") {
    const options = getUpgradeVehicleOptions();

    area.innerHTML = `
      <div class="shop-field">
        <label for="newOrderVehicleSelect">Fertige Produktauswahl: Upgrade eines Fahrzeuges</label>
        <select class="input" id="newOrderVehicleSelect" required>
          <option value="">Bitte Upgrade wählen</option>
          ${options.map((v) => `<option value="${escHtml(v.id)}">${escHtml(vehicleOptionLabel(v))}</option>`).join("")}
        </select>
        <div class="small">Es werden nur Fahrzeuge angezeigt, die ein Upgrade eines bestehenden Fahrzeuges sind.</div>
      </div>
    `;

    document.getElementById("newOrderVehicleSelect").addEventListener("change", updateNewOrderSummary);
  }

  if (type === "resources") {
    area.innerHTML = `
      <div class="order-create-grid">
        <div class="shop-field">
          <label for="newOrderResourceSelect">Fertige Produktauswahl: Rohstoff</label>
          <select class="input" id="newOrderResourceSelect" required>
            <option value="">Bitte Rohstoff wählen</option>
            ${orderResourcesCache.map((r) => `
              <option value="${escHtml(r.item_id)}">${escHtml(r.item_name)} (${euro(r.price)} / ${escHtml(r.unit || "Stk.")})</option>
            `).join("")}
          </select>
        </div>

        <div class="shop-field">
          <label for="newOrderResourceQty">Anzahl</label>
          <input class="input" id="newOrderResourceQty" type="number" min="1" step="1" value="1" required>
        </div>
      </div>
    `;

    document.getElementById("newOrderResourceSelect").addEventListener("change", updateNewOrderSummary);
    document.getElementById("newOrderResourceQty").addEventListener("input", updateNewOrderSummary);
  }

  if (type === "backpack") {
    const options = getBackpackOptions();

    area.innerHTML = `
      <div class="shop-field">
        <label for="newOrderVehicleSelect">Fertige Produktauswahl: Rucksack</label>
        <select class="input" id="newOrderVehicleSelect" required>
          <option value="">Bitte Rucksack wählen</option>
          ${options.map((v) => `<option value="${escHtml(v.id)}">${escHtml(vehicleOptionLabel(v))}</option>`).join("")}
        </select>
        <div class="small">Es werden nur Einträge aus der Gruppe Rucksack angezeigt.</div>
      </div>
    `;

    document.getElementById("newOrderVehicleSelect").addEventListener("change", updateNewOrderSummary);
  }

  updateNewOrderSummary();
}

function setOrderPreviewImage(url) {
  const box = document.getElementById("newOrderPreviewImage");
  if (!box) return;

  if (!url) {
    box.innerHTML = "Kein Bild";
    return;
  }

  box.innerHTML = `<img src="${escHtml(url)}" alt="" loading="lazy" onerror="this.parentElement.textContent='Bild konnte nicht geladen werden'">`;
}

function getSelectedOrderData() {
  const type = document.getElementById("newOrderType")?.value || "new_vehicle";

  if (type === "resources") {
    const itemId = document.getElementById("newOrderResourceSelect")?.value || "";
    const qty = Math.max(1, Number(document.getElementById("newOrderResourceQty")?.value || 1));
    const resource = getResourceById(itemId);

    if (!resource) {
      return {
        ok: false,
        type,
        total: 0,
        title: "",
        items: [],
        image: "",
        html: "Bitte Rohstoff auswählen."
      };
    }

    const unitPrice = Number(resource.price || 0);
    const total = unitPrice * qty;

    return {
      ok: true,
      type,
      total,
      title: `${qty}× ${resource.item_name}`,
      image: "",
      items: [{
        item_type: "resource",
        item_id: resource.item_id,
        vehicle_catalog_entry_id: null,
        title: resource.item_name,
        quantity: qty,
        unit_price: unitPrice,
        total_price: total
      }],
      html: `
        <strong>Typ:</strong> Rohstoffe<br>
        <strong>Artikel:</strong> ${escHtml(resource.item_name)}<br>
        <strong>Anzahl:</strong> ${escHtml(qty)} ${escHtml(resource.unit || "Stk.")}<br>
        <strong>Einzelpreis:</strong> ${euro(unitPrice)}<br>
        <strong>Gesamtpreis:</strong> ${euro(total)}
      `
    };
  }

  const vehicleId = document.getElementById("newOrderVehicleSelect")?.value || "";
  const vehicle = getVehicleById(vehicleId);

  if (!vehicle) {
    return {
      ok: false,
      type,
      total: 0,
      title: "",
      items: [],
      image: "",
      html: "Bitte Produkt auswählen."
    };
  }

  const family = getFamilyForVehicle(vehicle.id);
  const path = family ? getUpgradePath(family, vehicle) : [vehicle];

  const isUpgrade = type === "vehicle_upgrade";
  const typeLabel =
    type === "new_vehicle"
      ? "Neuwagen"
      : type === "vehicle_upgrade"
        ? "Upgrade eines Fahrzeuges"
        : "Rucksack";

  const total = path.reduce((sum, v) => sum + Number(v.price || 0), 0);

  return {
    ok: true,
    type,
    total,
    title: vehicle.display_name,
    image: firstVehicleImage(vehicle),
    items: path.map((v) => ({
      item_type: type === "backpack" ? "backpack" : isUpgrade ? "vehicle_upgrade_step" : "vehicle",
      item_id: null,
      vehicle_catalog_entry_id: v.id,
      title: v.display_name,
      quantity: 1,
      unit_price: Number(v.price || 0),
      total_price: Number(v.price || 0)
    })),
    html: `
      <strong>Typ:</strong> ${escHtml(typeLabel)}<br>
      <strong>Produkt:</strong> ${escHtml(vehicle.display_name)}<br>
      ${
        path.length > 1
          ? `<strong>Berechnete Stufen:</strong><br>${path.map((v) => `→ ${escHtml(v.display_name)} ${euro(v.price)}`).join("<br>")}<br>`
          : `<strong>Berechnet:</strong> ${escHtml(vehicle.display_name)} ${euro(vehicle.price)}<br>`
      }
      <strong>Gesamtpreis:</strong> ${euro(total)}
    `
  };
}

function updateNewOrderSummary() {
  const data = getSelectedOrderData();
  const summary = document.getElementById("newOrderSummary");

  setOrderPreviewImage(data.image);

  if (summary) {
    summary.innerHTML = data.html;
  }
}

async function submitNewOrder(e) {
  e.preventDefault();

  const customerName = document.getElementById("newOrderCustomerName").value.trim();
  const publicInfo = document.getElementById("newOrderPublicInfo").value.trim();
  const selected = getSelectedOrderData();

  if (!customerName) {
    alert("Bitte Kundenname eintragen.");
    return;
  }

  if (!selected.ok) {
    alert("Bitte eine gültige Produktauswahl treffen.");
    return;
  }

  const submitButton = document.getElementById("newOrderSubmit");
  submitButton.disabled = true;
  submitButton.textContent = "Erstelle…";
  setAdminStatus("");

  try {
    const total = Number(selected.total || 0);
    const orderNumber = generateOrderNumber();

    const { data: order, error: orderError } = await window.lfcSupabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        customer_name: customerName,
        production_summary: selected.title,
        status: "new",
        public_status_label: "Bestellung ist eingegangen",
        public_info: publicInfo,
        total_price: total,
        invoice_total: total,
        deposit_required: false,
        deposit_amount: 0,
        invoice_remaining: total,
        invoice_paid: false,
        admin_hidden: false,
        source: "admin"
      })
      .select("id, order_number")
      .single();

    if (orderError) throw orderError;

    const orderItems = selected.items.map((item) => ({
      order_id: order.id,
      item_type: item.item_type,
      item_id: item.item_id,
      vehicle_catalog_entry_id: item.vehicle_catalog_entry_id,
      title: item.title,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price
    }));

    const { error: itemError } = await window.lfcSupabase
      .from("order_items")
      .insert(orderItems);

    if (itemError) throw itemError;

    setAdminStatus("✅ Auftrag erstellt: " + order.order_number, "ok");

    currentTab = "openOrders";
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    const openTab = document.querySelector('.tab[data-tab="openOrders"]');
    if (openTab) openTab.classList.add("active");

    await loadOrdersByMode("open");
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Auftrag konnte nicht erstellt werden.", "err");
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
      query = query.eq("invoice_paid", true).eq("admin_hidden", false);
    } else {
      query = query.eq("invoice_paid", false).eq("admin_hidden", false);
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

    setAdminStatus("✅ Auftrag gespeichert: " + data.order_number, "ok");

    if (currentTab === "openOrders" && data.invoice_paid === true) {
      await loadOrdersByMode("open");
    } else if (currentTab === "finishedOrders" && data.invoice_paid === false) {
      await loadOrdersByMode("finished");
    } else {
      recalcOrderRowRemaining(tr);
    }
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern des Auftrags.", "err");
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
    if (!data) throw new Error("Auftrag konnte nicht ausgeblendet werden.");

    setAdminStatus("✅ Auftrag ausgeblendet: " + data.order_number, "ok");
    tr.remove();
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Ausblenden.", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Ausblenden";
  }
}

/* =========================================================
   ANFRAGEN / TERMINE
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

  try {
    const { error } = await window.lfcSupabase
      .from("contact_requests")
      .update({ responsible_text: responsibleText })
      .eq("id", id);

    if (error) throw error;

    setAdminStatus("✅ Anfrage gespeichert.", "ok");
  } catch (error) {
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern.", "err");
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
    setAdminStatus("✅ Anfrage ausgeblendet.", "ok");
  }
}

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

  try {
    const { error } = await window.lfcSupabase
      .from("appointment_requests")
      .update({ responsible_text: responsibleText })
      .eq("id", id);

    if (error) throw error;

    setAdminStatus("✅ Termin gespeichert.", "ok");
  } catch (error) {
    alert(error.message || String(error));
    setAdminStatus("❌ Fehler beim Speichern.", "err");
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
    setAdminStatus("✅ Terminanfrage ausgeblendet.", "ok");
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

    setAdminStatus("✅ Mitarbeiter angelegt.", "ok");
    loadSettings();
  } catch (error) {
    alert(error.message || String(error));
    setAdminStatus("❌ Mitarbeiter konnte nicht angelegt werden.", "err");
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
    setAdminStatus("✅ Mitarbeiter gespeichert.", "ok");
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
    setAdminStatus("✅ Kalender-Einstellungen gespeichert.", "ok");
  }
}

/* =========================================================
   TABS
========================================================= */

async function loadTab() {
  if (currentTab === "vehicles") return loadVehicles();
  if (currentTab === "itemPrices") return loadItemPricesAdmin();
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
