(function () {
  "use strict";

  let prices = [];

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

  function norm(str) {
    return String(str ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
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

  function renderPrices() {
    const body = $("priceBody");
    const status = $("priceStatus");
    const search = norm($("priceSearch")?.value || "");

    if (!body) return;

    const filtered = prices.filter((row) => {
      if (!search) return true;
      return norm([row.item_name, row.unit, row.price].join(" ")).includes(search);
    });

    if (!filtered.length) {
      body.innerHTML = `
        <tr>
          <td colspan="3">Keine Rohstoffpreise gefunden.</td>
        </tr>
      `;
      if (status) status.textContent = "Keine Einträge gefunden.";
      return;
    }

    body.innerHTML = filtered.map((row) => `
      <tr>
        <td>${escHtml(row.item_name)}</td>
        <td>${escHtml(row.unit || "Stk.")}</td>
        <td>${escHtml(euro(row.price))}</td>
      </tr>
    `).join("");

    if (status) {
      status.textContent = `${filtered.length} Rohstoffpreis${filtered.length === 1 ? "" : "e"} angezeigt.`;
    }
  }

  async function loadPrices() {
    const body = $("priceBody");
    const status = $("priceStatus");

    if (status) status.textContent = "Lade Rohstoffpreise…";

    try {
      const { data, error } = await window.lfcSupabase
        .from("public_item_prices")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("item_name", { ascending: true });

      if (error) throw error;

      prices = data || [];
      renderPrices();
    } catch (error) {
      console.error(error);

      if (body) {
        body.innerHTML = `
          <tr>
            <td colspan="3">Fehler beim Laden der Rohstoffpreise.</td>
          </tr>
        `;
      }

      if (status) {
        status.textContent = "Fehler: " + (error.message || String(error));
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const search = $("priceSearch");
    if (search) search.addEventListener("input", renderPrices);

    loadPrices();
  });
})();
