/* CyberHuntLab UI kit v2 — cabeçalho compacto com hambúrguer, banner do projeto e estado de login.
   Configure antes de carregar:  window.CHL = { name, home, app, github, links:[{href,label}] }  */
(function () {
  var C = window.CHL || {};
  var name = C.name || document.title || 'CyberHuntLab';
  var home = C.home || '/sobre';
  var app = C.app || '/';
  var banner = C.banner === false ? null : (C.banner || '/chl/banner.svg');
  var here = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';

  var mark = '<svg class="chl-mark" viewBox="0 0 136 136" aria-hidden="true"><defs><linearGradient id="chlg" x1="0" x2="1">' +
    '<stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs>' +
    '<path d="M68 4 127 38v60L68 132 9 98V38Z" fill="#0B1220" stroke="url(#chlg)" stroke-width="8"/>' +
    '<path d="M44 52l22 16-22 16" fill="none" stroke="#22D3EE" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M72 88h22" stroke="#8B5CF6" stroke-width="9" stroke-linecap="round"/></svg>';

  var links = (C.links || [
    { href: home, label: 'Sobre' },
    { href: app, label: 'Ferramenta' }
  ]).slice();
  if (C.github) links.push({ href: C.github, label: 'GitHub' });
  links.push({ href: '/entrar', label: 'Entrar', id: 'chl-auth-link' });

  function norm(h) { return (h || '').replace(/\.html$/, '').replace(/\/$/, '') || '/'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function build() {
    document.body.classList.add('chl');
    var b = document.body;
    if (b.getAttribute('data-chl-header') !== 'off' && !document.querySelector('.chl-top')) {
      var nav = links.map(function (l) {
        var ext = /^https?:/.test(l.href);
        return '<a href="' + esc(l.href) + '"' + (l.id ? ' id="' + l.id + '"' : '') +
          (!ext && norm(l.href) === here ? ' aria-current="page"' : '') +
          (ext ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.label) + '</a>';
      }).join('');
      var h = document.createElement('header');
      h.className = 'chl-top';
      h.innerHTML = '<div class="chl-wrap"><a class="chl-brand" href="' + esc(home) + '">' + mark + '<span>' + esc(name) + '</span></a>' +
        '<button class="chl-burger" type="button" aria-label="Abrir menu" aria-expanded="false" aria-controls="chl-nav">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
        '<nav class="chl-nav" id="chl-nav" aria-label="Principal">' + nav + '</nav></div>';
      b.insertBefore(h, b.firstChild);
      var btn = h.querySelector('.chl-burger'), menu = h.querySelector('.chl-nav');
      btn.addEventListener('click', function () {
        var open = menu.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      menu.addEventListener('click', function (e) { if (e.target.tagName === 'A') { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
      if (banner && b.getAttribute('data-chl-banner') !== 'off') {
        var bn = document.createElement('div');
        bn.className = 'chl-banner';
        bn.innerHTML = '<div class="chl-wrap"><img src="' + esc(banner) + '" alt="' + esc(name) + '" width="1200" height="300"></div>';
        h.insertAdjacentElement('afterend', bn);
      }
    }
    if (b.getAttribute('data-chl-footer') !== 'off' && !document.querySelector('.chl-foot')) {
      var f = document.createElement('footer');
      f.className = 'chl-foot';
      f.innerHTML = '<div class="chl-wrap"><span>' + esc(name) + ' · Ana Caroline Lamas</span><a href="https://cyberhuntlab.com.br" target="_blank" rel="noopener">cyberhuntlab.com.br</a></div>';
      b.appendChild(f);
    }
    refreshAuth();
  }

  function refreshAuth() {
    fetch('/api/chl?action=me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var a = document.getElementById('chl-auth-link');
        window.CHL_USER = j && j.user || null;
        if (!a || !window.CHL_USER) return;
        if (window.CHL_USER.role === 'admin') { a.href = '/admin'; a.textContent = 'Admin'; }
        else { a.href = '/entrar'; a.textContent = 'Minha conta'; }
        document.dispatchEvent(new CustomEvent('chl:user', { detail: window.CHL_USER }));
      }).catch(function () {});
  }

  window.CHL_API = function (action, body) {
    return fetch('/api/chl?action=' + encodeURIComponent(action), {
      method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-CHL': '1' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('Erro ' + r.status)); return j; }); });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
