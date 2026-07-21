import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
import api from './routes/api';
import { ensureDefaultAccount } from './store';
import { ensureAdmin } from './auth';
import { startReconciliation } from './services/jobs';
import { log } from './services/log';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.set('trust proxy', 1); // atrás do Caddy: req.ip = IP real (X-Forwarded-For)
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// Cabeçalhos de segurança básicos (sem dependências).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// API
app.use('/api', api);

// Serve o protótipo (portal captivo) em / e o painel em /admin
const prototypeDir = path.resolve(__dirname, '../../prototype');
app.use(express.static(prototypeDir));

app.get('/health', (_req, res) => res.json({ ok: true }));

async function start() {
  const acc = await ensureDefaultAccount();  // conta padrão (Efí do .env) + planos semeados
  await ensureAdmin(acc.id);                 // admin inicial sob a conta
  startReconciliation();                     // expira cobranças vencidas + reprovisiona
  app.listen(PORT, () => {
    log.info('server.started', { port: PORT });
    console.log(`ConectaVoucher rodando em http://localhost:${PORT}`);
    console.log(`Cliente:  http://localhost:${PORT}/portal.html`);
    console.log(`Admin:    http://localhost:${PORT}/admin.html`);
  });
}
start().catch((e) => { console.error('Falha no boot:', e); process.exit(1); });
