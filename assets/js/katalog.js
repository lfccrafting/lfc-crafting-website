(function () {
  "use strict";

  let vehicles = [];
  let cards = [];
  let groups = [];
  let activeSelection = null;

  let craftDeps = {};
  let craftParents = {};
  let craftLoaded = false;

  const CRAFT_SHEET_ID = "1ObAKUBNv5IjXEyY0TD85gK9dJhlm8Uq7Qj6QZgHkoZg";
  const TAB_RECIPES = "recipes";
  const TAB_RECIPE_ITEMS = "recipe_items";

  const $ = (id) => document.getElementById(id);

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

  function norm(s) {
    return String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function normKey(s) {
    return String(s ?? "")
      .normalize("NFKC")
      .replace(/[\u00A0\u200B\t\n\r]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function slug(s) {
    return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

  function firstImg(v) {
    const list = imgs(v);
    return list[0] || "";
  }

  function imgs(v) {
    return Array.isArray(v.images)
      ? v.images.map((x) => normalizeImageUrl(x.url)).filter(Boolean)
      : [];
  }

  function groupKey(v) {
    return v.group_name || "Ohne Gruppe";
  }

  function vehicleKey(v) {
    return normKey(v.craft_key || v.blueprint_name || v.display_name || v.id);
  }

  function vehicleSearchText(v) {
    return norm([
      v.display_name,
      v.blueprint_name,
      v.description,
      v.group_name,
      v.craft_key,
      v.trunk_size
    ].join(" "));
  }

  async function triggerDiscordNotify() {
    try {
      if (!window.LFC_SUPABASE_CONFIG?.url) return;

      await fetch(`${window.LFC_SUPABASE_CONFIG.url}/functions/v1/discord-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: "queue",
          source: "katalog"
        })
      });
    } catch (error) {
      console.warn("Discord Notify konnte nicht ausgelöst werden:", error);
    }
  }

  function gvizUrl(sheetName) {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CRAFT_SHEET_ID)}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
  }

  function parseGvizText(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start < 0 || end < 0) {
      throw new Error("Ungültige Google-Sheets-GViz-Antwort.");
    }

    const json = JSON.parse(text.slice(start, end + 1));
    const cols = (json.table.cols || []).map((c, index) => {
      const label = String(c.label || c.id || `col_${index}`).trim();
      return label || `col_${index}`;
    });

    return (json.table.rows || []).map((row) => {
      const obj = {};

      (row.c || []).forEach((cell, index) => {
        const key = cols[index] || `col_${index}`;
        obj[key] = cell ? cell.v : "";
      });

      return obj;
    });
  }

  async function fetchGvizSheet(sheetName) {
    const res = await fetch(gvizUrl(sheetName), {
      cache: "no-store"
    });

    if (!res.ok) {
      throw new Error(`Sheet konnte nicht geladen werden: ${sheetName}`);
    }

    const text = await res.text();
    return parseGvizText(text);
  }

  function getRowValue(row, possibleNames) {
    const entries = Object.entries(row || {});
    const lowered = entries.map(([key, value]) => [normKey(key), value]);

    for (const name of possibleNames) {
      const target = normKey(name);
      const found = lowered.find(([key]) => key === target);
      if (found) return found[1];
    }

    for (const name of possibleNames) {
      const target = normKey(name);
      const found = lowered.find(([key]) => key.includes(target));
      if (found) return found[1];
    }

    return "";
  }

  function addDep(fromKey, toKey) {
    const from = normKey(fromKey);
    const to = normKey(toKey);

    if (!from || !to || from === to) return;

    if (!craftDeps[from]) craftDeps[from] = new Set();
    if (!craftParents[to]) craftParents[to] = new Set();

    craftDeps[from].add(to);
    craftParents[to].add(from);
  }

  async function loadCraftDependencies() {
    craftDeps = {};
    craftParents = {};
    craftLoaded = false;

    try {
      const [recipesRows, itemsRows] = await Promise.all([
        fetchGvizSheet(TAB_RECIPES),
        fetchGvizSheet(TAB_RECIPE_ITEMS)
      ]);

      const knownVehicleKeys = new Set();

      recipesRows.forEach((row) => {
        const key =
          getRowValue(row, ["craft_key", "key", "class", "classname", "recipe", "recipe_key", "name", "item", "result", "output"]) ||
          "";

        if (key) knownVehicleKeys.add(normKey(key));
      });

      vehicles.forEach((v) => {
        knownVehicleKeys.add(vehicleKey(v));
      });

      itemsRows.forEach((row) => {
        const recipe =
          getRowValue(row, ["recipe", "recipe_key", "craft_key", "target", "result", "output", "output_key", "result_key"]) ||
          "";

        const item =
          getRowValue(row, ["item", "item_key", "input", "input_key", "ingredient", "ingredient_key", "source", "source_key", "required_item"]) ||
          "";

        const recipeKey = normKey(recipe);
        const itemKey = normKey(item);

        if (!recipeKey || !itemKey) return;

        if (knownVehicleKeys.has(recipeKey) && knownVehicleKeys.has(itemKey)) {
          addDep(itemKey, recipeKey);
        }
      });

      craftDeps = Object.fromEntries(
        Object.entries(craftDeps).map(([key, set]) => [key, Array.from(set)])
      );

      craftParents = Object.fromEntries(
        Object.entries(craftParents).map(([key, set]) => [key, Array.from(set)])
      );

      craftLoaded = true;
    } catch (error) {
      console.warn("Upgrade-Daten konnten nicht geladen werden. Katalog läuft ohne Upgrade-Verknüpfung weiter.", error);
      craftDeps = {};
      craftParents = {};
      craftLoaded = false;
    }
  }

  function getVehicleMap() {
    const map = new Map();

    vehicles.forEach((v) => {
      map.set(vehicleKey(v), v);
    });

    return map;
  }

  function buildFamilies() {
    const vehicleMap = getVehicleMap();
    const parent = new Map();

    function find(x) {
      if (!parent.has(x)) parent.set(x, x);
      const p = parent.get(x);
      if (p === x) return x;
      const root = find(p);
      parent.set(x, root);
      return root;
    }

    function union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    }

    vehicles.forEach((v) => {
      find(vehicleKey(v));
    });

    Object.entries(craftDeps).forEach(([from, targets]) => {
      targets.forEach((to) => {
        if (vehicleMap.has(from) && vehicleMap.has(to)) {
          union(from, to);
        }
      });
    });

    const familiesByRoot = new Map();

    vehicles.forEach((v) => {
      const key = vehicleKey(v);
      const root = find(key);

      if (!familiesByRoot.has(root)) {
        familiesByRoot.set(root, []);
      }

      familiesByRoot.get(root).push(v);
    });

    const families = Array.from(familiesByRoot.values()).map((list) => {
      const sorted = sortFamilyVariants(list);
      const base = getBaseVariant(sorted);

      return {
        base,
        variants: sorted
      };
    });

    families.sort((a, b) => {
      const ga = a.base.group_sort_order ?? 1000;
      const gb = b.base.group_sort_order ?? 1000;
      const sa = a.base.sort_order ?? 1000;
      const sb = b.base.sort_order ?? 1000;

      return (
        ga - gb ||
        sa - sb ||
        String(a.base.group_name || "").localeCompare(String(b.base.group_name || ""), "de") ||
        String(a.base.display_name || "").localeCompare(String(b.base.display_name || ""), "de")
      );
    });

    return families;
  }

  function familyLevel(key, memo = {}) {
    key = normKey(key);

    if (memo[key] != null) return memo[key];

    const parents = (craftParents[key] || []).filter((p) => {
      return vehicles.some((v) => vehicleKey(v) === p);
    });

    if (!parents.length) {
      memo[key] = 0;
      return 0;
    }

    memo[key] = 1 + Math.max(...parents.map((p) => familyLevel(p, memo)));
    return memo[key];
  }

  function sortFamilyVariants(list) {
    const memo = {};

    return list.slice().sort((a, b) => {
      const ka = vehicleKey(a);
      const kb = vehicleKey(b);

      return (
        familyLevel(ka, memo) - familyLevel(kb, memo) ||
        (a.sort_order ?? 1000) - (b.sort_order ?? 1000) ||
        String(a.display_name || "").localeCompare(String(b.display_name || ""), "de")
      );
    });
  }

  function getBaseVariant(list) {
    const keys = new Set(list.map(vehicleKey));

    const withoutFamilyParents = list.filter((v) => {
      const parents = craftParents[vehicleKey(v)] || [];
      return !parents.some((p) => keys.has(p));
    });

    return withoutFamilyParents[0] || list[0];
  }

  function upgradeLabel(base, variants) {
    const upgrades = variants.filter((v) => v.id !== base.id);

    if (!upgrades.length) {
      return "";
    }

    return upgrades.map((v) => v.display_name).join(", ");
  }

  function getPathToVariant(targetKey) {
    const vehicleMap = getVehicleMap();
    const target = normKey(targetKey);
    const path = [];
    const seen = new Set();

    function walk(key) {
      if (!key || seen.has(key)) return;
      seen.add(key);

      const parents = (craftParents[key] || []).filter((p) => vehicleMap.has(p));

      if (parents.length) {
        walk(parents[0]);
      }

      const v = vehicleMap.get(key);
      if (v) path.push(v);
    }

    walk(target);
    return path;
  }

  async function loadVehicles() {
    const status = $("shopStatus");

    try {
      if (status) status.textContent = "Lade Fahrzeugkatalog …";

      const { data, error } = await window.lfcSupabase
        .from("public_vehicle_catalog")
        .select("*");

      if (error) throw error;

      vehicles = (data || [])
        .filter((v) => v.group_name)
        .sort((a, b) => {
          return (
            (a.group_sort_order ?? 1000) - (b.group_sort_order ?? 1000) ||
            (a.sort_order ?? 1000) - (b.sort_order ?? 1000) ||
            String(a.display_name || "").localeCompare(String(b.display_name || ""), "de")
          );
        });

      await loadCraftDependencies();
      render();

      if (status) {
        status.classList.remove("bt-error");
        status.textContent = `✅ ${vehicles.length} Fahrzeuge geladen${craftLoaded ? " inkl. Upgrade-Struktur." : "."}`;
      }
    } catch (error) {
      console.error(error);

      if (status) {
        status.classList.add("bt-error");
        status.textContent =
          "❌ Fahrzeugdaten konnten nicht geladen werden. Prüfe assets/js/config.js und die Supabase-View public_vehicle_catalog.";
      }
    }
  }

  function renderGroupNav(names) {
    const nav = $("shopGroupNav");
    if (!nav) return;

    nav.innerHTML = "";

    names.forEach((name) => {
      const b = document.createElement("button");
      b.className = "shop-group-nav-item";
      b.type = "button";
      b.textContent = name;

      b.onclick = () => {
        const target = document.getElementById("group-" + slug(name));
        if (target) {
          target.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      };

      nav.appendChild(b);
    });
  }

  function render() {
    const content = $("shopContent");
    if (!content) return;

    content.innerHTML = "";
    cards = [];
    groups = [];

    const families = buildFamilies();
    const byGroup = new Map();

    families.forEach((family) => {
      const g = groupKey(family.base);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(family);
    });

    renderGroupNav(Array.from(byGroup.keys()));

    for (const [name, list] of byGroup) {
      const section = document.createElement("section");
      section.className = "shop-group";
      section.id = "group-" + slug(name);

      section.innerHTML = `
        <div class="shop-group-title">
          <h2>${escHtml(name)}</h2>
          <span class="shop-group-count">${list.length} Fahrzeuge</span>
        </div>
        <div class="shop-grid"></div>
      `;

      const grid = section.querySelector(".shop-grid");

      list.forEach((family) => {
        const v = family.base;
        const img = firstImg(v);
        const upgrades = upgradeLabel(v, family.variants);

        const card = document.createElement("article");
        card.className = "shop-card";
        card.dataset.search = norm([
          v.display_name,
          v.blueprint_name,
          v.description,
          v.group_name,
          v.craft_key,
          upgrades,
          family.variants.map((x) => x.display_name).join(" ")
        ].join(" "));

        card.innerHTML = `
          <div class="shop-card-media">
            ${
              img
                ? `<img src="${escHtml(img)}" alt="${escHtml(v.display_name)}" loading="lazy">`
                : `<div class="shop-modal-img-placeholder">Kein Bild vorhanden</div>`
            }
          </div>

          <div class="shop-card-body">
            <div>
              <h3 class="shop-card-title">${escHtml(v.display_name)}</h3>
              ${
                upgrades
                  ? `<div class="shop-card-upgrades"><strong>Upgrades:</strong> ${escHtml(upgrades)}</div>`
                  : `<div class="shop-card-upgrades">${escHtml(v.description || "").slice(0, 120)}${(v.description || "").length > 120 ? "…" : ""}</div>`
              }
            </div>

            <p class="shop-card-price-main">${euro(v.price)}</p>
          </div>
        `;

        card.onclick = () => openModal(family);

        grid.appendChild(card);
        cards.push(card);
      });

      content.appendChild(section);
      groups.push(section);
    }

    const info = $("shopSearchInfo");
    if (info) info.textContent = `${families.length} Einträge`;
  }

  function filter() {
    const q = norm($("shopSearch")?.value || "");
    let shown = 0;

    cards.forEach((c) => {
      const ok = !q || c.dataset.search.includes(q);
      c.style.display = ok ? "" : "none";
      if (ok) shown++;
    });

    groups.forEach((g) => {
      const any = Array.from(g.querySelectorAll(".shop-card")).some((c) => c.style.display !== "none");
      g.style.display = any ? "" : "none";
    });

    const noResults = $("shopNoResults");
    if (noResults) noResults.style.display = shown ? "none" : "block";

    const info = $("shopSearchInfo");
    if (info) info.textContent = `${shown} Treffer`;
  }

  function openModal(family) {
    const modal = $("shopModal");
    if (!modal) return;

    const base = family.base;
    const variants = family.variants || [base];

    activeSelection = base;

    $("shopModalTitle").textContent = base.display_name;
    renderModalVariant(family, base);

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
  }

  function renderModalVariant(family, selected) {
    activeSelection = selected;

    const modalContent = $("shopModalContent");
    if (!modalContent) return;

    const variants = family.variants || [selected];
    const allImgs = imgs(selected);
    const path = getPathToVariant(vehicleKey(selected));

    modalContent.innerHTML = `
      ${
        variants.length > 1
          ? `
            <div class="shop-modal-variant-tabs">
              ${variants.map((v) => `
                <button
                  class="shop-modal-variant-tab ${v.id === selected.id ? "active" : ""}"
                  type="button"
                  data-id="${escHtml(v.id)}"
                >
                  ${escHtml(v.display_name)}
                </button>
              `).join("")}
            </div>
          `
          : ""
      }

      <h3 class="shop-tab-title">${escHtml(selected.display_name)}</h3>

      ${
        selected.blueprint_name
          ? `<div class="shop-path"><strong>Bauplan:</strong> ${escHtml(selected.blueprint_name)}</div>`
          : ""
      }

      ${
        path.length > 1
          ? `<div class="shop-path"><strong>Upgrade-Pfad:</strong> ${path.map((v) => escHtml(v.display_name)).join(" → ")}</div>`
          : ""
      }

      <div class="shop-modal-media">
        <div class="shop-modal-img-box">
          ${
            allImgs[0]
              ? `<img id="modalVehicleImg" class="shop-modal-img" src="${escHtml(allImgs[0])}" alt="${escHtml(selected.display_name)}">`
              : `<div class="shop-modal-img-placeholder">Kein Bild vorhanden.</div>`
          }
        </div>

        ${
          allImgs.length > 1
            ? `
              <div class="shop-modal-img-switch">
                ${allImgs.map((_, i) => `
                  <button class="shop-modal-img-btn ${i === 0 ? "active" : ""}" type="button" data-idx="${i}"></button>
                `).join("")}
              </div>
            `
            : ""
        }
      </div>

      ${
        selected.description
          ? `<div class="shop-tab-desc">${escHtml(selected.description)}</div>`
          : ""
      }

      ${
        selected.trunk_size
          ? `<div class="shop-lkw-kofferraum"><strong>Kofferraum:</strong> ${escHtml(selected.trunk_size)}</div>`
          : ""
      }

      <div class="shop-price-row">
        <div class="shop-price-box">
          <div class="shop-price-label">Preis</div>
          <div class="shop-price-main">${euro(selected.price)}</div>
        </div>

        <button type="button" class="shop-request-btn" id="openRequestBtn">
          Anfrage
        </button>
      </div>
    `;

    document.querySelectorAll(".shop-modal-variant-tab").forEach((btn) => {
      btn.onclick = () => {
        const next = variants.find((v) => String(v.id) === String(btn.dataset.id));
        if (next) renderModalVariant(family, next);
      };
    });

    const imgEl = $("modalVehicleImg");
    if (imgEl) {
      imgEl.onclick = () => openLightbox(imgEl.src);
    }

    document.querySelectorAll(".shop-modal-img-btn").forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.idx);
        const img = $("modalVehicleImg");
        if (!img) return;

        img.src = allImgs[i];

        document.querySelectorAll(".shop-modal-img-btn").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
      };
    });

    const openRequestBtn = $("openRequestBtn");
    if (openRequestBtn) {
      openRequestBtn.onclick = () => openRequest(selected);
    }
  }

  function closeModal() {
    const modal = $("shopModal");
    if (!modal) return;

    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
  }

  function openLightbox(src) {
    const box = $("imageLightbox");
    const img = $("imageLightboxImg");

    if (!box || !img) return;

    img.src = src;
    box.classList.add("active");
    box.setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    const box = $("imageLightbox");
    const img = $("imageLightboxImg");

    if (!box || !img) return;

    box.classList.remove("active");
    box.setAttribute("aria-hidden", "true");
    img.src = "";
  }

  function openRequest(v) {
    activeSelection = v;

    const modal = $("requestModal");
    if (!modal) return;

    const summary = $("requestSummary");

    if (summary) {
      summary.innerHTML = `
        <strong>Fahrzeug:</strong> ${escHtml(v.display_name)}<br>
        <strong>Craft-Key:</strong> ${escHtml(v.craft_key || "-")}<br>
        <strong>Preis:</strong> ${euro(v.price)}
      `;
    }

    const status = $("requestStatus");
    if (status) {
      status.className = "shop-form-status";
      status.textContent = "";
    }

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeRequest() {
    const modal = $("requestModal");
    if (!modal) return;

    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
  }

  async function submitRequest(ev) {
    ev.preventDefault();

    const name = $("reqName")?.value.trim() || "";
    const contact = $("reqKontakt")?.value.trim() || "";
    const note = $("reqNote")?.value.trim() || "";
    const status = $("requestStatus");
    const send = $("requestSend");

    if (!name || !contact || !activeSelection) {
      if (status) {
        status.className = "shop-form-status err";
        status.textContent = "Bitte Name und Kontakt ausfüllen.";
      }
      return;
    }

    if (send) {
      send.disabled = true;
      send.textContent = "Sende…";
    }

    if (status) {
      status.className = "shop-form-status";
      status.textContent = "";
    }

    try {
      const message = [
        `Fahrzeug: ${activeSelection.display_name}`,
        `Craft-Key: ${activeSelection.craft_key || "-"}`,
        `Preis: ${euro(activeSelection.price)}`,
        `Kontakt: ${contact}`,
        note ? `Notiz: ${note}` : ""
      ].filter(Boolean).join("\n");

      const { error } = await window.lfcSupabase
        .from("contact_requests")
        .insert({
          name,
          subject: "Fahrzeug-Anfrage: " + activeSelection.display_name,
          message
        });

      if (error) throw error;

      await triggerDiscordNotify();

      if (status) {
        status.className = "shop-form-status ok";
        status.textContent = "✅ Anfrage gesendet.";
      }

      const form = $("requestForm");
      if (form) form.reset();

      setTimeout(closeRequest, 1300);
    } catch (error) {
      console.error(error);

      if (status) {
        status.className = "shop-form-status err";
        status.textContent =
          "❌ Anfrage konnte nicht gespeichert oder an Discord weitergegeben werden.";
      }
    } finally {
      if (send) {
        send.disabled = false;
        send.textContent = "Anfrage senden";
      }
    }
  }

  function bindEvents() {
    const search = $("shopSearch");
    if (search) search.addEventListener("input", filter);

    const modalClose = $("shopModalClose");
    if (modalClose) modalClose.onclick = closeModal;

    const modalBackdrop = document.querySelector("#shopModal .shop-modal-backdrop");
    if (modalBackdrop) modalBackdrop.onclick = closeModal;

    const requestClose = $("requestModalClose");
    if (requestClose) requestClose.onclick = closeRequest;

    const requestCancel = $("requestCancel");
    if (requestCancel) requestCancel.onclick = closeRequest;

    const requestBackdrop = document.querySelector("#requestModal .shop-modal-backdrop");
    if (requestBackdrop) requestBackdrop.onclick = closeRequest;

    const lightboxBackdrop = document.querySelector("#imageLightbox .shop-img-lightbox-backdrop");
    if (lightboxBackdrop) lightboxBackdrop.onclick = closeLightbox;

    const requestForm = $("requestForm");
    if (requestForm) requestForm.addEventListener("submit", submitRequest);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
        closeRequest();
        closeLightbox();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadVehicles();
  });
})();
