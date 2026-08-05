import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE_NAME = 'noivos_sessao';

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

/** Compara sem vazar o tamanho do prefixo correto pelo tempo de resposta. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function checkPassword(candidate) {
  return safeEqual(candidate ?? '', config.adminPassword);
}

function createToken() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + config.sessionHours * 3600_000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookies(header = '') {
  const jar = Object.create(null);
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

function isSecureRequest(req) {
  return req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
}

export function startSession(req, res) {
  const maxAge = config.sessionHours * 3600;
  const attributes = [
    `${COOKIE_NAME}=${createToken()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(req)) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export function endSession(req, res) {
  const attributes = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isSecureRequest(req)) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export function isAuthenticated(req) {
  return verifyToken(parseCookies(req.get('cookie'))[COOKIE_NAME]);
}

/** Rotas de API: o cliente trata o 401 mostrando a tela de senha. */
export function requireAdmin(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.status(401).json({ error: 'Sessão expirada. Entre novamente no painel.' });
}

/** Páginas HTML do painel: quem não tem sessão vai para o login. */
export function requireAdminPage(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.redirect('/painel');
}

/**
 * Defesa contra CSRF para as ações do painel. O cookie é SameSite=Strict, o que
 * já barra o caso comum; a checagem de origem cobre clientes antigos.
 */
export function sameOriginOnly(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next(); // Sem Origin não há navegador cross-site envolvido.
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: 'Origem inválida.' });
  }
  if (host !== req.get('host')) return res.status(403).json({ error: 'Origem não autorizada.' });
  return next();
}
