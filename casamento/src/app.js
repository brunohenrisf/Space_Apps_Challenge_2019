import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { createAdminRouter } from './routes/admin.js';
import { createPhotosRouter } from './routes/photos.js';
import { createQrRouter } from './routes/qr.js';

export function createApp(store) {
  const app = express();
  const publicDir = path.join(config.rootDir, 'public');

  // Atrás de um proxy (Railway, Render, Nginx) o IP real vem no X-Forwarded-For;
  // sem isso o rate limit enxergaria todos os convidados como um cliente só.
  if (config.trustProxy) app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' blob: data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    next();
  });

  app.use(express.json({ limit: '32kb' }));

  // A página do convidado já sai do servidor com nomes/data/mensagem — evita o
  // "flash" de conteúdo genérico ao abrir pelo QR Code.
  const guestPage = fs
    .readFileSync(path.join(publicDir, 'index.html'), 'utf8')
    .replace(
      '<!--CONFIG-->',
      `<script type="application/json" id="config">${JSON.stringify(config.couple).replace(/</g, '\\u003c')}</script>`,
    );

  app.get('/', (_req, res) => res.type('html').send(guestPage));
  app.get('/painel', (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

  app.use('/api', createPhotosRouter(store));
  app.use('/api/admin', createAdminRouter(store));
  app.use('/', createQrRouter());

  app.use(express.static(publicDir, { index: false, maxAge: '1h' }));

  app.use((_req, res) => res.status(404).json({ error: 'Página não encontrada.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    console.error('[erro]', error);
    if (res.headersSent) return res.destroy();
    return res.status(500).json({ error: 'Algo deu errado no servidor. Tente novamente.' });
  });

  return app;
}
