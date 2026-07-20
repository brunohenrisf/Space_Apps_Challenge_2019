import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
import api from './routes/api';

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

app.listen(PORT, () => {
  console.log(`ConectaVoucher rodando em http://localhost:${PORT}`);
  console.log(`Portal:  http://localhost:${PORT}/`);
  console.log(`Painel:  http://localhost:${PORT}/admin.html`);
});
