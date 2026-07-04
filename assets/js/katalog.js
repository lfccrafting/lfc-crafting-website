(function () {
  "use strict";

  let vehicles = [];
  let upgradeEdges = [];
  let allCards = [];
  let allGroups = [];
  let activeFamily = null;
  let activeSelection = null;

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

  function groupName(v) {
    return v.group_name || "Ohne Gruppe";
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

  function buildParentMap() {
    const map = new Map();

    upgradeEdges
      .filter((edge) => edge.is_active !== false)
      .forEach((edge) => {
        const child = String(edge.to_vehicle_id);
        if (!map.has(child)) {
          map.set(child, String(edge.from_vehicle_id));
        }
      });

    return map;
  }

  function getVehicleLevel(vehicleId, parentByChild) {
    let level = 0;
    let current = String(vehicleId);
    const seen = new Set();

    while (parentByChild.has(current)) {
      if (seen.has(current)) break;
      seen.add(current);

      current = parentByChild.get(current);
      level++;
    }

    return level;
  }

  function getPathToVehicle(vehicleId) {
    const byId = new Map(vehicles.map((v) => [String(v.id), v]));
    const parentByChild = buildParentMap();

    const path = [];
    let current = String(vehicleId);
    const seen = new Set();

    while (current && byId.has(current)) {
      if (seen.has(current)) break;
      seen.add(current);

      path.push(byId.get(current));

      if (!parentByChild.has(current)) break;
      current = parentByChild.get(current);
    }

    return path.reverse();
  }

  function buildFamilies() {
    const byId = new Map(vehicles.map((v) => [String(v.id), v]));
    const neighbors = new Map();

    vehicles.forEach((v) => neighbors.set(String(v.id), new Set()));

    upgradeEdges
      .filter((edge) => edge.is_active !== false)
      .forEach((edge) => {
        const from = String(edge.from_vehicle_id);
        const to = String(edge.to_vehicle_id);

        if (!byId.has(from) || !byId.has(to)) return;

        neighbors.get(from).add(to);
        neighbors.get(to).add(from);
      });

    const parentByChild = buildParentMap();
    const visited = new Set();
    const families = [];

    vehicles.forEach((start) => {
      const startId = String(start.id);
      if (visited.has(startId)) return;

      const queue = [startId];
      const component = [];

      visited.add(startId);

      while (queue.length) {
        const id = queue.shift();
        const vehicle = byId.get(id);
        if (vehicle) component.push(vehicle);

        for (const next of neighbors.get(id) || []) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }

      const roots = component.filter((v) => !parentByChild.has(String(v.id)));
      const base = roots[0] || component[0];

      const variants = component.slice().sort((a, b) => {
        const la = getVehicleLevel(a.id, parentByChild);
        const lb = getVehicleLevel(b.id, parentByChild);

        return (
          la - lb ||
          Number(a.sort_order || 1000) - Number(b.sort_order || 1000) ||
          String(a.display_name || "").localeCompare(String(b.display_name || ""), "de")
        );
      });

      families.push({
        base,
        variants
      });
    });

    families.sort((a, b) => {
      return (
        Number(a.base?.group_sort_order || 1000) - Number(b.base?.group_sort_order || 1000) ||
        Number(a.base?.sort_order || 1000) - Number(b.base?.sort_order || 1000) ||
        String(a.base?.display_name || "").localeCompare(String(b.base?.display_name || ""), "de")
      );
    });

    return families;
  }

  function getUpgradeNames(family) {
    return family.variants
      .filter((v) => String(v.id) !== String(family.base.id))
      .map((v) => v.display_name)
      .filter(Boolean);
  }

  async function loadVehicles() {
    try {
      setStatus("Lade Fahrzeugkatalog …");

      const [vehiclesRes, edgesRes] = await Promise.all([
        window.lfcSupabase
          .from("public_vehicle_catalog")
          .select("*"),
        window.lfcSupabase
          .from("vehicle_upgrade_edges")
          .select("id,from_vehicle_id,to_vehicle_id,sort_order,is_active")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
      ]);

      if (vehiclesRes.error) throw vehiclesRes.error;
      if (edgesRes.error) throw edgesRes.error;

      vehicles = (vehiclesRes.data || [])
        .filter((v) => v.group_name)
        .sort((a, b) => {
          return (
            Number(a.group_sort_order || 1000) - Number(b.group_sort_order || 1000) ||
            Number(a.sort_order || 1000) - Number(b.sort_order || 1000) ||
            String(a.display_name || "").localeCompare(String(b.display_name || ""), "de")
          );
        });

      upgradeEdges = edgesRes.data || [];

      renderCatalog();

      setStatus(`✅ ${vehicles.length} Fahrzeuge geladen – Upgrades manuell aus Supabase gruppiert.`);
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

    const families = buildFamilies();
    const byGroup = new Map();

    families.forEach((family) => {
      const name = groupName(family.base);
      if (!byGroup.has(name)) {
        byGroup.set(name, {
          name,
          sortOrder: family.base.group_sort_order || 1000,
          families: []
        });
      }

      byGroup.get(name).families.push(family);
    });

    const groupObjects = Array.from(byGroup.values()).sort((a, b) => {
      return (
        Number(a.sortOrder || 1000) - Number(b.sortOrder || 1000) ||
        String(a.name || "").localeCompare(String(b.name || ""), "de")
      );
    });

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
    setSearchInfo(`${families.length} Einträge`);
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
    const path = getPathToVehicle(selected.id);
    const pathText = path.map((v) => v.display_name).join(" → ");

    modalContent.innerHTML = `
      ${
        variants.length > 1
          ? `
            <div class="shop-tabs">
              <div class="shop-tab-buttons">
                ${variants.map((v) => `
                  <button
                    class="shop-tab-button ${String(v.id) === String(selected.id) ? "active" : ""}"
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
      const path = getPathToVehicle(selected.id);

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
        <option value="${escHtml(v.id)}" ${String(v.id) === String(selected.id) ? "selected" : ""}>
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
      const path = getPathToVehicle(activeSelection.id);

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
