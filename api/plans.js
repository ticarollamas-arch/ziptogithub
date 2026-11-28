// GET /api/plans -> { product, plans } (público; preços são editados em /admin)
import { sendError, getPlans, HttpError } from './_kit/core.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Use GET.');
    const plans = (await getPlans()).map(({ kiwifyProductId, hotmartProductId, ...pub }) => pub);
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    res.status(200).json({ plans, support: process.env.SUPPORT_EMAIL || null });
  } catch (err) {
    sendError(res, err);
  }
}
