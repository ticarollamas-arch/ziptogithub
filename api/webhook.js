// POST /api/webhook?provider=kiwify|hotmart
//
// Kiwify : configure a URL .../api/webhook?provider=kiwify e copie o TOKEN do webhook
//          para a variável KIWIFY_TOKEN. A Kiwify envia ?signature=<hmac-sha1(token, corpo)>.
// Hotmart: configure a URL .../api/webhook?provider=hotmart (versão 2.0.0) e copie o
//          Hottok (Ferramentas → Webhook) para HOTMART_HOTTOK. Vem no cabeçalho X-HOTMART-HOTTOK.
//
// Eventos que liberam acesso: compra aprovada / renovação de assinatura.
// Eventos que bloqueiam: reembolso, chargeback, cancelamento de assinatura, disputa.
import crypto from 'node:crypto';
import { HttpError, sendError, noStore, rawBody, safeEqual, db, getPlans, grantAccess, revokeAccess } from './_kit/core.js';

const KIWIFY_GRANT = new Set(['order_approved', 'compra_aprovada', 'subscription_renewed', 'paid', 'approved']);
const KIWIFY_REVOKE = new Set(['order_refunded', 'compra_reembolsada', 'refunded', 'chargeback', 'chargedback', 'subscription_canceled']);

const HOTMART_GRANT = new Set(['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'approved', 'completed']);
const HOTMART_REVOKE = new Set(['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_CANCELED', 'PURCHASE_PROTEST',
  'SUBSCRIPTION_CANCELLATION', 'refunded', 'chargeback', 'canceled', 'dispute', 'blocked']);

function verifyKiwify(req, raw, parsed) {
  const token = process.env.KIWIFY_TOKEN || '';
  if (!token) throw new HttpError(503, 'KIWIFY_TOKEN não configurado.');
  const sig = String(req.query?.signature || req.headers['x-kiwify-signature'] || '').toLowerCase();
  if (!sig) throw new HttpError(401, 'Assinatura ausente.');
  const candidates = [raw, JSON.stringify(parsed)];
  const ok = candidates.some(body => safeEqual(sig, crypto.createHmac('sha1', token).update(body).digest('hex')));
  if (!ok) throw new HttpError(401, 'Assinatura inválida.');
}

function verifyHotmart(req, parsed) {
  const hottok = process.env.HOTMART_HOTTOK || '';
  if (!hottok) throw new HttpError(503, 'HOTMART_HOTTOK não configurado.');
  const got = String(req.headers['x-hotmart-hottok'] || parsed?.hottok || '');
  if (!got || !safeEqual(got, hottok)) throw new HttpError(401, 'Hottok inválido.');
}

function parseKiwify(p) {
  const event = String(p.webhook_event_type || p.order_status || '').trim();
  return {
    event,
    email: p.Customer?.email || p.customer?.email,
    orderId: p.order_id || p.order_ref,
    productId: String(p.Product?.product_id || p.product?.id || ''),
    grant: KIWIFY_GRANT.has(event) || (p.order_status === 'paid' && !KIWIFY_REVOKE.has(event)),
    revoke: KIWIFY_REVOKE.has(event) || ['refunded', 'chargedback'].includes(p.order_status),
  };
}

function parseHotmart(p) {
  if (p.event && p.data) { // v2.0.0
    const d = p.data;
    return {
      event: p.event,
      eventId: p.id,
      email: d.buyer?.email || d.subscriber?.email,
      orderId: d.purchase?.transaction,
      productId: String(d.product?.id || ''),
      grant: HOTMART_GRANT.has(p.event),
      revoke: HOTMART_REVOKE.has(p.event),
    };
  }
  const status = String(p.status || ''); // v1 (formulário)
  return { event: status, email: p.email, orderId: p.transaction, productId: String(p.prod || ''), grant: HOTMART_GRANT.has(status), revoke: HOTMART_REVOKE.has(status) };
}

function parseMaybeForm(raw) {
  try { return JSON.parse(raw); } catch { /* pode ser x-www-form-urlencoded (Hotmart v1) */ }
  return Object.fromEntries(new URLSearchParams(raw));
}

export default async function handler(req, res) {
  noStore(res);
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    const provider = String(req.query?.provider || '');
    const raw = await rawBody(req, 256 * 1024);
    const payload = parseMaybeForm(raw);

    let info;
    if (provider === 'kiwify') { verifyKiwify(req, raw, payload); info = parseKiwify(payload); }
    else if (provider === 'hotmart') { verifyHotmart(req, payload); info = parseHotmart(payload); }
    else throw new HttpError(404, 'Provedor desconhecido.');

    // Idempotência: a mesma notificação pode chegar mais de uma vez.
    const dedupe = `wh:${provider}:${info.eventId || ''}:${info.orderId || ''}:${info.event}`;
    if (!(await db.setNx(dedupe, 1, 7 * 86400))) return res.status(200).json({ ok: true, duplicate: true });

    const plans = await getPlans();
    const plan = plans.find(p => (provider === 'kiwify' ? p.kiwifyProductId : p.hotmartProductId) === info.productId && info.productId) || null;

    if (info.grant) await grantAccess({ ...info, provider, plan });
    else if (info.revoke) await revokeAccess({ ...info, provider });
    else await db.log({ type: 'ignored', provider, event: info.event, email: info.email });

    return res.status(200).json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
