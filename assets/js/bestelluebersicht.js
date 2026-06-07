document.addEventListener("DOMContentLoaded", async()=>{
  const body=document.getElementById("ordersBody"), status=document.getElementById("status");
  try{
    const {data,error}=await window.lfcSupabase.from("public_order_overview").select("*").limit(100);
    if(error) throw error;
    body.innerHTML="";
    if(!data || !data.length){ body.innerHTML='<tr><td colspan="4" class="price-muted">Keine Aufträge vorhanden.</td></tr>'; status.textContent="Keine öffentlichen Aufträge gefunden."; return; }
    for(const r of data){
      const d=r["Eingang der Bestellung"] ? new Date(r["Eingang der Bestellung"]).toLocaleString("de-DE") : "";
      body.insertAdjacentHTML("beforeend",`<tr><td>${escHtml(d)}</td><td>${escHtml(r["Auftragsnummer"])}</td><td>${escHtml(r["Zusätzliche Infos"])}</td><td>${escHtml(r["Status"])}</td></tr>`);
    }
    status.textContent=`✅ ${data.length} Einträge geladen.`;
  }catch(e){ console.error(e); status.classList.add("bt-error"); status.textContent="❌ Bestellübersicht konnte nicht geladen werden."; }
});
