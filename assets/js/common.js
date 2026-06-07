function escHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function euro(value){
  const n = Number(value || 0);
  return new Intl.NumberFormat("de-DE", { style:"currency", currency:"EUR", maximumFractionDigits:0 }).format(n);
}
async function loadInclude(selector, url){
  const el = document.querySelector(selector);
  if(!el) return;
  try{
    const res = await fetch(url, { cache:"no-store" });
    el.innerHTML = res.ok ? await res.text() : "";
  }catch{ el.innerHTML = ""; }
}
function setupPage(){
  loadInclude("#bt-navbar", "navbar.html");
  loadInclude("#bt-footer", "footer.html");
}
document.addEventListener("DOMContentLoaded", setupPage);
