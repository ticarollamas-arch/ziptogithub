(function () {
  const { cfg, api, el, money, PERIOD, date, topbar, footer, busy, showAlert } = window.Kit;
  topbar('/admin'); footer();
  document.title = `Admin — ${cfg.name}`;
  const $ = id => document.getElementById(id);
  const msg = $('msg');
  let state = null;
  let plans = [];

  // abas
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', String(x === t)));
    document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== t.dataset.tab));
  }));
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    const i = $(b.dataset.copy); navigator.clipboard.writeText(i.value).then(() => { b.textContent = 'Copiado'; setTimeout(() => (b.textContent = 'Copiar'), 1500); });
  }));

  async function load() {
    try {
      state = await api('/api/admin?action=overview');
    } catch (e) {
      if (e.status === 401 || e.status === 403) { location.href = '/entrar?next=/admin'; return; }
      showAlert(msg, e.message); return;
    }
    $('who').textContent = `Conectado como ${state.admin}`;
    const s = state.stats;
    $('stats').replaceChildren(
      ...[['Clientes', s.total], ['Assinaturas ativas', s.active], ['Com conta criada', s.withAccount], ['Planos', state.plans.length]]
        .map(([l, n], i) => el('div', { class: `card stat anim-up d${Math.min(i, 3)}` }, el('div', { class: 'n', text: String(n) }), el('div', { class: 'l', text: l }))));
    plans = state.plans.map(p => ({ ...p }));
    renderCustomers(); renderPlans(); renderEvents(); renderIntegrations();
  }

  function renderCustomers() {
    const q = $('search').value.trim().toLowerCase();
    const list = state.customers.filter(c => !q || c.email.includes(q));
    $('gPlan').replaceChildren(el('option', { value: '', text: 'Sem validade (vitalício)' }), ...plans.map(p => el('option', { value: p.id, text: `${p.name} (${p.period})` })));
    $('rows').replaceChildren(...(list.length ? list.map(c => el('tr', {},
      el('td', { class: 'mono', text: c.email }),
      el('td', {}, el('span', { class: `badge ${c.active ? 'badge-ok' : 'badge-bad'}`, text: c.active ? 'Ativo' : 'Inativo' })),
      el('td', { text: c.plan }), el('td', { text: c.provider }), el('td', { text: c.expiresAt ? date(c.expiresAt) : 'Sem validade' }),
      el('td', { text: c.hasAccount ? 'Sim' : 'Aguardando' }),
      el('td', {}, c.active
        ? el('button', { class: 'btn btn-sm btn-danger', text: 'Revogar', onclick: () => revoke(c.email) })
        : el('button', { class: 'btn btn-sm', text: 'Reativar', onclick: () => grant(c.email, '') })),
    )) : [el('tr', {}, el('td', { colspan: '7', class: 'muted', text: 'Nenhum cliente ainda. As vendas aparecem aqui automaticamente.' }))]));
  }
  $('search').addEventListener('input', renderCustomers);

  async function grant(email, planId) {
    try {
      const r = await api('/api/admin?action=grant', { method: 'POST', body: { email, planId } });
      showAlert(msg, r.message, 'ok'); await load();
    } catch (e) { showAlert(msg, e.message); }
  }
  async function revoke(email) {
    if (!confirm(`Revogar o acesso de ${email}?`)) return;
    try { await api('/api/admin?action=revoke', { method: 'POST', body: { email } }); showAlert(msg, 'Acesso revogado.', 'ok'); await load(); }
    catch (e) { showAlert(msg, e.message); }
  }
  $('grantForm').addEventListener('submit', e => { e.preventDefault(); grant($('gEmail').value, $('gPlan').value); });

  function field(label, input) { return el('div', { class: 'field' }, el('label', { text: label }), input); }
  function renderPlans() {
    $('planList').replaceChildren(...plans.map((p, i) => {
      const bind = (key, input, parse = v => v) => { input.addEventListener('input', () => { plans[i][key] = parse(input.type === 'checkbox' ? input.checked : input.value); }); return input; };
      const periodSel = el('select', {}, state.periods.map(v => el('option', { value: v, selected: p.period === v, text: v })));
      return el('div', { class: 'card' },
        el('div', { class: 'row', style: 'margin-bottom:.5rem' }, el('h3', { style: 'margin:0', text: p.name || `Plano ${i + 1}` }), el('span', { class: 'spacer' }),
          el('button', { class: 'btn btn-sm btn-danger', text: 'Remover', onclick: () => { plans.splice(i, 1); renderPlans(); } })),
        el('div', { class: 'grid grid-2' },
          field('Nome', bind('name', el('input', { type: 'text', value: p.name || '' }))),
          field('ID (sem espaços)', bind('id', el('input', { type: 'text', value: p.id || '' })))),
        el('div', { class: 'grid grid-2', style: 'margin-top:.9rem' },
          field('Preço (R$)', bind('price', el('input', { type: 'number', min: '0', step: '0.01', value: String(p.price ?? '') }))),
          field('Período', bind('period', periodSel))),
        field('Descrição curta', bind('description', el('input', { type: 'text', value: p.description || '' }))),
        field('Recursos (um por linha)', bind('features', el('textarea', {}, (p.features || []).join('\n')), v => v.split('\n'))),
        el('div', { class: 'grid grid-2', style: 'margin-top:.9rem' },
          field('Link checkout Kiwify', bind('kiwifyUrl', el('input', { type: 'url', placeholder: 'https://pay.kiwify.com.br/…', value: p.kiwifyUrl || '' }))),
          field('ID produto Kiwify', bind('kiwifyProductId', el('input', { type: 'text', value: p.kiwifyProductId || '' })))),
        el('div', { class: 'grid grid-2', style: 'margin-top:.9rem' },
          field('Link checkout Hotmart', bind('hotmartUrl', el('input', { type: 'url', placeholder: 'https://pay.hotmart.com/…', value: p.hotmartUrl || '' }))),
          field('ID produto Hotmart', bind('hotmartProductId', el('input', { type: 'text', value: p.hotmartProductId || '' })))),
        el('label', { class: 'check', style: 'margin-top:.9rem' }, bind('highlight', el('input', { type: 'checkbox', checked: !!p.highlight })), 'Destacar como "Mais escolhido"'),
        el('p', { class: 'small dim', style: 'margin:.6rem 0 0', text: `Prévia: ${money(p.price)}${PERIOD[p.period] || ''}` }));
    }));
    if (!plans.length) $('planList').append(el('div', { class: 'card muted' }, 'Nenhum plano. Clique em "Adicionar plano".'));
  }
  $('addPlan').addEventListener('click', () => {
    plans.push({ id: `plano-${plans.length + 1}`, name: 'Novo plano', price: 0, period: 'mensal', description: '', features: [], highlight: false });
    renderPlans();
  });
  $('savePlans').addEventListener('click', async e => {
    const b = e.currentTarget; busy(b, true, 'Salvando…');
    try { const r = await api('/api/admin?action=save-plans', { method: 'POST', body: { plans } }); state.plans = r.plans; plans = r.plans.map(p => ({ ...p })); renderPlans(); renderCustomers(); showAlert(msg, 'Planos salvos e publicados em /precos.', 'ok'); }
    catch (err) { showAlert(msg, err.message); }
    busy(b, false);
  });

  function renderIntegrations() {
    const w = state.webhooks;
    $('kUrl').value = w.kiwify; $('hUrl').value = w.hotmart; $('tyUrl').value = w.thankYou;
    const st = ok => el('span', { class: `badge ${ok ? 'badge-ok' : 'badge-bad'}`, text: ok ? 'token configurado' : 'falta o token' });
    $('kStatus').replaceChildren(st(w.kiwifyConfigured)); $('hStatus').replaceChildren(st(w.hotmartConfigured));
  }

  function renderEvents() {
    $('evRows').replaceChildren(...(state.events.length ? state.events.map(ev => el('tr', {},
      el('td', { text: new Date(ev.at).toLocaleString('pt-BR') }), el('td', { text: ev.type }), el('td', { class: 'mono', text: ev.email || '—' }),
      el('td', { text: ev.provider || '—' }), el('td', { class: 'mono', text: ev.orderId || ev.event || '' }))) : [el('tr', {}, el('td', { colspan: '5', class: 'muted', text: 'Sem eventos ainda.' }))]));
  }

  $('logoutAll').addEventListener('click', async () => {
    if (!confirm('Encerrar a sessão de admin em todos os aparelhos (inclusive este)?')) return;
    await api('/api/admin?action=logout-all', { method: 'POST', body: {} }).catch(() => {});
    location.href = '/entrar';
  });

  load();
})();
