import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Node >= 20.12 lê o .env sem nenhuma dependência externa.
try {
  process.loadEnvFile(path.join(rootDir, '.env'));
} catch {
  // Sem arquivo .env: seguimos apenas com as variáveis já presentes no ambiente.
}

function readInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function readText(value, fallback) {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? fallback : trimmed;
}

export const warnings = [];

const port = readInt(process.env.PORT, 3000, { min: 1, max: 65535 });

let adminPassword = readText(process.env.ADMIN_PASSWORD, '');
if (adminPassword === '') {
  adminPassword = crypto.randomBytes(9).toString('base64url');
  warnings.push(
    `ADMIN_PASSWORD não definida. Senha temporária deste boot: ${adminPassword}\n` +
      '   Defina ADMIN_PASSWORD no .env para ter uma senha fixa.',
  );
}

let sessionSecret = readText(process.env.SESSION_SECRET, '');
if (sessionSecret === '') {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  warnings.push(
    'SESSION_SECRET não definida. Uma chave aleatória foi gerada para este boot,\n' +
      '   então o painel dos noivos exige novo login a cada reinício do servidor.',
  );
}

// Configuráveis para apontar a um volume montado (ou a um diretório temporário nos testes).
const dataDir = path.resolve(rootDir, readText(process.env.DATA_DIR, 'data'));
const uploadsDir = path.resolve(rootDir, readText(process.env.UPLOADS_DIR, 'uploads'));

export const config = {
  rootDir,
  port,
  publicUrl: readText(process.env.PUBLIC_URL, `http://localhost:${port}`).replace(/\/+$/, ''),
  trustProxy: readText(process.env.TRUST_PROXY, 'false') === 'true',

  couple: {
    names: readText(process.env.COUPLE_NAMES, 'Os noivos'),
    date: readText(process.env.EVENT_DATE, ''),
    hashtag: readText(process.env.EVENT_HASHTAG, ''),
    welcome: readText(
      process.env.WELCOME_MESSAGE,
      'Você guardou um momento nosso na sua câmera. Manda pra gente?',
    ),
  },

  adminPassword,
  sessionSecret,
  sessionHours: readInt(process.env.SESSION_HOURS, 12, { min: 1, max: 720 }),

  dataDir,
  dataFile: path.join(dataDir, 'photos.json'),
  uploadsDir,
  originalsDir: path.join(uploadsDir, 'originals'),
  thumbsDir: path.join(uploadsDir, 'thumbs'),
  tmpDir: path.join(uploadsDir, 'tmp'),

  maxFileSizeBytes: readInt(process.env.MAX_FILE_SIZE_MB, 30, { min: 1, max: 200 }) * 1024 * 1024,
  maxThumbBytes: 2 * 1024 * 1024,
  maxGuestNameLength: 60,
  maxMessageLength: 400,

  // Janelas de rate limit (protegem a URL pública, que fica exposta no QR Code).
  uploadLimit: { windowMs: 60_000, max: readInt(process.env.UPLOAD_RATE_LIMIT, 40, { min: 1 }) },
  loginLimit: { windowMs: 15 * 60_000, max: readInt(process.env.LOGIN_RATE_LIMIT, 10, { min: 1 }) },
};

export function ensureDirectories() {
  for (const dir of [
    config.dataDir,
    config.uploadsDir,
    config.originalsDir,
    config.thumbsDir,
    config.tmpDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
