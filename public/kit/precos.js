(function () {
  const { cfg, api, el, money, PERIOD, topbar, footer } = window.Kit;
  topbar('/precos'); footer();
  document.title = `Planos — ${cfg.name}`;
  document.getElementById('title').textContent = `Planos do ${cfg.name}`;
  document.getElementById('tagline').textContent = cfg.tagline;

  const box = document.getElementById('plans');
  api('/api/plans').then(({ plans }) => {
    if (!plans.length) {
      box.replaceChildren(el('div', { class: 'card muted' }, 'Os planos ainda não foram cadastrados. Volte em breve.'));
      return;
    }
    box.style.gridTemplateColumns = plans.length < 3 ? `repeat(auto-fit, minmax(260px, 340px))` : '';
    box.style.justifyContent = 'center';
    box.replaceChildren(...plans.map((p, i) => {
      const buttons = [];
      if (p.kiwifyUrl) buttons.push(el('a', { class: `btn btn-block ${p.highlight || !p.hotmartUrl ? 'btn-primary' : ''}`, href: p.kiwifyUrl, rel: 'noopener', text: p.hotmartUrl ? 'Assinar pela Kiwify' : 'Assinar agora' }));
      if (p.hotmartUrl) buttons.push(el('a', { class: `btn btn-block ${!p.kiwifyUrl ? 'btn-primary' : ''}`, href: p.hotmartUrl, rel: 'noopener', text: p.kiwifyUrl ? 'Assinar pela Hotmart' : 'Assinar agora' }));
      if (!buttons.length) buttons.push(el('button', { class: 'btn btn-block', disabled: true, text: 'Em breve' }));
      return el('article', { class: `card plan card-hover anim-up d${Math.min(i + 1, 3)} ${p.highlight ? 'featured' : ''}` },
        p.highlight ? el('span', { class: 'badge badge-grad tag', text: 'Mais escolhido' }) : null,
        el('h3', { text: p.name }),
        p.description ? el('p', { class: 'muted small', style: 'margin:0 0 .75rem', text: p.description }) : null,
        el('div', { class: 'price' }, money(p.price), el('small', { text: PERIOD[p.period] || '' })),
        el('ul', {}, p.features.map(f => el('li', { text: f }))),
        el('div', { class: 'stack', style: 'display:grid;gap:.5rem' }, buttons));
    }));
  }).catch(e => box.replaceChildren(el('div', { class: 'alert alert-bad' }, e.message)));
})();
