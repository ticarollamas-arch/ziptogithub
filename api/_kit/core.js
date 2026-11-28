// Kit comercial CyberHuntLab — núcleo compartilhado pelas funções /api.
// Arquivos/pastas que começam com "_" não viram rota na Vercel.
//
// Armazenamento: Redis via REST (Upstash / Vercel KV). Variáveis aceitas:
//   KV_REST_API_URL + KV_REST_API_TOKEN   (nome usado pela integração da Vercel)
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// Sem elas, em desenvolvimento local usa memória; em produção recusa (503).
import crypto from 'node:crypto';

/* ------------------------------------------------------------------ erros */
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500 && !(err instanceof HttpError)) console.error('[kit]', err);
  const message = err instanceof HttpError ? err.message : 'Erro interno. Tente novamente.';
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ error: message });
}

/* ----------------------------------------------------------------- storage */
const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const IS_PROD = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
const mem = globalThis.__kitMem || (globalThis.__kitMem = new Map());

async function redis(...cmd) {
  if (!KV_URL || !KV_TOKEN) {
    if (IS_PROD) throw new HttpError(503, 'Banco de dados não configurado (KV_REST_API_URL / KV_REST_API_TOKEN).');
    return memRedis(cmd);
  }
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd.map(String)),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new HttpError(503, 'Falha no banco de dados.');
  return j.result;
}

// Subconjunto mínimo de Redis em memória, só para `vercel dev` / testes.
function memRedis([op, key, ...args]) {
  op = op.toUpperCase();
  const now = Date.now();
  const e = mem.get(key);
  if (e && e.exp && e.exp < now) mem.delete(key);
  const cur = mem.get(key);
  switch (op) {
    case 'GET': return cur ? cur.v : null;
    case 'SET': {
      const opts = args.slice(1).map(String);
      if (opts.includes('NX') && cur) return null;
      const exIdx = opts.indexOf('EX');
      mem.set(key, { v: String(args[0]), exp: exIdx >= 0 ? now + Number(opts[exIdx + 1]) * 1000 : 0 });
      return 'OK';
    }
    case 'DEL': return mem.delete(key) ? 1 : 0;
    case 'INCR': { const v = Number(cur?.v || 0) + 1; mem.set(key, { v: String(v), exp: cur?.exp || 0 }); return v; }
    case 'EXPIRE': if (cur) cur.exp = now + Number(args[0]) * 1000; return cur ? 1 : 0;
    case 'SADD': { const s = new Set(cur ? JSON.parse(cur.v) : []); args.forEach(a => s.add(String(a))); mem.set(key, { v: JSON.stringify([...s]) }); return 1; }
    case 'SMEMBERS': return cur ? JSON.parse(cur.v) : [];
    case 'LPUSH': { const l = cur ? JSON.parse(cur.v) : []; l.unshift(...args.map(String)); mem.set(key, { v: JSON.stringify(l) }); return l.length; }
    case 'LTRIM': { const l = cur ? JSON.parse(cur.v) : []; mem.set(key, { v: JSON.stringify(l.slice(Number(args[0]), Number(args[1]) + 1)) }); return 'OK'; }
    case 'LRANGE': { const l = cur ? JSON.parse(cur.v) : []; return l.slice(Number(args[0]), Number(args[1]) + 1); }
    default: throw new Error(`memRedis: ${op} não suportado`);
  }
}

// Prefixo por produto: vários produtos podem dividir o mesmo banco.
const NS = (process.env.KIT_NAMESPACE || 'app').replace(/[^\w-]/g, '').slice(0, 40) || 'app';
const k = (...parts) => [NS, ...parts].join(':');

