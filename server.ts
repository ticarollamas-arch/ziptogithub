import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { analyzeArchitecture, rebrandReadme, validatePackage } from './lib/handlers.js';
import { paid } from './lib/paid.js';
// @ts-ignore — módulos JS do kit
import auth from './api/auth.js';
// @ts-ignore
import admin from './api/admin.js';
// @ts-ignore
import plans from './api/plans.js';
// @ts-ignore
import webhook from './api/webhook.js';
import path from 'path';

dotenv.config();

const app = express();
// Cabeçalhos de segurança
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Kit comercial (mesmos arquivos usados pelas funções da Vercel). Antes do express.json
// para que o webhook leia o corpo cru e confira a assinatura.
app.all('/api/auth', auth);
app.all('/api/admin', admin);
app.all('/api/plans', plans);
app.all('/api/webhook', webhook);

app.use(express.json({ limit: '5mb' }));

// Recursos de IA: só para assinantes ativos.
app.post('/api/analyze-architecture', paid(analyzeArchitecture));
app.post('/api/rebrand-readme', paid(rebrandReadme));
app.post('/api/validate-package', validatePackage);

const port = Number(process.env.PORT) || 3000;

// Development with Vite middlewares or Production static serving
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`ZipToGit server ready at http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
