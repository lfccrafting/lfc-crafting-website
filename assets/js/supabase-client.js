(function(){
  function ready(){
    const cfg = window.LFC_SUPABASE_CONFIG || {};
    if(!window.supabase){ throw new Error("Supabase CDN wurde nicht geladen."); }
    if(!cfg.url || !cfg.anonKey || cfg.anonKey.includes("HIER_")){
      console.warn("Supabase anon key fehlt. Bitte assets/js/config.js bearbeiten.");
    }
    window.lfcSupabase = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
