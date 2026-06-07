(function () {
  "use strict";

  /*
    LFC Katalog
    - Supabase liefert Preis/Beschreibung/Bilder/Gruppe/Kofferraum
    - Google Crafting-Sheet liefert weiterhin Upgrade-/Abhängigkeitslogik
    - Nur LFC, keine Theme-Umschaltung
  */

  const CRAFT_SHEET_ID = "1ObAKUBNv5IjXEyY0TD85gK9dJhlm8Uq7Qj6QZgHkoZg";
  const TAB_RECIPES = "recipes";
  const TAB_ITEMS = "recipe_items";

  let vehicles = [];
  let families = [];
  let cards = [];
  let groupSections = [];

  let craftDeps = {};
  let craftDepsRaw = {};
  let recipeInfo = {};
  let craftLoaded = false;

  let currentFamily = null;
  let activeRequest = null;

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

  function normText(str) {
    return String(str ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normKey(v) {
    return String(v ?? "")
      .normalize("NFKC")
      .replace(/[\u00A0\u200B\t\n\r]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[;:]+$/, "")
      .toLowerCase();
  }

  function groupDomId(name) {
    return "group-" + normText(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function euro(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return "-";
    return n.toLocaleString("de-DE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0
    });
  }

  function stripBauplan(name) {
    return String(name || "").replace(/\s*Bauplan\s*$/i, "").trim();
  }

  function normalizeImageUrl(url) {
    const s = String(url || "").trim();

    if (!s) return "";

  // Nur echte HTTPS-Bildpfade sind gültig.
  // Relative Pfade, GitHub-Blob-Pfade, http://, data: und blob: werden ignoriert.
    if (!/^https:\/\//i.test(s)) return "";

    return s;
  }

  function getVehicleImages(v) {
    const out = [];

    if (Array.isArray(v.images)) {
      v.images.forEach((img) => {
        const url = normalizeImageUrl(img && img.url ? img.url : img);
        if (url) out.push(url);
      });
    }

    const unique = [];
    const seen = new Set();

    out.forEach((url) => {
      const key = url.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(url);
    });

    return unique;
  }

  function firstVehicleImage(v) {
    const imgs = getVehicleImages(v);
    return imgs[0] || "";
  }

  function pickPictureUrls(pictureField) {
    const s = String(pictureField || "").trim();
    if (!s) return [];

    return s
      .split(";")
      .map((x) => normalizeImageUrl(x.trim()))
      .filter(Boolean);
  }

  function gvizJSONP(sheetName, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const cb = "gvizCb_" + Math.random().toString(36).slice(2);
      const url =
        "https://docs.google.com/spreadsheets/d/" +
        encodeURIComponent(CRAFT_SHEET_ID) +
        "/gviz/tq?tqx=out:json,responseHandler:" +
        cb +
        "&headers=1&sheet=" +
        encodeURIComponent(sheetName);

      const script = document.createElement("script");

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout beim Laden von " + sheetName));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        try {
          delete window[cb];
        } catch (e) {
          window[cb] = undefined;
        }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cb] = function (payload) {
        cleanup();

        try {
          const cols = (payload.table.cols || []).map((c, i) => {
            return String(c.label || c.id || "c" + i).trim();
          });

          const rows = (payload.table.rows || []).map((r) => {
            const o = {};
            (r.c || []).forEach((cell, i) => {
              o[cols[i] || "c" + i] = cell ? cell.v : "";
            });
            return o;
          });

          resolve(rows);
        } catch (e) {
          reject(e);
        }
      };

      script.src = url;
      script.onerror = function () {
        cleanup();
        reject(new Error("GViz konnte nicht geladen werden: " + sheetName));
      };

      document.head.appendChild(script);
    });
  }

  async function ensureCraftLoaded() {
    if (craftLoaded) return;

    const [itemsRows, recipesRows] = await Promise.all([
      gvizJSONP(TAB_ITEMS),
      gvizJSONP(TAB_RECIPES)
    ]);

    const depsMapNorm = {};
    const depsMapRaw = {};

    itemsRows.forEach((r) => {
      const productRaw = String(r.product ?? "").trim();
      const itemRaw = String(r.item ?? "").trim();
      const qty = Number(r.qty || 0) || 0;

      if (!productRaw || !itemRaw || !qty) return;

      const product = normKey(productRaw);
      const item = normKey(itemRaw);

      if (!depsMapNorm[product]) depsMapNorm[product] = {};
      depsMapNorm[product][item] = true;

      if (!depsMapRaw[product]) depsMapRaw[product] = {};
      depsMapRaw[product][itemRaw] = true;
    });

    craftDeps = {};
    craftDepsRaw = {};

    Object.keys(depsMapNorm).forEach((key) => {
      craftDeps[key] = Object.keys(depsMapNorm[key]);
    });

    Object.keys(depsMapRaw).forEach((key) => {
      craftDepsRaw[key] = Object.keys(depsMapRaw[key]);
    });

    recipeInfo = {};

    recipesRows.forEach((r) => {
      const key = normKey(r.key ?? r.Key ?? r.craft ?? r.Craft);
      if (!key) return;

      recipeInfo[key] = {
        name: String(r.name ?? r.Name ?? "").trim(),
        picture: String(r.picture ?? r.Picture ?? "").trim(),
        selectable: r.selectable ?? r.Selectable ?? r.bucket ?? r.Bucket ?? ""
      };
    });

    craftLoaded = true;
  }

  function craftDependsOn(childKey, ancestorKey) {
    const start = normKey(childKey);
    const target = normKey(ancestorKey);

    if (!start || !target || start === target) return false;

    const visited = {};
    const stack = [start];

    while (stack.length) {
      const key = stack.pop();
      const deps = craftDeps[key] || [];

      for (const dep of deps) {
        if (dep === target) return true;

        if (!visited[dep]) {
          visited[dep] = true;
          stack.push(dep);
        }
      }
    }

    return false;
  }

  function hasCraftRelation(a, b) {
    if (!a || !b) return false;
    return craftDependsOn(a.craft_key, b.craft_key) || craftDependsOn(b.craft_key, a.craft_key);
  }

  function createUnionFind(size) {
    const parent = Array.from({ length: size }, (_, i) => i);

    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }

    function union(a, b) {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent[pb] = pa;
    }

    return { find, union };
  }

  function computeFamilies(vehicleRows) {
    const list = vehicleRows
      .map((v) => ({
        ...v,
        craft_key_norm: normKey(v.craft_key),
        display_name: v.display_name || v.blueprint_name || v.craft_key,
        blueprint_name: v.blueprint_name || "",
        description: v.description || "",
        price: Number(v.price || 0),
        group_name: v.group_name || "Ohne Gruppe",
        group_sort_order: Number(v.group_sort_order ?? 1000),
        sort_order: Number(v.sort_order ?? 1000),
        autoLevel: 0
      }))
      .filter((v) => v.craft_key_norm);

    const uf = createUnionFind(list.length);

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (hasCraftRelation(list[i], list[j])) {
          uf.union(i, j);
        }
      }
    }

    const byComponent = new Map();

    list.forEach((v, index) => {
      const root = uf.find(index);
      if (!byComponent.has(root)) byComponent.set(root, []);
      byComponent.get(root).push(v);
    });

    const result = [];

    for (const variants of byComponent.values()) {
      computeFamilyGraph(variants);

      let base = variants[0];

      variants.forEach((v) => {
        if ((v.autoLevel || 0) < (base.autoLevel || 0)) {
          base = v;
        } else if ((v.autoLevel || 0) === (base.autoLevel || 0)) {
          if ((v.sort_order || 1000) < (base.sort_order || 1000)) base = v;
          else if ((v.sort_order || 1000) === (base.sort_order || 1000)) {
            if (String(v.display_name).localeCompare(String(base.display_name), "de") < 0) base = v;
          }
        }
      });

      const fam = {
        id: "fam_" + base.craft_key_norm,
        base,
        variants,
        group_name: base.group_name || "Ohne Gruppe",
        group_sort_order: base.group_sort_order ?? 1000,
        sort_order: base.sort_order ?? 1000,
        byId: {},
        parentById: {},
        childrenMap: {}
      };

      variants.forEach((v) => {
        fam.byId[v.id] = v;
      });

      buildFamilyParents(fam);

      result.push(fam);
    }

    result.sort((a, b) => {
      return (
        (a.group_sort_order ?? 1000) - (b.group_sort_order ?? 1000) ||
        (a.sort_order ?? 1000) - (b.sort_order ?? 1000) ||
        String(a.base.display_name).localeCompare(String(b.base.display_name), "de")
      );
    });

    return result;
  }

  function computeFamilyGraph(variants) {
    const levelMemo = {};

    function levelOf(vehicle) {
      if (levelMemo[vehicle.id] != null) return levelMemo[vehicle.id];

      const parents = variants.filter((possibleParent) => {
        if (possibleParent.id === vehicle.id) return false;
        return craftDependsOn(vehicle.craft_key, possibleParent.craft_key);
      });

      if (!parents.length) {
        levelMemo[vehicle.id] = 0;
        return 0;
      }

      let maxParentLevel = 0;

      parents.forEach((parent) => {
        maxParentLevel = Math.max(maxParentLevel, levelOf(parent) + 1);
      });

      levelMemo[vehicle.id] = maxParentLevel;
      return maxParentLevel;
    }

    variants.forEach((v) => {
      v.autoLevel = levelOf(v);
    });

    variants.sort((a, b) => {
      return (
        (a.autoLevel || 0) - (b.autoLevel || 0) ||
        (a.sort_order || 1000) - (b.sort_order || 1000) ||
        String(a.display_name).localeCompare(String(b.display_name), "de")
      );
    });
  }

  function buildFamilyParents(fam) {
    const variants = fam.variants || [];
    const parentById = {};
    const childrenMap = {};

    variants.forEach((v) => {
      childrenMap[v.id] = [];
    });

    variants.forEach((child) => {
      if (child.id === fam.base.id) return;

      const candidates = variants.filter((possibleParent) => {
        if (possibleParent.id === child.id) return false;
        if ((possibleParent.autoLevel || 0) >= (child.autoLevel || 0)) return false;
        return craftDependsOn(child.craft_key, possibleParent.craft_key);
      });

      candidates.sort((a, b) => {
        return (
          (b.autoLevel || 0) - (a.autoLevel || 0) ||
          (a.sort_order || 1000) - (b.sort_order || 1000) ||
          String(a.display_name).localeCompare(String(b.display_name), "de")
        );
      });

      if (candidates[0]) {
        parentById[child.id] = candidates[0].id;
        childrenMap[candidates[0].id].push(child.id);
      }
    });

    fam.parentById = parentById;
    fam.childrenMap = childrenMap;
  }

  function chainToBase(fam, nodeId) {
    const chain = [];
    let current = fam.byId[nodeId];
    let safety = 0;

    while (current && safety < 100) {
      chain.push(current);

      if (current.id === fam.base.id) break;

      const parentId = fam.parentById[current.id];
      if (!parentId) break;

      current = fam.byId[parentId];
      safety++;
    }

    return chain.reverse();
  }

  function chainLabel(chain) {
    return chain.map((v) => v.display_name).join(" → ");
  }

  function allUpgradeNames(fam) {
    const upgrades = (fam.variants || [])
      .filter((v) => v.id !== fam.base.id)
      .sort((a, b) => {
        return (
          (a.autoLevel || 0) - (b.autoLevel || 0) ||
          (a.sort_order || 1000) - (b.sort_order || 1000) ||
          String(a.display_name).localeCompare(String(b.display_name), "de")
        );
      })
      .map((v) => v.display_name);

    return upgrades.length ? "→ " + upgrades.join(" → ") : "";
  }

  async function loadVehicles() {
    const status = $("shopStatus");

    try {
      status.classList.remove("bt-error");
      status.textContent = "🔄 Fahrzeugdaten und Upgrade-Pfade werden geladen …";

      await ensureCraftLoaded();

      const { data, error } = await window.lfcSupabase
        .from("public_vehicle_catalog")
        .select("*");

      if (error) throw error;

      vehicles = (data || []).map((v) => ({
        ...v,
        images: Array.isArray(v.images) ? v.images : []
      }));

      families = computeFamilies(vehicles);

      render();

      status.textContent =
        "✅ " +
        vehicles.length +
        " Fahrzeuge in " +
        families.length +
        " Fahrzeugfamilien geladen.";
    } catch (err) {
      console.error(err);
      status.classList.add("bt-error");
      status.textContent =
        "❌ Fahrzeugdaten konnten nicht geladen werden. Prüfe Supabase, public_vehicle_catalog und ob das Crafting-Sheet öffentlich lesbar ist.";
    }
  }

  function renderGroupNav(groupNames) {
    const nav = $("shopGroupNav");
    nav.innerHTML = "";

    groupNames.forEach((name) => {
      const btn = document.createElement("button");
      btn.className = "shop-group-nav-item";
      btn.type = "button";
      btn.textContent = name;

      btn.addEventListener("click", () => {
        const target = document.getElementById(groupDomId(name));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      nav.appendChild(btn);
    });
  }

  function render() {
    const content = $("shopContent");
    content.innerHTML = "";

    cards = [];
    groupSections = [];

    const byGroup = new Map();

    families.forEach((fam) => {
      const group = fam.group_name || "Ohne Gruppe";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push(fam);
    });

    const groupNames = Array.from(byGroup.keys());
    renderGroupNav(groupNames);

    for (const [groupName, familyList] of byGroup.entries()) {
      const section = document.createElement("section");
      section.className = "shop-group";
      section.id = groupDomId(groupName);

      section.innerHTML =
        '<div class="shop-group-title">' +
        "<h2>" +
        escHtml(groupName) +
        "</h2>" +
        '<span class="shop-group-count">' +
        familyList.length +
        " Fahrzeuge</span>" +
        "</div>" +
        '<div class="shop-grid"></div>';

      const grid = section.querySelector(".shop-grid");

      familyList.forEach((fam) => {
        const base = fam.base;
        const image = firstVehicleImage(base);
        const upgrades = allUpgradeNames(fam);

        const card = document.createElement("article");
        card.className = "shop-card";

        const searchText = [
          base.display_name,
          base.blueprint_name,
          base.description,
          groupName,
          base.craft_key,
          upgrades,
          fam.variants.map((v) => [v.display_name, v.blueprint_name, v.description, v.craft_key].join(" ")).join(" ")
        ].join(" ");

        card.dataset.search = normText(searchText);

        card.innerHTML =
          '<div class="shop-card-media">' +
          (image
            ? '<img src="' + escHtml(image) + '" alt="' + escHtml(base.display_name) + '" loading="lazy">'
            : '<div class="shop-modal-img-placeholder">Kein Bild vorhanden</div>') +
          "</div>" +
          '<div class="shop-card-body">' +
          "<div>" +
          '<h3 class="shop-card-title">' +
          escHtml(base.display_name) +
          "</h3>" +
          '<div class="shop-card-upgrades">' +
          (upgrades
            ? "<strong>Upgrades:</strong><span>" + escHtml(upgrades) + "</span>"
            : "<span>" + escHtml((base.description || "").slice(0, 120)) + ((base.description || "").length > 120 ? "…" : "") + "</span>") +
          "</div>" +
          "</div>" +
          '<p class="shop-card-price-main">' +
          escHtml(euro(base.price)) +
          "</p>" +
          "</div>";

        card.addEventListener("click", () => openModalForFamily(fam));

        grid.appendChild(card);
        cards.push(card);
      });

      content.appendChild(section);
      groupSections.push(section);
    }

    const info = $("shopSearchInfo");
    if (info) info.textContent = families.length + " Einträge";
  }

  function filterCatalog() {
    const query = normText($("shopSearch").value);
    let shown = 0;

    cards.forEach((card) => {
      const ok = !query || String(card.dataset.search || "").includes(query);
      card.style.display = ok ? "" : "none";
      if (ok) shown++;
    });

    groupSections.forEach((group) => {
      const anyVisible = Array.from(group.querySelectorAll(".shop-card")).some((card) => {
        return card.style.display !== "none";
      });

      group.style.display = anyVisible ? "" : "none";
    });

    $("shopNoResults").style.display = shown ? "none" : "block";

    const info = $("shopSearchInfo");
    if (info) info.textContent = shown + " Treffer";
  }

  function getNodeImages(node) {
    let images = getVehicleImages(node);

    if (!images.length && node.craft_key) {
      const info = recipeInfo[normKey(node.craft_key)];
      if (info && info.picture) images = pickPictureUrls(info.picture);
    }

    return images;
  }

  function openModalForFamily(fam) {
    currentFamily = fam;

    const modal = $("shopModal");
    const content = $("shopModalContent");

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");

    const tabNodes = (fam.variants || []).slice().sort((a, b) => {
      return (
        (a.autoLevel || 0) - (b.autoLevel || 0) ||
        (a.sort_order || 1000) - (b.sort_order || 1000) ||
        String(a.display_name).localeCompare(String(b.display_name), "de")
      );
    });

    if (!tabNodes.length) {
      $("shopModalTitle").textContent = "Fahrzeug";
      content.innerHTML = '<div class="bt-hint bt-error">⚠️ Keine Varianten gefunden.</div>';
      return;
    }

    let html = "";

    html += '<div class="shop-tabs">';
    html += '<div class="shop-tab-buttons">';

    tabNodes.forEach((node, index) => {
      const tabId = "tab_" + node.id;
      html +=
        '<button type="button" class="shop-tab-button' +
        (index === 0 ? " active" : "") +
        '" data-tab="' +
        escHtml(tabId) +
        '">' +
        escHtml(node.display_name) +
        "</button>";
    });

    html += "</div>";
    html += '<div class="shop-tab-panels">';

    tabNodes.forEach((node, index) => {
      const tabId = "tab_" + node.id;
      const chain = chainToBase(fam, node.id);
      const imgs = getNodeImages(node);
      const chainCompact = chain.map((n) => ({
        id: n.id,
        craft_key: n.craft_key,
        name: n.display_name,
        price: Number(n.price || 0)
      }));

      html +=
        '<div class="shop-tab-panel' +
        (index === 0 ? " active" : "") +
        '" data-tab="' +
        escHtml(tabId) +
        '" data-title="' +
        escHtml(node.display_name) +
        '" data-chain="' +
        escHtml(JSON.stringify(chainCompact)) +
        '">';

      html += '<h3 class="shop-tab-title">' + escHtml(node.display_name) + "</h3>";

      if (node.blueprint_name) {
        html +=
          '<div class="shop-path"><strong>Bauplan:</strong> ' +
          escHtml(stripBauplan(node.blueprint_name)) +
          "</div>";
      }

      html +=
        '<div class="shop-path shop-path-main"><strong>Pfad:</strong> ' +
        escHtml(chainLabel(chain)) +
        "</div>";

      html += '<div class="shop-modal-media">';
      html += '<div class="shop-modal-img-box">';

      if (imgs.length) {
        html +=
          '<img class="shop-modal-img" src="' +
          escHtml(imgs[0]) +
          '" alt="" data-imgs="' +
          escHtml(JSON.stringify(imgs)) +
          '" data-full="' +
          escHtml(imgs[0]) +
          '">';
      } else {
        html += '<div class="shop-modal-img-placeholder">Kein Bild vorhanden.</div>';
      }

      html += "</div>";

      if (imgs.length > 1) {
        html += '<div class="shop-modal-img-switch">';
        imgs.forEach((_, i) => {
          html +=
            '<button class="shop-modal-img-btn' +
            (i === 0 ? " active" : "") +
            '" type="button" data-idx="' +
            i +
            '"></button>';
        });
        html += "</div>";
      }

      html += "</div>";

      if (node.description) {
        html += '<div class="shop-tab-desc">' + escHtml(node.description) + "</div>";
      }

      if (node.trunk_size) {
        html +=
          '<div class="shop-lkw-kofferraum"><strong>Kofferraum:</strong> ' +
          escHtml(node.trunk_size) +
          "</div>";
      }

      html += '<div class="shop-price-row">';
      html += '<div class="shop-price-box">';
      html += '<div class="shop-price-label">Preis</div>';
      html += '<div class="shop-price-main">' + escHtml(euro(node.price)) + "</div>";
      html += "</div>";
      html += '<button type="button" class="shop-request-btn">Anfrage</button>';
      html += "</div>";

      html += "</div>";
    });

    html += "</div>";
    html += "</div>";

    content.innerHTML = html;

    bindModalTabs();

    const firstTab = content.querySelector(".shop-tab-button");
    if (firstTab) activateTab(firstTab.getAttribute("data-tab"));
  }

  function bindModalTabs() {
    const content = $("shopModalContent");

    content.querySelectorAll(".shop-tab-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        activateTab(btn.getAttribute("data-tab"));
      });
    });
  }

  function activateTab(tabId) {
    const content = $("shopModalContent");

    content.querySelectorAll(".shop-tab-button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
    });

    content.querySelectorAll(".shop-tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.getAttribute("data-tab") === tabId);
    });

    const panel = content.querySelector('.shop-tab-panel[data-tab="' + CSS.escape(tabId) + '"]');
    if (!panel) return;

    const title = panel.getAttribute("data-title") || "Fahrzeug";
    $("shopModalTitle").textContent = title;

    const img = panel.querySelector(".shop-modal-img");
    const imgButtons = panel.querySelectorAll(".shop-modal-img-btn");

    if (img) {
      let imgs = [];

      try {
        imgs = JSON.parse(img.getAttribute("data-imgs") || "[]");
      } catch (e) {
        imgs = [];
      }

      function setImage(index) {
        if (!imgs.length) return;

        const safeIndex = Math.max(0, Math.min(imgs.length - 1, index));
        img.src = imgs[safeIndex];
        img.setAttribute("data-full", imgs[safeIndex]);

        imgButtons.forEach((b) => {
          b.classList.toggle("active", Number(b.getAttribute("data-idx")) === safeIndex);
        });
      }

      imgButtons.forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setImage(Number(btn.getAttribute("data-idx")) || 0);
        });
      });

      img.addEventListener("click", () => {
        openLightbox(img.getAttribute("data-full") || img.src);
      });
    }

    const requestBtn = panel.querySelector(".shop-request-btn");

    if (requestBtn) {
      requestBtn.addEventListener("click", () => {
        let chain = [];

        try {
          chain = JSON.parse(panel.getAttribute("data-chain") || "[]");
        } catch (e) {
          chain = [];
        }

        openRequestModal({
          vehicleTitle: title,
          chain,
          mode: "total"
        });
      });
    }
  }

  function closeModal() {
    const modal = $("shopModal");
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
    $("shopModalContent").innerHTML = "";
    currentFamily = null;
  }

  function openLightbox(src) {
    if (!src) return;
    $("imageLightboxImg").src = src;
    $("imageLightbox").classList.add("active");
    $("imageLightbox").setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    $("imageLightbox").classList.remove("active");
    $("imageLightbox").setAttribute("aria-hidden", "true");
    $("imageLightboxImg").src = "";
  }

  function ensureRequestModeUi() {
    const form = $("requestForm");
    let wrap = $("requestModeWrap");

    if (wrap) return wrap;

    wrap = document.createElement("div");
    wrap.id = "requestModeWrap";
    wrap.className = "shop-field";
    wrap.innerHTML =
      '<label for="reqMode">Upgrade-Auswahl</label>' +
      '<select id="reqMode"></select>';

    const summary = $("requestSummary");
    summary.insertAdjacentElement("afterend", wrap);

    wrap.querySelector("select").addEventListener("change", () => {
      if (!activeRequest) return;
      activeRequest.mode = $("reqMode").value || "total";
      renderRequestSummary();
    });

    form._requestModeWrap = wrap;
    return wrap;
  }

  function idxByIdInChain(chain, id) {
    return chain.findIndex((x) => x.id === id);
  }

  function sumFromExclusiveChain(chain, fromIdx) {
    let total = 0;

    for (let i = fromIdx + 1; i < chain.length; i++) {
      total += Number(chain[i].price || 0);
    }

    return total;
  }

  function calcRequestSelection(chain, mode) {
    if (!Array.isArray(chain) || !chain.length) {
      return {
        fromName: "",
        toName: "",
        segmentPrice: 0,
        path: ""
      };
    }

    let fromIdx = 0;
    const toIdx = chain.length - 1;

    if (mode === "prev") {
      fromIdx = Math.max(0, chain.length - 2);
    } else if (mode && mode.indexOf("from:") === 0) {
      const id = mode.slice(5);
      const idx = idxByIdInChain(chain, id);
      if (idx >= 0 && idx < chain.length - 1) fromIdx = idx;
    }

    const fromName = chain[fromIdx] ? chain[fromIdx].name : "";
    const toName = chain[toIdx] ? chain[toIdx].name : "";

    return {
      fromName,
      toName,
      segmentPrice: sumFromExclusiveChain(chain, fromIdx),
      path: (fromName || "—") + " → " + (toName || "—")
    };
  }

  function openRequestModal(ctx) {
    activeRequest = ctx || null;

    const chain = activeRequest && Array.isArray(activeRequest.chain) ? activeRequest.chain : [];
    const modeWrap = ensureRequestModeUi();
    const select = $("reqMode");

    select.innerHTML = "";

    if (chain.length >= 2) {
      modeWrap.style.display = "";

      const totalOption = document.createElement("option");
      totalOption.value = "total";
      totalOption.textContent = "Basis → aktuelles Modell";
      select.appendChild(totalOption);

      const prevOption = document.createElement("option");
      prevOption.value = "prev";
      prevOption.textContent = "Nur letztes Upgrade";
      select.appendChild(prevOption);

      for (let i = 0; i < chain.length - 1; i++) {
        const opt = document.createElement("option");
        opt.value = "from:" + chain[i].id;
        opt.textContent = "Upgrade ab: " + chain[i].name;
        select.appendChild(opt);
      }

      select.value = activeRequest.mode || "total";
    } else {
      modeWrap.style.display = "none";
    }

    $("requestStatus").className = "shop-form-status";
    $("requestStatus").textContent = "";

    renderRequestSummary();

    $("requestModal").classList.add("active");
    $("requestModal").setAttribute("aria-hidden", "false");

    setTimeout(() => {
      try {
        $("reqName").focus();
      } catch (e) {}
    }, 50);
  }

  function renderRequestSummary() {
    if (!activeRequest) return;

    const chain = activeRequest.chain || [];
    const mode = activeRequest.mode || "total";
    const selection = calcRequestSelection(chain, mode);

    $("requestSummary").innerHTML =
      "<strong>Übersicht:</strong><br>" +
      "Fahrzeug: <strong>" +
      escHtml(activeRequest.vehicleTitle || "Fahrzeug") +
      "</strong><br>" +
      "Pfad: <strong>" +
      escHtml(selection.path || activeRequest.vehicleTitle || "—") +
      "</strong><br>" +
      "Preis Auswahl: <strong>" +
      escHtml(euro(selection.segmentPrice || 0)) +
      "</strong>";
  }

  function closeRequestModal() {
    $("requestModal").classList.remove("active");
    $("requestModal").setAttribute("aria-hidden", "true");
    activeRequest = null;
  }

  async function submitRequest(ev) {
    ev.preventDefault();

    const name = $("reqName").value.trim();
    const contact = $("reqKontakt").value.trim();
    const note = $("reqNote").value.trim();
    const status = $("requestStatus");
    const send = $("requestSend");

    if (!name || !contact || !activeRequest) {
      status.className = "shop-form-status err";
      status.textContent = "Bitte Name und Kontakt ausfüllen.";
      return;
    }

    const chain = activeRequest.chain || [];
    const mode = activeRequest.mode || "total";
    const selection = calcRequestSelection(chain, mode);

    send.disabled = true;
    send.textContent = "Sende…";
    status.className = "shop-form-status";
    status.textContent = "";

    try {
      const message = [
        "Fahrzeug: " + (activeRequest.vehicleTitle || "-"),
        "Pfad: " + (selection.path || "-"),
        "Preis Auswahl: " + euro(selection.segmentPrice || 0),
        "Kontakt: " + contact,
        note ? "Notiz: " + note : ""
      ]
        .filter(Boolean)
        .join("\n");

      const { error } = await window.lfcSupabase.from("contact_requests").insert({
        name,
        subject: "Fahrzeug-Anfrage: " + (activeRequest.vehicleTitle || "Fahrzeug"),
        message
      });

      if (error) throw error;

      status.className = "shop-form-status ok";
      status.textContent = "✅ Anfrage gesendet.";
      $("requestForm").reset();

      setTimeout(closeRequestModal, 1100);
    } catch (err) {
      console.error(err);
      status.className = "shop-form-status err";
      status.textContent =
        "❌ Anfrage konnte nicht gespeichert werden. Prüfe Supabase anon key und RLS-Policy.";
    } finally {
      send.disabled = false;
      send.textContent = "Anfrage senden";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("shopSearch").addEventListener("input", filterCatalog);

    $("shopModalClose").addEventListener("click", closeModal);
    document.querySelector("#shopModal .shop-modal-backdrop").addEventListener("click", closeModal);

    $("requestModalClose").addEventListener("click", closeRequestModal);
    $("requestCancel").addEventListener("click", closeRequestModal);
    document.querySelector("#requestModal .shop-modal-backdrop").addEventListener("click", closeRequestModal);

    $("imageLightbox")
      .querySelector(".shop-img-lightbox-backdrop")
      .addEventListener("click", closeLightbox);

    $("requestForm").addEventListener("submit", submitRequest);

    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      closeModal();
      closeRequestModal();
      closeLightbox();
    });

    loadVehicles();
  });
})();
