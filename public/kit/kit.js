// Kit comercial — utilidades do navegador. Sem dependências e sem innerHTML com dados externos.
(function () {
  const cfg = Object.assign({ name: 'Produto', tagline: '', mark: 'P', appPath: '/', support: '' }, window.KIT_CONFIG || {});

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['X-Requested-With'] = 'kit';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    let data = {};
    try { data = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok) { const e = new Error(data.error || `Erro ${r.status}`); e.status = r.status; throw e; }
    return data;
  }

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }

  const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const PERIOD = { mensal: '/mês', trimestral: '/trimestre', semestral: '/semestre', anual: '/ano', vitalicio: ' pagamento único' };
  const date = s => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');

  function topbar(current) {
    const links = [['Planos', '/precos'], ['Entrar', '/entrar']];
    const nav = el('nav', { class: 'nav', 'aria-label': 'Principal' },
      links.map(([t, h]) => el('a', { href: h, 'aria-current': current === h ? 'page' : false, text: t })));
    const bar = el('header', { class: 'topbar' },
      el('div', { class: 'wrap' },
        el('a', { class: 'brand', href: cfg.appPath }, el('span', { class: 'brand-mark', text: cfg.mark }), cfg.name),
        nav));
    document.body.prepend(bar);
    api('/api/auth?action=me').then(({ user }) => {
      if (!user) return;
      nav.replaceChildren(
        user.role === 'admin' ? el('a', { href: '/admin', 'aria-current': current === '/admin' ? 'page' : false, text: 'Admin' }) : null,
        el('a', { href: cfg.appPath, text: 'Abrir app' }),
        el('a', { href: '#', text: 'Sair', onclick: async e => { e.preventDefault(); await api('/api/auth?action=logout', { method: 'POST', body: {} }).catch(() => {}); location.href = '/entrar'; } }));
    }).catch(() => {});
  }

  function footer() {
    document.body.append(el('footer', { class: 'footer' }, el('div', { class: 'wrap row' },
      el('span', { text: `© ${new Date().getFullYear()} ${cfg.name}` }), el('span', { class: 'spacer' }),
      cfg.support ? el('a', { href: `mailto:${cfg.support}`, text: cfg.support }) : null)));
  }

  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.replaceChildren(el('span', { class: 'spinner' }), label || 'Aguarde…'); }
    else { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
  }

  function showAlert(box, msg, kind = 'bad') {
    box.className = `alert alert-${kind}`; box.textContent = msg; box.classList.remove('hidden');
  }

  window.Kit = { cfg, api, el, money, PERIOD, date, topbar, footer, busy, showAlert };
})();
