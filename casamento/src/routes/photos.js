import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { detectImageType } from '../imageType.js';
import { rateLimit } from '../rateLimit.js';

const THUMB_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Troca caracteres de controle por espaco, colapsa espacos e limita o tamanho. */
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Guarda só o nome do arquivo, sem caminho, para exibir e nomear no .zip. */
function cleanFileName(value) {
  const base = path.basename(String(value ?? '')).replace(/[^\w.\- ]+/g, '_').trim();
  return base.slice(0, 120) || 'foto';
}

async function readHeader(filePath, bytes = 32) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function discard(...filePaths) {
  await Promise.all(
    filePaths.filter(Boolean).map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})),
  );
}

export function createPhotosRouter(store) {
  const router = Router();

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.tmpDir,
      filename: (_req, _file, done) => done(null, `${crypto.randomUUID()}.part`),
    }),
    limits: {
      fileSize: config.maxFileSizeBytes,
      files: 2,
      fields: 8,
    },
  }).fields([
    { name: 'photo', maxCount: 1 },
    { name: 'thumb', maxCount: 1 },
  ]);

  const limiter = rateLimit({
    ...config.uploadLimit,
    message: 'Muitas fotos enviadas de uma vez. Espere um minutinho e tente de novo.',
  });

  router.post('/fotos', limiter, (req, res, next) => {
    upload(req, res, (error) => {
      if (!error) return handleUpload(req, res, next);
      if (error.code === 'LIMIT_FILE_SIZE') {
        const limitMb = Math.round(config.maxFileSizeBytes / (1024 * 1024));
        return res.status(413).json({ error: `Cada foto pode ter no máximo ${limitMb} MB.` });
      }
      return res.status(400).json({ error: 'Não consegui ler o arquivo enviado.' });
    });
  });

  async function handleUpload(req, res, next) {
    const original = req.files?.photo?.[0];
    const thumbnail = req.files?.thumb?.[0];

    if (!original) {
      await discard(thumbnail?.path);
      return res.status(400).json({ error: 'Nenhuma foto foi enviada.' });
    }

    try {
      const type = detectImageType(await readHeader(original.path));
      if (!type) {
        await discard(original.path, thumbnail?.path);
        return res
          .status(415)
          .json({ error: 'Esse arquivo não parece uma foto. Envie JPG, PNG, HEIC, WEBP, AVIF ou GIF.' });
      }

      const id = crypto.randomUUID();
      const storedName = `${id}${type.ext}`;
      await fs.rename(original.path, path.join(config.originalsDir, storedName));

      // A miniatura é gerada no navegador do convidado. Se vier quebrada,
      // ausente ou grande demais, seguimos sem ela — o painel cai para a
      // imagem original nesse caso.
      let thumbName = null;
      if (thumbnail) {
        const thumbType = detectImageType(await readHeader(thumbnail.path));
        if (thumbType && THUMB_TYPES.has(thumbType.mime) && thumbnail.size <= config.maxThumbBytes) {
          thumbName = `${id}${thumbType.ext}`;
          await fs.rename(thumbnail.path, path.join(config.thumbsDir, thumbName));
        } else {
          await discard(thumbnail.path);
        }
      }

      const photo = {
        id,
        originalName: cleanFileName(original.originalname),
        storedName,
        thumbName,
        mime: type.mime,
        size: original.size,
        guestName: cleanText(req.body?.guestName, config.maxGuestNameLength),
        message: cleanText(req.body?.message, config.maxMessageLength),
        uploadedAt: new Date().toISOString(),
        hidden: false,
      };

      await store.add(photo);
      return res.status(201).json({ id: photo.id, uploadedAt: photo.uploadedAt });
    } catch (error) {
      await discard(original.path, thumbnail?.path);
      return next(error);
    }
  }

  return router;
}

/**
 * Envios interrompidos (convidado saiu do ar no meio do upload) deixam restos
 * em uploads/tmp. Varremos na inicialização e de hora em hora.
 */
export function startTmpCleanup(maxAgeMs = 3600_000) {
  const sweep = async () => {
    try {
      const entries = await fs.readdir(config.tmpDir);
      const cutoff = Date.now() - maxAgeMs;
      await Promise.all(
        entries.map(async (entry) => {
          const filePath = path.join(config.tmpDir, entry);
          const stats = await fs.stat(filePath).catch(() => null);
          if (stats && stats.mtimeMs < cutoff) await discard(filePath);
        }),
      );
    } catch {
      // Limpeza é oportunista: falhar aqui não pode derrubar o servidor.
    }
  };

  sweep();
  const timer = setInterval(sweep, maxAgeMs);
  timer.unref();
  return timer;
}
