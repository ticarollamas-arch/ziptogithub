// Portão do app: sem assinatura ativa, manda para /entrar ou /precos.
// A proteção de verdade está nas rotas /api (requireActive); isto só melhora a experiência.
(function () {
  if (window.__kitGate) return; window.__kitGate = true;
  const here = location.pathname + location.search;
  fetch('/api/auth?action=me', { credentials: 'same-origin' })
    .then(r => r.json())
    .then(({ user }) => {
      if (!user) location.replace(`/entrar?next=${encodeURIComponent(here)}`);
      else if (!user.active) location.replace('/precos?assinatura=inativa');
      else window.KIT_USER = user;
    })
    .catch(() => {});
})();
