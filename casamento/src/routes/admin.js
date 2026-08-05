import fs from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { Router } from 'express';
import { checkPassword, endSession, isAuthenticated, requireAdmin, sameOriginOnly, startSession } from '../auth.js';
import { config } from '../config.js';
import { rateLimit } from '../rateLimit.js';

const SAFE_STORED_NAME = /^[\w-]+\.[a-z0-9]+$/i;

function resolveStored(dir, storedName) {
  if (typeof storedName !== 'string' || !SAFE_STORED_NAME.test(storedName)) return null;
  const resolved = path.resolve(dir, storedName);
  return resolved.startsWith(path.resolve(dir) + path.sep) ? resolved : null;
}

/** Nome do arquivo dentro do .zip: ordenado, com o convidado no nome. */
function zipEntryName(photo, index) {
  const stamp = photo.uploadedAt.slice(0, 19).replace(/[:T]/g, '-');
  // Mantém acentos (João, Conceição) e tira só o que atrapalha em sistema de arquivos.
  const guest = photo.guestName
    ? `-${photo.guestName.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim()}`
    : '';
  return `${String(index + 1).padStart(4, '0')}-${stamp}${guest}${path.extname(photo.storedName)}`;
}

export function createAdminRouter(store) {
  const router = Router();

  const loginLimiter = rateLimit({
    ...config.loginLimit,
    message: 'Muitas tentativas de senha. Aguarde alguns minutos.',
  });

  router.post('/login', sameOriginOnly, loginLimiter, (req, res) => {
    if (!checkPassword(req.body?.password)) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }
    startSession(req, res);
    return res.json({ ok: true });
  });

  router.post('/logout', sameOriginOnly, (req, res) => {
    endSession(req, res);
    res.json({ ok: true });
  });

  router.get('/session', (req, res) => {
    res.json({ authenticated: isAuthenticated(req) });
  });

  // Tudo abaixo desta linha exige sessão dos noivos.
  router.use(requireAdmin);

  router.get('/photos', (req, res) => {
    const photos = store.list({ includeHidden: true }).map((photo) => ({
      id: photo.id,
      originalName: photo.originalName,
      mime: photo.mime,
      size: photo.size,
      guestName: photo.guestName,
      message: photo.message,
      uploadedAt: photo.uploadedAt,
      hidden: photo.hidden,
      hasThumb: Boolean(photo.thumbName),
    }));
    res.json({ photos, stats: store.stats(), couple: config.couple });
  });

  function sendStoredFile(res, dir, storedName, mime, { download } = {}) {
    const filePath = resolveStored(dir, storedName);
    if (!filePath) return res.status(404).json({ error: 'Arquivo não encontrado.' });

    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader(
      'Content-Disposition',
      download ? `attachment; filename="${download}"` : 'inline',
    );
    return res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) res.status(404).end();
    });
  }

  router.get('/photos/:id/arquivo', (req, res) => {
    const photo = store.get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada.' });
    const download = req.query.download === '1' ? photo.originalName : null;
    return sendStoredFile(res, config.originalsDir, photo.storedName, photo.mime, { download });
  });

  router.get('/photos/:id/miniatura', (req, res) => {
    const photo = store.get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada.' });
    // Sem miniatura (HEIC em navegador que não decodifica, por exemplo):
    // devolvemos a original para o painel não ficar com buraco.
    if (!photo.thumbName) {
      return sendStoredFile(res, config.originalsDir, photo.storedName, photo.mime);
    }
    const mime = photo.thumbName.endsWith('.png')
      ? 'image/png'
      : photo.thumbName.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    return sendStoredFile(res, config.thumbsDir, photo.thumbName, mime);
  });

  router.patch('/photos/:id', sameOriginOnly, async (req, res) => {
    if (typeof req.body?.hidden !== 'boolean') {
      return res.status(400).json({ error: 'Informe hidden: true ou false.' });
    }
    const updated = await store.update(req.params.id, { hidden: req.body.hidden });
    if (!updated) return res.status(404).json({ error: 'Foto não encontrada.' });
    return res.json({ id: updated.id, hidden: updated.hidden, stats: store.stats() });
  });

  router.delete('/photos/:id', sameOriginOnly, async (req, res) => {
    const removed = await store.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Foto não encontrada.' });

    const paths = [
      resolveStored(config.originalsDir, removed.storedName),
      removed.thumbName ? resolveStored(config.thumbsDir, removed.thumbName) : null,
    ];
    await Promise.all(
      paths.filter(Boolean).map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})),
    );

    return res.json({ ok: true, stats: store.stats() });
  });

  router.get('/download', (req, res) => {
    const includeHidden = req.query.includeHidden === '1';
    const photos = store.list({ includeHidden });

    if (photos.length === 0) {
      return res.status(404).json({ error: 'Nenhuma foto para baixar ainda.' });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="fotos-casamento-${stamp}.zip"`);

    // Fotos já são formatos comprimidos: compactar de novo só gasta CPU.
    const archive = archiver('zip', { zlib: { level: 0 } });
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    archive.on('error', () => res.destroy());
    // Se os noivos fecharem a aba no meio do download, paramos de ler o disco.
    res.on('close', () => archive.destroy());
    archive.pipe(res);

    const notes = [`Fotos do casamento — ${config.couple.names}`, ''];
    photos.forEach((photo, index) => {
      const filePath = resolveStored(config.originalsDir, photo.storedName);
      if (!filePath) return;
      const entryName = zipEntryName(photo, index);
      archive.file(filePath, { name: entryName });

      const who = photo.guestName || 'Convidado sem nome';
      const when = new Date(photo.uploadedAt).toLocaleString('pt-BR');
      notes.push(`${entryName}  —  ${who}  —  ${when}`);
      if (photo.message) notes.push(`    "${photo.message}"`);
    });

    archive.append(`${notes.join('\n')}\n`, { name: 'recados.txt' });
    return archive.finalize();
  });

  return router;
}
