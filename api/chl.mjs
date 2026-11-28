// CyberHuntLab kit v2 — login com Google e painel admin (função serverless da Vercel).
// Rotas: /api/chl?action=config|google|me|logout|users|status
//
// Variáveis de ambiente (painel da Vercel → Settings → Environment Variables):
//   GOOGLE_CLIENT_ID     ID do cliente OAuth "Aplicativo da Web" (Google Cloud Console)
//   CHL_SESSION_SECRET   texto aleatório com 32+ caracteres (assina o cookie de sessão)
//   ADMIN_EMAILS         e-mails com acesso ao /admin, separados por vírgula
//   KV_REST_API_URL / KV_REST_API_TOKEN  (opcional) Upstash/Vercel KV para listar usuários no admin
import crypto from 'node:crypto';

const COOKIE = 'chl_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

const env = (k) => (process.env[k] || '').trim();
const admins = () => env('ADMIN_EMAILS').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const secret = () => {
  const s = env('CHL_SESSION_SECRET');
  if (s.length < 32) throw httpErr(503, 'Login ainda não configurado: defina CHL_SESSION_SECRET (32+ caracteres) na Vercel.');
  return s;
};
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  return body + '.' + mac;
}
function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const good = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  const a = Buffer.from(mac || ''), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}
function setCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
function currentUser(req) {
  if (env('CHL_SESSION_SECRET').length < 32) return null;
  const p = verify(readCookie(req, COOKIE));
  if (!p) return null;
  return { email: p.email, name: p.name, picture: p.picture, role: admins().includes(p.email) ? 'admin' : 'user' };
}
function requireAdmin(req) {
  const u = currentUser(req);
  if (!u) throw httpErr(401, 'Entre com sua conta Google.');
  if (u.role !== 'admin') throw httpErr(403, 'Acesso restrito ao administrador.');
  return u;
}
function assertSafePost(req) {
  if (req.method !== 'POST') throw httpErr(405, 'Use POST.');
  if (req.headers['x-chl'] !== '1') throw httpErr(403, 'Requisição recusada.');
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw httpErr(403, 'Origem não permitida.');
}
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
}

// ---- KV opcional (Upstash REST) ----
const KV_URL = (env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL')).replace(/\/$/, '');
const KV_TOKEN = env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
async function kv(...cmd) {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd.map(String)) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? j.result : null;
}

async function verifyGoogle(credential) {
  const cid = env('GOOGLE_CLIENT_ID');
  if (!cid) throw httpErr(503, 'Login ainda não configurado: defina GOOGLE_CLIENT_ID na Vercel.');
  if (typeof credential !== 'string' || credential.length > 4096) throw httpErr(400, 'Credencial inválida.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw httpErr(401, 'Não foi possível validar o login do Google.');
  const t = await r.json();
  const issOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  if (t.aud !== cid || !issOk || String(t.email_verified) !== 'true' || Number(t.exp) < Date.now() / 1000)
    throw httpErr(401, 'Login do Google recusado.');
  return { email: String(t.email).toLowerCase(), name: t.name || '', picture: t.picture || '' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const action = String((req.query && req.query.action) || new URL(req.url, 'http://x').searchParams.get('action') || '');

    if (action === 'config') {
      return res.status(200).json({ googleClientId: env('GOOGLE_CLIENT_ID') || null, ready: !!env('GOOGLE_CLIENT_ID') && env('CHL_SESSION_SECRET').length >= 32 });
    }
    if (action === 'me') return res.status(200).json({ user: currentUser(req) });

    if (action === 'google') {
      assertSafePost(req);
      const { credential } = await readJson(req);
      const g = await verifyGoogle(credential);
      setCookie(res, sign({ ...g, exp: Math.floor(Date.now() / 1000) + MAX_AGE }), MAX_AGE);
      const prev = JSON.parse((await kv('HGET', 'chl:users', g.email)) || '{}');
      await kv('HSET', 'chl:users', g.email, JSON.stringify({ name: g.name, picture: g.picture, first: prev.first || Date.now(), last: Date.now(), logins: (prev.logins || 0) + 1 }));
      return res.status(200).json({ user: { ...g, role: admins().includes(g.email) ? 'admin' : 'user' } });
    }
    if (action === 'logout') {
      assertSafePost(req);
      setCookie(res, '', 0);
      return res.status(200).json({ ok: true });
    }
    if (action === 'users') {
      requireAdmin(req);
      const flat = await kv('HGETALL', 'chl:users');
      if (!flat) return res.status(200).json({ storage: false, users: [] });
      const users = [];
      for (let i = 0; i < flat.length; i += 2) { try { users.push({ email: flat[i], ...JSON.parse(flat[i + 1]) }); } catch {} }
      users.sort((a, b) => (b.last || 0) - (a.last || 0));
      return res.status(200).json({ storage: true, users });
    }
    if (action === 'status') {
      requireAdmin(req);
      return res.status(200).json({
        env: {
          GOOGLE_CLIENT_ID: !!env('GOOGLE_CLIENT_ID'),
          CHL_SESSION_SECRET: env('CHL_SESSION_SECRET').length >= 32,
          ADMIN_EMAILS: admins().length,
          KV: !!(KV_URL && KV_TOKEN),
        },
        deployment: { env: process.env.VERCEL_ENV || 'local', commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7), url: process.env.VERCEL_PROJECT_PRODUCTION_URL || '' },
      });
    }
    throw httpErr(404, 'Ação desconhecida.');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && !e.status) console.error('[chl]', e);
    return res.status(status).json({ error: e.status ? e.message : 'Erro interno.' });
  }
}
