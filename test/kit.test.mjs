// Testes do kit sem rede: banco em memória, req/res simulados.
// Rodar: node --test test/  (a partir da raiz do repositório)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

process.env.ADMIN_EMAIL = 'admin@exemplo.com';
process.env.ADMIN_PASSWORD = 'senha-admin-forte-123';
process.env.KIWIFY_TOKEN = 'kiwi-token';
process.env.HOTMART_HOTTOK = 'hot-token';
delete process.env.VERCEL_ENV; delete process.env.NODE_ENV;

const auth = (await import('../api/auth.js')).default;
const admin = (await import('../api/admin.js')).default;
const webhook = (await import('../api/webhook.js')).default;
const plansApi = (await import('../api/plans.js')).default;
const { requireActive } = await import('../api/_kit/core.js');

function mkReq({ method = 'GET', query = {}, headers = {}, body, raw } = {}) {
  const text = raw ?? (body !== undefined ? JSON.stringify(body) : '');
  const r = Readable.from(text ? [Buffer.from(text)] : []);
  r.method = method; r.query = query;
  r.headers = { 'x-forwarded-for': '1.2.3.4', ...(body !== undefined ? { 'content-type': 'application/json', 'x-requested-with': 'kit' } : {}), ...headers };
  return r;
}
function mkRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  res.send = b => { res.body = b; return res; };
  return res;
}
async function call(h, opts) { const res = mkRes(); await h(mkReq(opts), res); return res; }
const cookieOf = res => String(res.headers['set-cookie']).split(';')[0];

let adminCookie;

test('login de admin e senha errada', async () => {
  const bad = await call(auth, { method: 'POST', query: { action: 'login' }, body: { email: 'admin@exemplo.com', password: 'x' } });
  assert.equal(bad.statusCode, 401);
  const ok = await call(auth, { method: 'POST', query: { action: 'login' }, body: { email: 'admin@exemplo.com', password: 'senha-admin-forte-123' } });
  assert.equal(ok.statusCode, 200);
  assert.match(String(ok.headers['set-cookie']), /HttpOnly/);
  adminCookie = cookieOf(ok);
});

test('mutação sem cabeçalho X-Requested-With é recusada (CSRF)', async () => {
  const r = await call(auth, { method: 'POST', query: { action: 'login' }, raw: '{}', headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 403);
});

test('admin salva planos e /api/plans esconde IDs internos', async () => {
  const r = await call(admin, { method: 'POST', query: { action: 'save-plans' }, headers: { cookie: adminCookie },
    body: { plans: [{ id: 'mensal', name: 'Mensal', price: '27,90', period: 'mensal', features: 'A\nB', kiwifyUrl: 'https://pay.kiwify.com.br/abc', kiwifyProductId: 'PK1', hotmartProductId: 'PH1' }] } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.plans[0].price, 27.9);
  const pub = await call(plansApi, {});
  assert.equal(pub.body.plans[0].kiwifyProductId, undefined);
  const bad = await call(admin, { method: 'POST', query: { action: 'save-plans' }, headers: { cookie: adminCookie }, body: { plans: [{ name: 'x', price: 1, kiwifyUrl: 'javascript:alert(1)' }] } });
  assert.equal(bad.statusCode, 400);
});

test('admin exige sessão de admin', async () => {
  const r = await call(admin, { query: { action: 'overview' } });
  assert.equal(r.statusCode, 403);
});

test('webhook Kiwify: assinatura inválida recusada, válida libera acesso com validade', async () => {
  const payload = { order_id: 'KW-123', order_status: 'paid', webhook_event_type: 'order_approved', Customer: { email: 'Cliente@Ex.com' }, Product: { product_id: 'PK1' } };
  const raw = JSON.stringify(payload);
  const bad = await call(webhook, { method: 'POST', query: { provider: 'kiwify', signature: 'deadbeef' }, raw });
  assert.equal(bad.statusCode, 401);
  const sig = crypto.createHmac('sha1', 'kiwi-token').update(raw).digest('hex');
  const ok = await call(webhook, { method: 'POST', query: { provider: 'kiwify', signature: sig }, raw });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const dup = await call(webhook, { method: 'POST', query: { provider: 'kiwify', signature: sig }, raw });
  assert.equal(dup.body.duplicate, true);
});

let customerCookie;
test('primeiro acesso exige código do pedido certo', async () => {
  const wrong = await call(auth, { method: 'POST', query: { action: 'register' }, body: { email: 'cliente@ex.com', order: 'NAO-EXISTE', password: '12345678' } });
  assert.equal(wrong.statusCode, 404);
  const other = await call(auth, { method: 'POST', query: { action: 'register' }, body: { email: 'intruso@ex.com', order: 'KW-123', password: '12345678' } });
  assert.equal(other.statusCode, 404);
  const ok = await call(auth, { method: 'POST', query: { action: 'register' }, body: { email: 'cliente@ex.com', order: 'kw-123', password: '12345678' } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  customerCookie = cookieOf(ok);
  const me = await call(auth, { query: { action: 'me' }, headers: { cookie: customerCookie } });
  assert.equal(me.body.user.active, true);
  assert.equal(me.body.user.plan, 'Mensal');
  assert.ok(me.body.user.expiresAt);
  const u = await requireActive(mkReq({ headers: { cookie: customerCookie } }));
  assert.equal(u.email, 'cliente@ex.com');
});

test('cliente não acessa admin; cookie adulterado é ignorado', async () => {
  const r = await call(admin, { query: { action: 'overview' }, headers: { cookie: customerCookie } });
  assert.equal(r.statusCode, 403);
  const [name, val] = customerCookie.split('=');
  const [body, mac] = val.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'admin@exemplo.com', r: 'admin', v: 0, x: Date.now() + 1e9 })).toString('base64url');
  const r2 = await call(admin, { query: { action: 'overview' }, headers: { cookie: `${name}=${forged}.${mac}` } });
  assert.equal(r2.statusCode, 403);
  void body;
});

test('webhook Hotmart: hottok errado recusado; reembolso revoga', async () => {
  const p = { id: 'evt-1', event: 'PURCHASE_REFUNDED', data: { buyer: { email: 'cliente@ex.com' }, purchase: { transaction: 'KW-123' }, product: { id: 'PH1' } } };
  const bad = await call(webhook, { method: 'POST', query: { provider: 'hotmart' }, headers: { 'x-hotmart-hottok': 'errado' }, raw: JSON.stringify(p) });
  assert.equal(bad.statusCode, 401);
  const ok = await call(webhook, { method: 'POST', query: { provider: 'hotmart' }, headers: { 'x-hotmart-hottok': 'hot-token' }, raw: JSON.stringify(p) });
  assert.equal(ok.statusCode, 200);
  await assert.rejects(() => requireActive(mkReq({ headers: { cookie: customerCookie } })), e => e.status === 402);
});

test('nova senha derruba sessões antigas', async () => {
  const ok = await call(auth, { method: 'POST', query: { action: 'register' }, body: { email: 'cliente@ex.com', order: 'KW-123', password: 'outra-senha-1' } });
  assert.equal(ok.statusCode, 200);
  const me = await call(auth, { query: { action: 'me' }, headers: { cookie: customerCookie } });
  assert.equal(me.body.user, null);
});

test('limite de tentativas de login', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call(auth, { method: 'POST', query: { action: 'login' }, headers: { 'x-forwarded-for': '9.9.9.9' }, body: { email: 'x@y.com', password: 'nope-nope' } });
  assert.equal(last.statusCode, 429);
});
