// Função serverless da Vercel: reaproveita as mesmas rotas Express do app.ts.
// Quando o app roda dentro do portfólio, as chamadas chegam como /zip-to-git/api/...;
// o prefixo é removido para casar com as rotas originais (/api/...).
import type { IncomingMessage, ServerResponse } from 'http';
import app from '../app.js';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url) req.url = req.url.replace(/^\/zip-to-git(?=\/api\/)/, '');
  return (app as unknown as (rq: IncomingMessage, rs: ServerResponse) => void)(req, res);
}
