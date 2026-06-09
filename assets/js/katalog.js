(function () {
  "use strict";

  let vehicles = [];
  let allCards = [];
  let allGroups = [];
  let activeFamily = null;
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

  function slug(str) {
    return norm(str)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
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

  function setStatus(message, isError = false) {
    const el = $("shopStatus");
    if (!el) return;

    el.textContent = message || "";
    el.classList.toggle("bt-error", !!isError);
  }

  function setSearchInfo(message) {
    const byId = $("shopSearchInfo");
    const byClass = document.querySelector(".shop-search-info");

    if (byId) byId.textContent = message || "";
    if (byClass) byClass.textContent = message || "";
  }

  function normalizeImageUrl(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    if (!/^https:\/\//i.test(s)) return "";
    return s;
  }

  function imgs(v) {
    if (!Array.isArray(v.images)) return [];

    return v.images
      .slice()
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((x) => normalizeImageUrl(x.url))
      .filter(Boolean);
  }

  function firstImg(v) {
    return imgs(v)[0] || "";
  }

  function vehicleKey(v) {
    return normKey(v.craft_key || v.blueprint_name || v.display_name || v.id);
  }

  function isCraftKey(value) {
    return /^craft_\d+$/i.test(String(value || "").trim());
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

  function groupName(v) {
    return v.group_name || "Ohne Gruppe";
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

  function gvizJSONP(sheetName, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const cb =
        "__lfc_gviz_" +
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
    if (!craftParents[item]) craftParents[item] = new Set();

    craftDeps[product].add(item);
    craftParents[item].add(product);
  }

  async function loadCraftDependencies() {
    craftDeps = {};
    craftParents = {};
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

      craftParents = Object.fromEntries(
        Object.entries(craftParents).map(([key, set]) => [key, Array.from(set)])
      );

      craftLoaded = Object.keys(craftDeps).length > 0;
    } catch (error) {
      console.warn("Upgrade-Daten konnten nicht geladen werden. Fallback-Gruppierung wird genutzt.", error);
      craftDeps = {};
      craftParents = {};
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

  function getVehicleMap() {
    const map = new Map();

    vehicles.forEach((v) => {
      map.set(vehicleKey(v), v);
    });

    return map;
  }

  function nameWithoutBlueprint(name) {
    return String(name || "")
      .replace(/\s*Bauplan\s*$/i, "")
      .trim();
  }

  function fallbackFamilyKey(v) {
    let s = nameWithoutBlueprint(v.display_name || v.blueprint_name || "");

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

    return normKey(groupName(v) + "::" + s);
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

        const linked =
          craftDependsOn(ak, bk) ||
          craftDependsOn(bk, ak);

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

    const fallback = fallbackFamiliesByName(Array.from(byId.values()));

    fallback.forEach((family) => {
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

  function buildFamilyObjects() {
    const byGroup = new Map();

    vehicles.forEach((v) => {
      const g = groupName(v);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(v);
    });

    const groups = [];

    for (const [name, items] of byGroup) {
      const craftFamilies = connectedFamiliesByCraft(items);
      const mergedFamilies = mergeSmallCraftFamiliesWithNameFallback(craftFamilies, items);

      const families = mergedFamilies.map((list) => {
        const variants = sortFamilyVariants(list);
        const base = getBaseVariant(variants) || variants[0];

        return {
          groupName: name,
          groupSortOrder: base?.group_sort_order ?? 1000,
          base,
          variants
        };
      });

      families.sort((a, b) => {
        return (
          Number(a.base?.sort_order || 1000) - Number(b.base?.sort_order || 1000) ||
          String(a.base?.display_name || "").localeCompare(String(b.base?.display_name || ""), "de")
        );
      });

      groups.push({
        name,
        sortOrder: families[0]?.groupSortOrder ?? 1000,
        families
      });
    }

    groups.sort((a, b) => {
      return (
        Number(a.sortOrder || 1000) - Number(b.sortOrder || 1000) ||
        String(a.name || "").localeCompare(String(b.name || ""), "de")
      );
    });

    return groups;
  }

  function getUpgradeNames(family) {
    return family.variants
      .filter((v) => v.id !== family.base.id)
      .map((v) => v.display_name)
      .filter(Boolean);
  }

  function getUpgradePath(family, selected) {
    const key = vehicleKey(selected);
    const familyKeys = new Set(family.variants.map(vehicleKey));
    const byKey = new Map(family.variants.map((v) => [vehicleKey(v), v]));

    const path = [];
    const seen = new Set();

    function walk(currentKey) {
      if (!currentKey || seen.has(currentKey)) return;
      seen.add(currentKey);

      const parents = (craftDeps[currentKey] || [])
        .filter((dep) => familyKeys.has(dep))
        .map((dep) => byKey.get(dep))
        .filter(Boolean)
        .sort((a, b) => {
          return (
            familyLevel(a, family.variants, {}) - familyLevel(b, family.variants, {}) ||
            Number(a.sort_order || 1000) - Number(b.sort_order || 1000)
          );
        });

      if (parents[0]) {
        walk(vehicleKey(parents[0]));
      }

      const node = byKey.get(currentKey);
      if (node) path.push(node);
    }

    walk(key);

    if (!path.length) return [selected];

    return path;
  }

  async function loadVehicles() {
    try {
      setStatus("Lade Fahrzeugkatalog …");

      const { data, error } = await window.lfcSupabase
        .from("public_vehicle_catalog")
        .select("*");

      if (error) throw error;

      vehicles = (data || [])
        .filter((v) => v.group_name)
        .sort((a, b) => {
          return (
            Number(a.group_sort_order || 1000) - Number(b.group_sort_order || 1000) ||
            Number(a.sort_order || 1000) - Number(b.sort_order || 1000) ||
            String(a.display_name || "").localeCompare(String(b.display_name || ""), "de")
          );
        });

      await loadCraftDependencies();

      renderCatalog();

      setStatus(
        `✅ ${vehicles.length} Fahrzeuge geladen${
          craftLoaded ? " – Upgrades wurden gruppiert." : " – Fallback-Gruppierung aktiv."
        }`
      );
    } catch (error) {
      console.error(error);
      setStatus("❌ Fahrzeugdaten konnten nicht geladen werden: " + (error.message || String(error)), true);
    }
  }

  function renderGroupNav(groupObjects) {
    const nav = $("shopGroupNav");
    if (!nav) return;

    nav.innerHTML = "";

    groupObjects.forEach((group) => {
      const btn = document.createElement("button");
      btn.className = "shop-group-nav-item";
      btn.type = "button";
      btn.textContent = group.name;

      btn.onclick = () => {
        const target = document.getElementById("group-" + slug(group.name));
        if (target) {
          target.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      };

      nav.appendChild(btn);
    });
  }

  function renderCatalog() {
    const content = $("shopContent");
    const noResults = $("shopNoResults");

    if (!content) return;

    content.innerHTML = "";
    allCards = [];
    allGroups = [];

    const groupObjects = buildFamilyObjects();

    renderGroupNav(groupObjects);

    groupObjects.forEach((group) => {
      const section = document.createElement("section");
      section.className = "shop-group";
      section.id = "group-" + slug(group.name);

      const header = document.createElement("div");
      header.className = "shop-group-title";
      header.innerHTML = `
        <h2>${escHtml(group.name)}</h2>
        <span class="shop-group-count">${group.families.length} Modell(e)</span>
      `;

      const grid = document.createElement("div");
      grid.className = "shop-grid";

      group.families.forEach((family) => {
        const base = family.base;
        const img = firstImg(base);
        const upgrades = getUpgradeNames(family);

        const card = document.createElement("article");
        card.className = "shop-card";

        card.dataset.search = norm([
          base.display_name,
          base.blueprint_name,
          base.description,
          base.group_name,
          base.craft_key,
          upgrades.join(" "),
          family.variants.map(vehicleSearchText).join(" ")
        ].join(" "));

        card.innerHTML = `
          <div class="shop-card-media">
            ${
              img
                ? `<img src="${escHtml(img)}" alt="${escHtml(base.display_name)}" loading="lazy" onerror="this.style.opacity='.35'">`
                : `<div class="shop-modal-img-placeholder">Kein Bild vorhanden</div>`
            }
          </div>

          <div class="shop-card-body">
            <h3 class="shop-card-title">${escHtml(base.display_name)}</h3>

            ${
              upgrades.length
                ? `
                  <div class="shop-card-upgrades">
                    <div><strong>Upgrades:</strong> ${upgrades.length}</div>
                    <div>→ ${escHtml(upgrades.join(" → "))}</div>
                  </div>
                `
                : `
                  <div class="shop-card-upgrades">
                    ${escHtml(base.description || "").slice(0, 130)}${(base.description || "").length > 130 ? "…" : ""}
                  </div>
                `
            }

            <div class="shop-card-price-main">${euro(base.price)}</div>
          </div>
        `;

        card.onclick = () => openModal(family);

        grid.appendChild(card);
        allCards.push(card);
      });

      section.appendChild(header);
      section.appendChild(grid);
      content.appendChild(section);
      allGroups.push(section);
    });

    if (noResults) noResults.style.display = "none";
    setSearchInfo(`${groupObjects.reduce((sum, g) => sum + g.families.length, 0)} Einträge`);
  }

  function applySearchFilter() {
    const q = norm($("shopSearch")?.value || "");
    let shown = 0;

    allCards.forEach((card) => {
      const ok = !q || card.dataset.search.includes(q);
      card.style.display = ok ? "" : "none";
      if (ok) shown++;
    });

    allGroups.forEach((group) => {
      const hasVisibleCard = Array.from(group.querySelectorAll(".shop-card"))
        .some((card) => card.style.display !== "none");

      group.style.display = hasVisibleCard ? "" : "none";
    });

    const noResults = $("shopNoResults");
    if (noResults) noResults.style.display = shown ? "none" : "block";

    setSearchInfo(`${shown} Treffer`);
  }

  function openModal(family) {
    activeFamily = family;
    activeSelection = family.base;

    const modal = $("shopModal");
    const title = $("shopModalTitle");

    if (!modal) return;

    if (title) title.textContent = family.base.display_name;

    renderModalVariant(family, family.base);

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const modal = $("shopModal");
    if (!modal) return;

    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
  }

  function renderModalVariant(family, selected) {
    activeFamily = family;
    activeSelection = selected;

    const modalContent = $("shopModalContent");
    const modalTitle = $("shopModalTitle");

    if (!modalContent) return;
    if (modalTitle) modalTitle.textContent = family.base.display_name;

    const variants = family.variants;
    const allImgs = imgs(selected);
    const path = getUpgradePath(family, selected);
    const pathText = path.map((v) => v.display_name).join(" → ");

    modalContent.innerHTML = `
      ${
        variants.length > 1
          ? `
            <div class="shop-tabs">
              <div class="shop-tab-buttons">
                ${variants.map((v) => `
                  <button
                    class="shop-tab-button ${v.id === selected.id ? "active" : ""}"
                    type="button"
                    data-id="${escHtml(v.id)}"
                  >
                    ${escHtml(v.display_name)}
                  </button>
                `).join("")}
              </div>
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
          ? `<div class="shop-path"><strong>Upgrade-Pfad:</strong> ${escHtml(pathText)}</div>`
          : ""
      }

      <div class="shop-modal-media">
        <div class="shop-modal-img-box">
          ${
            allImgs[0]
              ? `<img id="modalVehicleImg" class="shop-modal-img" src="${escHtml(allImgs[0])}" alt="${escHtml(selected.display_name)}" loading="lazy">`
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

    document.querySelectorAll(".shop-tab-button").forEach((btn) => {
      btn.onclick = () => {
        const next = variants.find((v) => String(v.id) === String(btn.dataset.id));
        if (next) renderModalVariant(family, next);
      };
    });

    const imgEl = $("modalVehicleImg");
    if (imgEl) imgEl.onclick = () => openLightbox(imgEl.src);

    document.querySelectorAll(".shop-modal-img-btn").forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.idx || 0);
        const img = $("modalVehicleImg");

        if (!img || !allImgs[i]) return;

        img.src = allImgs[i];

        document.querySelectorAll(".shop-modal-img-btn").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
      };
    });

    const requestBtn = $("openRequestBtn");
    if (requestBtn) requestBtn.onclick = () => openRequest(selected);
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

  function openRequest(selected) {
    activeSelection = selected;

    const modal = $("requestModal");
    const summary = $("requestSummary");
    const status = $("requestStatus");
    const modeWrap = $("requestModeWrap");
    const reqMode = $("reqMode");

    if (!modal) return;

    if (summary) {
      const path =
        activeFamily && activeFamily.variants.length > 1
          ? getUpgradePath(activeFamily, selected)
          : [selected];

      summary.innerHTML = `
        <strong>Fahrzeug:</strong> ${escHtml(selected.display_name)}<br>
        <strong>Craft-Key:</strong> ${escHtml(selected.craft_key || "-")}<br>
        <strong>Preis:</strong> ${euro(selected.price)}
        ${
          path.length > 1
            ? `<br><strong>Upgrade-Pfad:</strong> ${escHtml(path.map((v) => v.display_name).join(" → "))}`
            : ""
        }
      `;
    }

    if (modeWrap && reqMode && activeFamily) {
      modeWrap.style.display = activeFamily.variants.length > 1 ? "" : "none";
      reqMode.innerHTML = activeFamily.variants.map((v) => `
        <option value="${escHtml(v.id)}" ${v.id === selected.id ? "selected" : ""}>
          ${escHtml(v.display_name)} – ${euro(v.price)}
        </option>
      `).join("");

      reqMode.onchange = () => {
        const next = activeFamily.variants.find((v) => String(v.id) === String(reqMode.value));
        if (next) {
          activeSelection = next;
          openRequest(next);
        }
      };
    }

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
      const path =
        activeFamily && activeFamily.variants.length > 1
          ? getUpgradePath(activeFamily, activeSelection)
          : [activeSelection];

      const message = [
        `Fahrzeug: ${activeSelection.display_name}`,
        `Craft-Key: ${activeSelection.craft_key || "-"}`,
        `Preis: ${euro(activeSelection.price)}`,
        path.length > 1 ? `Upgrade-Pfad: ${path.map((v) => v.display_name).join(" → ")}` : "",
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

      setTimeout(closeRequest, 1200);
    } catch (error) {
      console.error(error);

      if (status) {
        status.className = "shop-form-status err";
        status.textContent = "❌ Anfrage konnte nicht gesendet werden.";
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
    if (search) search.addEventListener("input", applySearchFilter);

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

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
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
