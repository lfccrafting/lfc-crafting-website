(function () {
  "use strict";

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

  function formatDate(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString("de-DE");
    } catch {
      return String(value);
    }
  }

  async function loadOrders() {
    const tbody = document.getElementById("ordersBody");
    const status = document.getElementById("ordersStatus");

    if (!tbody) return;

    tbody.innerHTML = "";
    if (status) status.textContent = "Lade Bestellübersicht …";

    try {
      const { data, error } = await window.lfcSupabase
        .from("public_order_overview")
        .select("*")
        .limit(10);

      if (error) throw error;

      if (!data || !data.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4">Keine öffentlichen Aufträge vorhanden.</td>
          </tr>
        `;
        if (status) status.textContent = "Keine Aufträge vorhanden.";
        return;
      }

      tbody.innerHTML = data.map((row) => `
        <tr>
          <td>${escHtml(formatDate(row["Eingang der Bestellung"]))}</td>
          <td>${escHtml(row["Auftragsnummer"] || "")}</td>
          <td>${escHtml(row["Zusätzliche Infos"] || "")}</td>
          <td>${escHtml(row["Status"] || "")}</td>
        </tr>
      `).join("");

      if (status) status.textContent = "Es werden die letzten 10 öffentlichen Aufträge angezeigt.";
    } catch (error) {
      console.error(error);
      tbody.innerHTML = `
        <tr>
          <td colspan="4">Fehler beim Laden der Bestellübersicht.</td>
        </tr>
      `;
      if (status) status.textContent = "Fehler: " + (error.message || String(error));
    }
  }

  document.addEventListener("DOMContentLoaded", loadOrders);
})();
