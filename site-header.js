 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/site-header.js b/site-header.js
index ce66e0565b219b25ec625248903fd74c40838891..745a08578cf895089ac3c2085a0908cdada4ae04 100644
--- a/site-header.js
+++ b/site-header.js
@@ -1,41 +1,41 @@
 /* Inject a consistent, mobile-optimised header on every page */
 (function () {
   const header = document.createElement('header');
   header.className = 'site-header';
   header.innerHTML = `
     <div class="header-inner">
       <a class="site-brand" href="index.html" aria-label="PSC Guru Home">
         <span class="site-logo">PSC</span>
         <span>
           <h1>PSC Guru</h1>
           <small>Kerala PSC Exam Prep</small>
         </span>
       </a>
 
       <button id="navToggle" class="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
-        <svg viewBox="0 0 24 24" fill="none" stroke="#0f2d1f" stroke-width="2" stroke-linecap="round">
+        <svg viewBox="0 0 24 24" fill="none" stroke="#1d1556" stroke-width="2" stroke-linecap="round">
           <path d="M3 6h18M3 12h18M3 18h18"/>
         </svg>
       </button>
 
       <nav class="site-nav" id="siteNav">
         <a href="index.html">Home</a>
         <a href="quiz.html">Quiz</a>
         <a href="resources.html">Study</a>
         <a href="notices.html">Notices</a>
       </nav>
     </div>
   `;
 
   // Prepend header to the body
   document.body.prepend(header);
 
   // Mobile toggle
   const toggle = header.querySelector('#navToggle');
   toggle.addEventListener('click', () => {
     const isOpen = header.classList.toggle('open');
     toggle.setAttribute('aria-expanded', String(isOpen));
   });
 
   // Close menu if clicked outside
   document.addEventListener('click', (e) => { 
EOF
)
