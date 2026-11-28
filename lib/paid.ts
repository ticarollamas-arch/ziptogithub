// Envolve uma rota de IA exigindo assinatura ativa (kit comercial).
// @ts-ignore — módulo JS do kit
import { requireActive, sendError } from '../api/_kit/core.js';

export function paid(handler: (req: any, res: any) => Promise<void>) {
  return async (req: any, res: any): Promise<void> => {
    try {
      await requireActive(req);
    } catch (err) {
      sendError(res, err);
      return;
    }
    return handler(req, res);
  };
}
