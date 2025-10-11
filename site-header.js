// site-header.js – injects a shared header and highlights current page
(function () {
  const LINKS = [
    { href: 'index.html',    text: 'Home'   },
    { href: 'quiz.html',     text: 'Quiz'   },
    { href: 'resources.html',text: 'Study'  },
    { href: 'notices.html',  text: 'Notices'}
  ];
  const headerHTML = `
    <header class="site-header">
      <div class="hdr-wrap">
        <div class="brand">
          <div class="logo">PSC</div>
          <div>
            <h1>PSC Guru</h1>
            <small>Kerala PSC Exam Prep</small>
          </div>
        </div>
        <nav>
          ${LINKS.map(l => `<a href="${l.href}">${l.text}</a>`).join('')}
        </nav>
      </div>
    </header>`;
  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('afterbegin', headerHTML);
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    document.querySelectorAll('.site-header nav a').forEach(a => {
      const target = a.getAttribute('href').toLowerCase();
      if (target === page || (page === '' && target === 'index.html')) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
    });
  });
})();
