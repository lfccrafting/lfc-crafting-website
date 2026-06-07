document.addEventListener("DOMContentLoaded",()=>{
  const status=document.getElementById("status");
  document.getElementById("loginForm").addEventListener("submit",async e=>{e.preventDefault();status.textContent="Melde an…";const {error}=await window.lfcSupabase.auth.signInWithPassword({email:document.getElementById("email").value.trim(),password:document.getElementById("password").value});if(error){status.style.color="#ffb3b3";status.textContent="❌ "+error.message;return;}status.style.color="var(--accent-2)";status.textContent="✅ Eingeloggt.";setTimeout(()=>location.href="admin.html",600);});
  document.getElementById("logoutBtn").onclick=async()=>{await window.lfcSupabase.auth.signOut();status.textContent="Ausgeloggt.";};
});
