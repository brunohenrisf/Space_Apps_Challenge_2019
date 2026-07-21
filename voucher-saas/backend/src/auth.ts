// Autenticação do painel do organizador — sem dependências extras (só crypto).
// Senha: scrypt (salt:hash). Sessão: token compacto assinado com HMAC-SHA256.
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from './config';
import * as store from './store';

// ---------- Senha (scrypt) ----------
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ---------- Token (HMAC) ----------
const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hmac = (data: string) =>
  b64url(crypto.createHmac('sha256', config.authSecret).update(data).digest());

export function signToken(payload: { sub: string; org: string }, ttlSec = 86400): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const data = b64url(Buffer.from(JSON.stringify(body)));
  return `${data}.${hmac(data)}`;
}
export function verifyToken(token: string): { sub: string; org: string; exp: number } | null {
  const [data, sig] = (token || '').split('.');
  if (!data || !sig) return null;
  const expected = hmac(data);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const body = JSON.parse(Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

// ---------- Middleware ----------
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'não autenticado' });
  (req as any).adminEmail = payload.sub;
  (req as any).organizerId = payload.org;
  next();
}

// ---------- Seed do admin inicial ----------
export async function ensureAdmin(organizerId: string): Promise<void> {
  if ((await store.countAdmins()) > 0) return;
  const email = config.adminEmail.toLowerCase().trim();
  await store.createAdmin(email, hashPassword(config.adminPassword), organizerId);
  console.log(`[auth] admin inicial criado: ${email}`);
  if (config.authSecret === 'dev-inseguro-troque-em-producao') {
    console.warn('[auth] AUTH_SECRET não definido — usando segredo de DEV. Defina em produção!');
  }
}
