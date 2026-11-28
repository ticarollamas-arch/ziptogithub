// /api/auth?action=me|login|register|logout
//  me        GET   -> { user: { email, role, active, plan, expiresAt } | null }
//  login     POST  { email, password }
//  register  POST  { email, order, password }  primeiro acesso ou nova senha:
//                  prova de posse = código do pedido (Kiwify/Hotmart) ligado ao e-mail.
//  logout    POST
import {
  HttpError, sendError, noStore, jsonBody, assertSafeMutation, rateLimit, db,
  normEmail, isEmail, hashPassword, verifyPassword, safeEqual, isAdminEmail,
  setSession, clearSession, currentUser,
} from './_kit/core.js';

const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

function publicUser(u) {
  if (!u) return null;
  return {
    email: u.email,
    role: u.role,
    active: u.active,
    plan: u.access?.planName || null,
    expiresAt: u.access?.expiresAt || null,
  };
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
  if (pw.length > 200) throw new HttpError(400, 'Senha longa demais.');
}

export default async function handler(req, res) {
  noStore(res);
  try {
    const action = String(req.query?.action || '');

    if (action === 'me') {
      if (req.method !== 'GET') throw new HttpError(405, 'Use GET.');
      return res.status(200).json({ user: publicUser(await currentUser(req)) });
    }

    if (action === 'logout') {
      assertSafeMutation(req);
      clearSession(res);
      return res.status(200).json({ ok: true });
    }

    if (action === 'login') {
      assertSafeMutation(req);
      await rateLimit(req, 'login', 10, 15 * 60);
      const { email: e, password } = await jsonBody(req);
      const email = normEmail(e);
      if (!isEmail(email) || typeof password !== 'string') throw new HttpError(400, 'Informe e-mail e senha.');
      // Limite por conta também (barra tentativa distribuída em muitos IPs).
      if ((await db.incrWindow(`rl:acct:${email}`, 60 * 60)) > 20) throw new HttpError(429, 'Muitas tentativas nesta conta. Aguarde uma hora.');

      if (isAdminEmail(email)) {
        const adminPw = process.env.ADMIN_PASSWORD || '';
        if (adminPw.length < 12) throw new HttpError(503, 'ADMIN_PASSWORD não configurada (mínimo 12 caracteres).');
        if (!safeEqual(password, adminPw)) throw new HttpError(401, 'E-mail ou senha incorretos.');
        const ver = Number(await db.get('admin:ver')) || 0;
        setSession(res, email, 'admin', ver);
        await db.log({ type: 'admin-login', email });
        return res.status(200).json({ ok: true, role: 'admin', redirect: '/admin' });
      }

      const user = await db.getJson(`user:${email}`);
      const ok = verifyPassword(password, user?.pass || DUMMY_HASH); // tempo constante mesmo sem usuário
      if (!user || !ok) throw new HttpError(401, 'E-mail ou senha incorretos.');
      setSession(res, email, 'customer', user.ver || 0);
      return res.status(200).json({ ok: true, role: 'customer', redirect: '/' });
    }

    if (action === 'register') {
      assertSafeMutation(req);
      await rateLimit(req, 'register', 8, 30 * 60);
      const { email: e, order, password } = await jsonBody(req);
      const email = normEmail(e);
      const code = String(order || '').trim().toUpperCase().slice(0, 80);
      if (!isEmail(email) || !code) throw new HttpError(400, 'Informe o e-mail da compra e o código do pedido.');
      checkPassword(password);
      if (isAdminEmail(email)) throw new HttpError(400, 'Use a senha de administrador configurada na Vercel.');

      const owner = await db.get(`order:${code}`);
      if (!owner || owner !== email) {
        throw new HttpError(404, 'Não encontramos esse pedido para esse e-mail. Confira o e-mail de confirmação da compra (o pagamento pode levar alguns minutos para ser aprovado).');
      }
      const prev = await db.getJson(`user:${email}`);
      const ver = (prev?.ver || 0) + (prev ? 1 : 0); // nova senha derruba sessões antigas
      await db.setJson(`user:${email}`, { email, pass: hashPassword(password), ver, createdAt: prev?.createdAt || new Date().toISOString() });
      await db.log({ type: prev ? 'password-reset' : 'register', email });
      setSession(res, email, 'customer', ver);
      return res.status(200).json({ ok: true, redirect: '/' });
    }

    throw new HttpError(404, 'Ação desconhecida.');
  } catch (err) {
    sendError(res, err);
  }
}
