// Minimal header controller: mobile menu toggle + active link highlight
(function(){
  const header = document.querySelector('.site-header');
  function setActiveLink(){
    const links = document.querySelectorAll('.site-nav a, .links a');
    const path  = location.pathname.replace(/\/index\.html?$/, '/');
    links.forEach(a => {
      const href = a.getAttribute('href') || '';
      const norm = href.replace(/\/index\.html?$/, '/');
      a.classList.toggle('active', norm === path || (norm === 'index.html' && path === '/'));
    });
  }
  function setupToggle(){
    const btn = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.site-nav');
    if(!btn || !nav || !header) return;
    btn.addEventListener('click', ()=>{
      const open = !header.classList.contains('open');
      header.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', e => {
      if(e.target.closest('a')){
        header.classList.remove('open');
        document.querySelector('.nav-toggle')?.setAttribute('aria-expanded','false');
      }
    });
  }
  document.addEventListener('DOMContentLoaded', ()=>{
    setActiveLink();
    setupToggle();
  });
})();
