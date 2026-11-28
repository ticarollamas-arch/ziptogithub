(function () {
  const { cfg, api, topbar, footer, busy, showAlert } = window.Kit;
  topbar('/entrar'); footer();
  document.title = `Entrar — ${cfg.name}`;
  const msg = document.getElementById('msg');
  const forms = { login: document.getElementById('f-login'), first: document.getElementById('f-first') };
  const tabs = { login: document.getElementById('t-login'), first: document.getElementById('t-first') };

  function show(which) {
    for (const k of Object.keys(forms)) {
      forms[k].classList.toggle('hidden', k !== which);
      tabs[k].setAttribute('aria-selected', String(k === which));
    }
    msg.classList.add('hidden');
  }
  tabs.login.onclick = () => show('login');
  tabs.first.onclick = () => show('first');
  if (location.hash === '#primeiro-acesso') show('first');

  const params = new URLSearchParams(location.search);
  if (params.get('email')) { document.getElementById('fe').value = params.get('email'); document.getElementById('le').value = params.get('email'); }
  if (params.get('pedido')) { document.getElementById('fo').value = params.get('pedido'); show('first'); }

  // Só aceita redirecionar para caminhos do próprio site (evita open redirect).
  const next = (() => { const n = params.get('next') || ''; return /^\/(?!\/)[\w\-./?=&%#]*$/.test(n) ? n : null; })();

  async function submit(form, path, body) {
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true);
    try {
      const r = await api(path, { method: 'POST', body });
      location.href = r.role === 'admin' ? r.redirect : (next || r.redirect || cfg.appPath);
    } catch (e) {
      showAlert(msg, e.message);
      busy(btn, false);
    }
  }

  forms.login.onsubmit = e => {
    e.preventDefault();
    submit(forms.login, '/api/auth?action=login', { email: document.getElementById('le').value, password: document.getElementById('lp').value });
  };
  forms.first.onsubmit = e => {
    e.preventDefault();
    submit(forms.first, '/api/auth?action=register', {
      email: document.getElementById('fe').value, order: document.getElementById('fo').value, password: document.getElementById('fp').value,
    });
  };
})();
