import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
import api from './routes/api';
import { seedPlans, ensureSettings } from './store';
import { ensureAdmin } from './auth';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json());

// API
app.use('/api', api);

// Serve o protótipo (portal captivo) em / e o painel em /admin
const prototypeDir = path.resolve(__dirname, '../../prototype');
app.use(express.static(prototypeDir));

app.get('/health', (_req, res) => res.json({ ok: true }));

async function start() {
  await ensureSettings();  // cria a linha de settings (id=1) se faltar
  await seedPlans();       // semeia os planos padrão na primeira execução
  await ensureAdmin();     // cria o admin inicial se não houver nenhum
  app.listen(PORT, () => {
    console.log(`ConectaVoucher rodando em http://localhost:${PORT}`);
    console.log(`Entrada:  http://localhost:${PORT}/            (escolhe Cliente ou Administrador)`);
    console.log(`Cliente:  http://localhost:${PORT}/portal.html`);
    console.log(`Admin:    http://localhost:${PORT}/admin.html`);
  });
}
start().catch((e) => { console.error('Falha no boot:', e); process.exit(1); });
