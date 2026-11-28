// /api/admin?action=overview|plans|save-plans|grant|revoke|logout-all   (só administrador)
import {
  HttpError, sendError, noStore, jsonBody, assertSafeMutation, requireAdmin, db,
  getPlans, sanitizePlans, grantAccess, revokeAccess, normEmail, isEmail, randomCode,
  accessIsActive, PERIOD_DAYS,
} from './_kit/core.js';

export default async function handler(req, res) {
  noStore(res);
  try {
    const admin = await requireAdmin(req);
    const action = String(req.query?.action || '');

    if (action === 'overview') {
      if (req.method !== 'GET') throw new HttpError(405, 'Use GET.');
      const emails = (await db.smembers('customers')).slice(0, 2000);
      const customers = [];
      for (const email of emails) {
        const [acc, user] = await Promise.all([db.getJson(`access:${email}`), db.getJson(`user:${email}`)]);
        customers.push({
          email,
          active: accessIsActive(acc),
          plan: acc?.planName || '—',
          provider: acc?.provider || '—',
          expiresAt: acc?.expiresAt || null,
          hasAccount: !!user,
          updatedAt: acc?.updatedAt || null,
        });
      }
      customers.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      const host = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
      return res.status(200).json({
        admin: admin.email,
        stats: {
          total: customers.length,
          active: customers.filter(c => c.active).length,
          withAccount: customers.filter(c => c.hasAccount).length,
        },
        customers,
        events: await db.events(60),
        plans: await getPlans(),
        periods: Object.keys(PERIOD_DAYS),
        webhooks: {
          kiwify: `${host}/api/webhook?provider=kiwify`,
          hotmart: `${host}/api/webhook?provider=hotmart`,
          kiwifyConfigured: !!process.env.KIWIFY_TOKEN,
          hotmartConfigured: !!process.env.HOTMART_HOTTOK,
          thankYou: `${host}/obrigado`,
        },
      });
    }

    assertSafeMutation(req);
    const body = await jsonBody(req, 64 * 1024);

    if (action === 'save-plans') {
      const plans = sanitizePlans(body.plans);
      await db.setJson('plans', plans);
      await db.log({ type: 'plans-updated', email: admin.email, count: plans.length });
      return res.status(200).json({ ok: true, plans });
    }

    if (action === 'grant') {
      const email = normEmail(body.email);
      if (!isEmail(email)) throw new HttpError(400, 'E-mail inválido.');
      const plans = await getPlans();
      const plan = plans.find(p => p.id === body.planId) || null;
      const code = `MAN-${randomCode(6)}`;
      await grantAccess({ email, provider: 'manual', orderId: code, event: 'manual-grant', plan });
      return res.status(200).json({ ok: true, code, message: `Acesso liberado. Envie ao cliente o código ${code} para o primeiro acesso em /entrar.` });
    }

    if (action === 'revoke') {
      const email = normEmail(body.email);
      const r = await revokeAccess({ email, provider: 'manual', event: 'manual-revoke', reason: 'Revogado pelo admin' });
      if (!r) throw new HttpError(404, 'Cliente não encontrado.');
      return res.status(200).json({ ok: true });
    }

    if (action === 'logout-all') {
      // Encerra sessões de admin abertas em outros aparelhos.
      const v = (Number(await db.get('admin:ver')) || 0) + 1;
      await db.set('admin:ver', v);
      return res.status(200).json({ ok: true });
    }

    throw new HttpError(404, 'Ação desconhecida.');
  } catch (err) {
    sendError(res, err);
  }
}