export const db = {
  async getJson(key) { const v = await redis('GET', k(key)); try { return v ? JSON.parse(v) : null; } catch { return null; } },
  async setJson(key, val, ttlSec) { return ttlSec ? redis('SET', k(key), JSON.stringify(val), 'EX', ttlSec) : redis('SET', k(key), JSON.stringify(val)); },
  async setNx(key, val, ttlSec) { return (await redis('SET', k(key), String(val), 'NX', 'EX', ttlSec)) === 'OK'; },
  async del(key) { return redis('DEL', k(key)); },
  async get(key) { return redis('GET', k(key)); },
  async set(key, val) { return redis('SET', k(key), String(val)); },
  async sadd(key, member) { return redis('SADD', k(key), member); },
  async smembers(key) { return (await redis('SMEMBERS', k(key))) || []; },
  async log(entry) {
    await redis('LPUSH', k('events'), JSON.stringify({ at: new Date().toISOString(), ...entry }));
    await redis('LTRIM', k('events'), 0, 299);
  },
  async events(n = 100) { return ((await redis('LRANGE', k('events'), 0, n - 1)) || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean); },
  async incrWindow(key, windowSec) {
    const n = await redis('INCR', k(key));
    if (n === 1) await redis('EXPIRE', k(key), windowSec);
    return n;
  },
};

/* ---------------------------------------------------------------- requests */
export function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (xf || req.headers['x-real-ip'] || req.socket?.remoteAddress || '0.0.0.0').toString().slice(0, 64);
}

/** Lê o corpo cru (necessário para conferir assinatura de webhook). */
// Importante: na Vercel, `req.body` é um getter que consome o stream. Por isso
// lemos o stream ANTES de tocar em req.body.
export async function rawBody(req, limit = 256 * 1024) {
  if (req.readable && !req.readableEnded) {
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, 'Corpo muito grande.');
      chunks.push(c);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const b = req.body;
  if (typeof b === 'string') return b;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  if (b && typeof b === 'object') return JSON.stringify(b); // já interpretado: reconstrução
  return '';
}

export async function jsonBody(req, limit = 32 * 1024) {
  const raw = await rawBody(req, limit);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido.'); }
}

/** Ações que mudam estado exigem JSON + cabeçalho próprio (barra CSRF por formulário). */
export function assertSafeMutation(req) {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const ct = String(req.headers['content-type'] || '');
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'Envie application/json.');
  if (req.headers['x-requested-with'] !== 'kit') throw new HttpError(403, 'Requisição recusada.');
}

export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

/* ------------------------------------------------------------------ crypto */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a ?? '').length === String(b ?? '').length;
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64url');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64url'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}

export const randomCode = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url').replace(/[-_]/g, 'x').toUpperCase();

/* ----------------------------------------------------------------- session */
const COOKIE = '__Host-sid';
const SESSION_DAYS = 14;

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length >= 32) return s;
  if (IS_PROD) throw new HttpError(503, 'SESSION_SECRET ausente ou curto (mínimo 32 caracteres).');
  return 'dev-only-secret-dev-only-secret-dev-only';
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!safeEqual(mac, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p && p.x > Date.now() ? p : null;
  } catch { return null; }
}

function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const secureFlag = () => (process.env.VERCEL || IS_PROD ? '; Secure' : '');
const cookieName = () => (process.env.VERCEL || IS_PROD ? COOKIE : 'sid'); // __Host- exige HTTPS

export function setSession(res, email, role, ver) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = sign({ e: email, r: role, v: ver || 0, x: exp });
  res.setHeader('Set-Cookie', `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureFlag()}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`);
}

export function readSession(req) { return unsign(readCookie(req, cookieName())); }

/* ------------------------------------------------------------------ access */
export const normEmail = e => String(e || '').trim().toLowerCase().slice(0, 254);
export const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export function isAdminEmail(email) {
  const a = normEmail(process.env.ADMIN_EMAIL);
  return !!a && a === normEmail(email);
}

export function accessIsActive(acc) {
  if (!acc || !acc.active) return false;
  if (acc.expiresAt && Date.parse(acc.expiresAt) < Date.now()) return false;
  return true;
}

/** Retorna { email, role, active, access } ou null. Revalida no banco a cada chamada. */
export async function currentUser(req) {
  const s = readSession(req);
  if (!s) return null;
  if (s.r === 'admin') {
    if (!isAdminEmail(s.e)) return null;
    const v = Number(await db.get('admin:ver')) || 0;
    if (v !== (s.v || 0)) return null;
    return { email: s.e, role: 'admin', active: true, access: null };
  }
  const user = await db.getJson(`user:${s.e}`);
  if (!user || (user.ver || 0) !== (s.v || 0)) return null;
  const access = await db.getJson(`access:${s.e}`);
  return { email: s.e, role: 'customer', active: accessIsActive(access), access };
}

