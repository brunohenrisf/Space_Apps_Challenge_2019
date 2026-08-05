import { Router } from 'express';
import QRCode from 'qrcode';
import { requireAdminPage } from '../auth.js';
import { config } from '../config.js';

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

/** Só aceita http/https: o QR fica impresso na mesa, não pode virar vetor de phishing. */
function safeUrl(candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return config.publicUrl;
  try {
    const url = new URL(candidate.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return config.publicUrl;
    return url.toString().replace(/\/$/, '');
  } catch {
    return config.publicUrl;
  }
}

const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 1,
  color: { dark: '#2f2a24', light: '#ffffff' },
};

export function createQrRouter() {
  const router = Router();

  // O guard vai rota a rota, não em `router.use`: este roteador é montado em `/`
  // e um middleware global aqui interceptaria também o CSS e o JS da página
  // dos convidados, redirecionando tudo para o login.
  router.get('/qr.svg', requireAdminPage, async (req, res, next) => {
    try {
      const svg = await QRCode.toString(safeUrl(req.query.url), { ...QR_OPTIONS, type: 'svg' });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', 'attachment; filename="qrcode-casamento.svg"');
      res.send(svg);
    } catch (error) {
      next(error);
    }
  });

  router.get('/qr.png', requireAdminPage, async (req, res, next) => {
    try {
      const png = await QRCode.toBuffer(safeUrl(req.query.url), { ...QR_OPTIONS, width: 1200 });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'attachment; filename="qrcode-casamento.png"');
      res.send(png);
    } catch (error) {
      next(error);
    }
  });

  router.get('/qr', requireAdminPage, async (req, res, next) => {
    try {
      const url = safeUrl(req.query.url);
      const copies = Math.min(Math.max(Number.parseInt(req.query.copias ?? '4', 10) || 4, 1), 60);
      const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' });

      const card = `
        <article class="card">
          <p class="card-eyebrow">${escapeHtml(config.couple.names)}</p>
          <h2 class="card-title">Você tirou uma foto?</h2>
          <p class="card-text">Aponte a câmera do celular para o código e mande pra gente.</p>
          <div class="card-qr">${svg}</div>
          <p class="card-url">${escapeHtml(url.replace(/^https?:\/\//, ''))}</p>
        </article>`;

      res.type('html').send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QR Code das mesas — ${escapeHtml(config.couple.names)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/style.css">
<style>
  .qr-toolbar { display: grid; gap: 1rem; margin-bottom: 2rem; }
  .qr-toolbar form { display: flex; flex-wrap: wrap; gap: .75rem; align-items: flex-end; }
  .qr-toolbar label { display: grid; gap: .35rem; font-size: .85rem; flex: 1 1 16rem; }
  .qr-downloads { display: flex; flex-wrap: wrap; gap: .75rem; }
  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6mm; }
  .card {
    border: 1px dashed var(--line); border-radius: 10px; padding: 8mm 6mm;
    text-align: center; background: #fff; color: #2f2a24; break-inside: avoid;
  }
  .card-eyebrow { font-family: var(--font-display); font-size: 1.35rem; margin: 0 0 .35rem; letter-spacing: .04em; }
  .card-title { font-family: var(--font-display); font-size: 1.05rem; font-weight: 500; margin: 0 0 .3rem; }
  .card-text { font-size: .78rem; color: #6b6055; margin: 0 0 5mm; line-height: 1.45; }
  .card-qr { margin: 0 auto; width: 46mm; }
  .card-qr svg { width: 100%; height: auto; display: block; }
  .card-url { font-size: .72rem; color: #6b6055; margin: 4mm 0 0; word-break: break-all; }
  @media print {
    @page { size: A4; margin: 10mm; }
    body { background: #fff; padding: 0; }
    .no-print { display: none !important; }
    .sheet { gap: 0; }
    .card { border-style: dashed; border-color: #d8cec2; }
  }
</style>
</head>
<body>
  <main class="page">
    <header class="page-head no-print">
      <p class="eyebrow">Painel dos noivos</p>
      <h1>QR Code das mesas</h1>
      <p class="lede">Imprima, recorte e deixe um cartão em cada mesa. Cada convidado aponta a câmera e cai direto na página de envio.</p>
    </header>

    <section class="qr-toolbar no-print">
      <form method="get" action="/qr">
        <label>
          Endereço que o QR Code vai abrir
          <input type="url" name="url" value="${escapeHtml(url)}" required>
        </label>
        <label style="flex: 0 1 8rem;">
          Cartões
          <input type="number" name="copias" min="1" max="60" value="${copies}" required>
        </label>
        <button type="submit" class="btn btn-secondary">Atualizar</button>
      </form>
      <div class="qr-downloads">
        <button type="button" class="btn" id="btn-print">Imprimir cartões</button>
        <a class="btn btn-secondary" href="/qr.png?url=${encodeURIComponent(url)}">Baixar PNG</a>
        <a class="btn btn-secondary" href="/qr.svg?url=${encodeURIComponent(url)}">Baixar SVG</a>
        <a class="btn btn-ghost" href="/painel">Voltar ao painel</a>
      </div>
      ${
        url.includes('localhost') || url.includes('127.0.0.1')
          ? '<p class="alert">Esse endereço é local e só funciona neste computador. Antes de imprimir, publique o site e defina <code>PUBLIC_URL</code> no <code>.env</code> (ou troque o endereço no campo acima).</p>'
          : ''
      }
    </section>

    <div class="sheet">${card.repeat(copies)}</div>
  </main>
  <script src="/js/qr.js"></script>
</body>
</html>`);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
