(function(){
  let vehicles=[]; let cards=[]; let groups=[]; let activeVehicle=null;
  const $ = (id)=>document.getElementById(id);
  function firstImg(v){ return Array.isArray(v.images) && v.images[0] ? v.images[0].url : ""; }
  function imgs(v){ return Array.isArray(v.images) ? v.images.map(x=>x.url).filter(Boolean) : []; }
  function groupKey(v){ return v.group_name || "Ohne Gruppe"; }
  function norm(s){ return String(s??"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim(); }
  async function loadVehicles(){
    const status=$("shopStatus");
    try{
      const {data,error}=await window.lfcSupabase.from("public_vehicle_catalog").select("*");
      if(error) throw error;
      vehicles=(data||[]).sort((a,b)=>(a.group_sort_order??1000)-(b.group_sort_order??1000)||(a.sort_order??1000)-(b.sort_order??1000)||String(a.display_name).localeCompare(String(b.display_name),"de"));
      render();
      status.textContent=`✅ ${vehicles.length} Fahrzeuge geladen.`;
    }catch(err){
      console.error(err); status.classList.add("bt-error"); status.textContent="❌ Fahrzeugdaten konnten nicht geladen werden. Prüfe assets/js/config.js und die Supabase-View public_vehicle_catalog.";
    }
  }
  function renderGroupNav(names){
    const nav=$("shopGroupNav"); nav.innerHTML="";
    names.forEach(name=>{ const b=document.createElement("button"); b.className="shop-group-nav-item"; b.textContent=name; b.onclick=()=>document.getElementById("group-"+norm(name).replace(/[^a-z0-9]+/g,"-")).scrollIntoView({behavior:"smooth",block:"start"}); nav.appendChild(b); });
  }
  function render(){
    const content=$("shopContent"); content.innerHTML=""; cards=[]; groups=[];
    const byGroup=new Map(); vehicles.forEach(v=>{const g=groupKey(v); if(!byGroup.has(g)) byGroup.set(g,[]); byGroup.get(g).push(v);});
    renderGroupNav([...byGroup.keys()]);
    for(const [name,list] of byGroup){
      const section=document.createElement("section"); section.className="shop-group"; section.id="group-"+norm(name).replace(/[^a-z0-9]+/g,"-");
      section.innerHTML=`<div class="shop-group-title"><h2>${escHtml(name)}</h2><span class="shop-group-count">${list.length} Fahrzeuge</span></div><div class="shop-grid"></div>`;
      const grid=section.querySelector(".shop-grid");
      list.forEach(v=>{ const img=firstImg(v); const card=document.createElement("article"); card.className="shop-card"; card.dataset.search=norm([v.display_name,v.blueprint_name,v.description,v.group_name,v.craft_key].join(" ")); card.innerHTML=`<div class="shop-card-media">${img?`<img src="${escHtml(img)}" alt="${escHtml(v.display_name)}" loading="lazy">`:`<div class="shop-modal-img-placeholder">Kein Bild vorhanden</div>`}</div><div class="shop-card-body"><div><h3 class="shop-card-title">${escHtml(v.display_name)}</h3><div class="shop-card-upgrades"><span>${escHtml(v.description||"").slice(0,120)}${(v.description||"").length>120?"…":""}</span></div></div><p class="shop-card-price-main">${euro(v.price)}</p></div>`; card.onclick=()=>openModal(v); grid.appendChild(card); cards.push(card); });
      content.appendChild(section); groups.push(section);
    }
    $("shopSearchInfo").textContent=`${vehicles.length} Einträge`;
  }
  function filter(){ const q=norm($("shopSearch").value); let shown=0; cards.forEach(c=>{const ok=!q||c.dataset.search.includes(q); c.style.display=ok?"":"none"; if(ok)shown++;}); groups.forEach(g=>{const any=[...g.querySelectorAll(".shop-card")].some(c=>c.style.display!=="none"); g.style.display=any?"":"none";}); $("shopNoResults").style.display=shown?"none":"block"; $("shopSearchInfo").textContent=`${shown} Treffer`; }
  function openModal(v){ activeVehicle=v; const m=$("shopModal"); $("shopModalTitle").textContent=v.display_name; const all=imgs(v); $("shopModalContent").innerHTML=`<h3 class="shop-tab-title">${escHtml(v.display_name)}</h3>${v.blueprint_name?`<div class="shop-path"><strong>Bauplan:</strong> ${escHtml(v.blueprint_name)}</div>`:""}<div class="shop-modal-media"><div class="shop-modal-img-box">${all[0]?`<img id="modalVehicleImg" class="shop-modal-img" src="${escHtml(all[0])}" alt="">`:`<div class="shop-modal-img-placeholder">Kein Bild vorhanden.</div>`}</div>${all.length>1?`<div class="shop-modal-img-switch">${all.map((_,i)=>`<button class="shop-modal-img-btn ${i===0?'active':''}" type="button" data-idx="${i}"></button>`).join("")}</div>`:""}</div>${v.description?`<div class="shop-tab-desc">${escHtml(v.description)}</div>`:""}${v.trunk_size?`<div class="shop-lkw-kofferraum"><strong>Kofferraum:</strong> ${escHtml(v.trunk_size)}</div>`:""}<div class="shop-price-row"><div class="shop-price-box"><div class="shop-price-label">Preis</div><div class="shop-price-main">${euro(v.price)}</div></div><button type="button" class="shop-request-btn" id="openRequestBtn">Anfrage</button></div>`;
    m.classList.add("active"); m.setAttribute("aria-hidden","false");
    const imgEl=$("modalVehicleImg"); if(imgEl){imgEl.onclick=()=>openLightbox(imgEl.src);} [...document.querySelectorAll(".shop-modal-img-btn")].forEach(btn=>btn.onclick=()=>{const i=Number(btn.dataset.idx); imgEl.src=all[i]; document.querySelectorAll(".shop-modal-img-btn").forEach(b=>b.classList.toggle("active",b===btn));});
    $("openRequestBtn").onclick=()=>openRequest(v);
  }
  function closeModal(){ $("shopModal").classList.remove("active"); $("shopModal").setAttribute("aria-hidden","true"); }
  function openLightbox(src){ $("imageLightboxImg").src=src; $("imageLightbox").classList.add("active"); $("imageLightbox").setAttribute("aria-hidden","false"); }
  function closeLightbox(){ $("imageLightbox").classList.remove("active"); $("imageLightbox").setAttribute("aria-hidden","true"); $("imageLightboxImg").src=""; }
  function openRequest(v){ activeVehicle=v; $("requestSummary").innerHTML=`<strong>Fahrzeug:</strong> ${escHtml(v.display_name)}<br><strong>Preis:</strong> ${euro(v.price)}`; $("requestModal").classList.add("active"); $("requestModal").setAttribute("aria-hidden","false"); }
  function closeRequest(){ $("requestModal").classList.remove("active"); $("requestModal").setAttribute("aria-hidden","true"); }
  async function submitRequest(ev){
    ev.preventDefault();
    const name=$("reqName").value.trim();
    const contact=$("reqKontakt").value.trim();
    const note=$("reqNote").value.trim();
    const status=$("requestStatus");
    const send=$("requestSend");
    if(!name||!contact||!activeVehicle){
      status.className="shop-form-status err";
      status.textContent="Bitte Name und Kontakt ausfüllen.";
      return;
    }
    send.disabled=true;
    send.textContent="Sende…";
    status.textContent="";
    try{
      const message = [
        `Fahrzeug: ${activeVehicle.display_name}`,
        `Craft-Key: ${activeVehicle.craft_key || "-"}`,
        `Preis: ${euro(activeVehicle.price)}`,
        `Kontakt: ${contact}`,
        note ? `Notiz: ${note}` : ""
      ].filter(Boolean).join("\n");

      const { error } = await window.lfcSupabase
        .from("contact_requests")
        .insert({
          name,
          subject: "Fahrzeug-Anfrage: " + activeVehicle.display_name,
          message
        });

      if(error) throw error;
      status.className="shop-form-status ok";
      status.textContent="✅ Anfrage gesendet.";
      $("requestForm").reset();
      setTimeout(closeRequest,1300);
    }catch(err){
      console.error(err);
      status.className="shop-form-status err";
      status.textContent="❌ Anfrage konnte nicht gespeichert werden. Prüfe den Supabase anon key und die RLS-Policy für contact_requests.";
    }finally{
      send.disabled=false;
      send.textContent="Anfrage senden";
    }
  }
  document.addEventListener("DOMContentLoaded",()=>{ $("shopSearch").addEventListener("input",filter); $("shopModalClose").onclick=closeModal; document.querySelector("#shopModal .shop-modal-backdrop").onclick=closeModal; $("requestModalClose").onclick=closeRequest; $("requestCancel").onclick=closeRequest; document.querySelector("#requestModal .shop-modal-backdrop").onclick=closeRequest; $("imageLightbox").querySelector(".shop-img-lightbox-backdrop").onclick=closeLightbox; $("requestForm").addEventListener("submit",submitRequest); document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal();closeRequest();closeLightbox();}}); loadVehicles(); });
})();