/** Use nas suas rotas pagas: lança 401/402 se não houver assinatura ativa. */
export async function requireActive(req) {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, 'Entre na sua conta para continuar.');
  if (!u.active) throw new HttpError(402, 'Sua assinatura não está ativa. Veja os planos em /precos.');
  return u;
}

export async function requireAdmin(req) {
  const u = await currentUser(req);
  if (!u || u.role !== 'admin') throw new HttpError(403, 'Acesso restrito ao administrador.');
  return u;
}

/** Limite simples por IP + chave. */
export async function rateLimit(req, bucket, max, windowSec) {
  const n = await db.incrWindow(`rl:${bucket}:${clientIp(req)}`, windowSec);
  if (n > max) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
}

/* ------------------------------------------------------------------- plans */
export const PERIOD_DAYS = { mensal: 31, trimestral: 93, semestral: 186, anual: 366, vitalicio: 0 };

export async function getPlans() { return (await db.getJson('plans')) || []; }

export function sanitizePlans(input) {
  if (!Array.isArray(input)) throw new HttpError(400, 'Envie uma lista de planos.');
  if (input.length > 8) throw new HttpError(400, 'Máximo de 8 planos.');
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  const url = v => { const s = str(v, 400); if (!s) return ''; if (!/^https:\/\/[^\s"'<>]+$/.test(s)) throw new HttpError(400, `Link inválido: ${s.slice(0, 60)}`); return s; };
  return input.map((p, i) => {
    const period = PERIOD_DAYS[p.period] !== undefined ? p.period : 'mensal';
    const price = Number(String(p.price ?? '').replace(',', '.'));
    if (!Number.isFinite(price) || price < 0 || price > 100000) throw new HttpError(400, `Preço inválido no plano ${i + 1}.`);
    return {
      id: str(p.id, 40).replace(/[^\w-]/g, '') || `plano-${i + 1}`,
      name: str(p.name, 60) || `Plano ${i + 1}`,
      price: Math.round(price * 100) / 100,
      period,
      description: str(p.description, 200),
      features: (Array.isArray(p.features) ? p.features : String(p.features || '').split('\n')).map(f => str(f, 120)).filter(Boolean).slice(0, 12),
      highlight: !!p.highlight,
      kiwifyUrl: url(p.kiwifyUrl),
      hotmartUrl: url(p.hotmartUrl),
      kiwifyProductId: str(p.kiwifyProductId, 80),
      hotmartProductId: str(p.hotmartProductId, 80),
    };
  });
}

/* --------------------------------------------------------- grant / revoke */
export async function grantAccess({ email, provider, orderId, productId, event, plan }) {
  email = normEmail(email);
  if (!isEmail(email)) throw new HttpError(400, 'E-mail do comprador ausente.');
  const prev = (await db.getJson(`access:${email}`)) || { orders: [] };
  const days = plan ? PERIOD_DAYS[plan.period] : 0;
  const base = prev.expiresAt && Date.parse(prev.expiresAt) > Date.now() ? Date.parse(prev.expiresAt) : Date.now();
  const access = {
    active: true,
    plan: plan?.id || prev.plan || null,
    planName: plan?.name || prev.planName || null,
    provider,
    expiresAt: days ? new Date(base + (days + 3) * 864e5).toISOString() : null, // 3 dias de tolerância
    orders: [...new Set([String(orderId || ''), ...(prev.orders || [])].filter(Boolean))].slice(0, 30),
    productId: productId || prev.productId || null,
    updatedAt: new Date().toISOString(),
    createdAt: prev.createdAt || new Date().toISOString(),
  };
  await db.setJson(`access:${email}`, access);
  await db.sadd('customers', email);
  if (orderId) await db.set(`order:${String(orderId).toUpperCase()}`, email);
  await db.log({ type: 'grant', email, provider, orderId, event });
  return access;
}

export async function revokeAccess({ email, provider, orderId, event, reason }) {
  email = normEmail(email);
  const prev = await db.getJson(`access:${email}`);
  if (!prev) return null;
  const access = { ...prev, active: false, revokedReason: reason || event, updatedAt: new Date().toISOString() };
  await db.setJson(`access:${email}`, access);
  await db.log({ type: 'revoke', email, provider, orderId, event });
  return access;
}
