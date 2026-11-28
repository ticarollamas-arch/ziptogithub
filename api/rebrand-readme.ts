// Função da Vercel (mesma lógica do server.ts). Exige assinatura ativa.
import { rebrandReadme } from '../lib/handlers.js';
import { paid } from '../lib/paid.js';

export default paid(rebrandReadme);
