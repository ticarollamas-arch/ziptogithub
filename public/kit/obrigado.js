(function () {
  const { cfg, topbar, footer } = window.Kit;
  topbar(''); footer();
  document.title = `Obrigado! — ${cfg.name}`;
  document.getElementById('title').textContent = `Bem-vindo(a) ao ${cfg.name}!`;
  // Kiwify e Hotmart podem repassar e-mail/pedido na URL de obrigado; levamos adiante para preencher o formulário.
  const q = new URLSearchParams(location.search);
  const email = q.get('email') || q.get('buyer_email') || '';
  const pedido = q.get('order_id') || q.get('transaction') || q.get('pedido') || '';
  const out = new URLSearchParams();
  if (/^[^\s@]+@[^\s@]+$/.test(email)) out.set('email', email);
  if (/^[\w-]{3,80}$/.test(pedido)) out.set('pedido', pedido);
  if ([...out].length) document.getElementById('go').href = `/entrar?${out}#primeiro-acesso`;
  if (cfg.support) document.getElementById('support').textContent = `Precisa de ajuda? Escreva para ${cfg.support}`;
})();
