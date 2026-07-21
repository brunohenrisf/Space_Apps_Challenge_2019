import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword, signToken, verifyToken } from '../src/auth';
import { minutesToRouterOS, toRouterOSInterval } from '../src/services/mikrotik';
import { efiCredsFromAccount, isEfiConfigured } from '../src/services/efi';

test('senha: hash/verify (scrypt)', () => {
  const h = hashPassword('segredo123');
  assert.ok(h.includes(':'));
  assert.equal(verifyPassword('segredo123', h), true);
  assert.equal(verifyPassword('errada', h), false);
  assert.equal(verifyPassword('segredo123', 'lixo'), false);
});

test('token: assina e valida; rejeita adulterado', () => {
  const t = signToken({ sub: 'a@b.com', acc: 'acc1' });
  const p = verifyToken(t);
  assert.equal(p?.sub, 'a@b.com');
  assert.equal(p?.acc, 'acc1');
  assert.equal(verifyToken(t + 'x'), null);
  assert.equal(verifyToken('nada'), null);
});

test('token: expirado é rejeitado', () => {
  const t = signToken({ sub: 'a@b.com', acc: 'acc1' }, -1);
  assert.equal(verifyToken(t), null);
});

test('mikrotik: minutos -> formato RouterOS', () => {
  assert.equal(minutesToRouterOS(60), '1h');
  assert.equal(minutesToRouterOS(180), '3h');
  assert.equal(minutesToRouterOS(1440), '1d');
  assert.equal(minutesToRouterOS(90), '90m');
});

test('mikrotik: minutos -> intervalo do scheduler', () => {
  assert.equal(toRouterOSInterval(3), '00:03:00');
  assert.equal(toRouterOSInterval(180), '03:00:00');
  assert.equal(toRouterOSInterval(1440), '1d00:00:00');
});

test('efi: credenciais mapeadas da conta', () => {
  const creds = efiCredsFromAccount({ efiEnv: 'producao', efiClientId: 'cid', efiClientSecret: 'sec', efiPixKey: 'k', efiWebhookToken: 't' });
  assert.equal(creds.clientId, 'cid');
  assert.equal(creds.clientSecret, 'sec');
  assert.equal(creds.pixKey, 'k');
  assert.equal(creds.env, 'producao');
});

test('efi: isEfiConfigured exige clientId + secret + cert', () => {
  assert.equal(isEfiConfigured({ env: 'producao', clientId: 'c', clientSecret: 's', pixKey: 'k', certPath: '/x/cert.p12', webhookToken: 't' }), true);
  assert.equal(isEfiConfigured({ env: 'producao', clientId: '', clientSecret: 's', pixKey: '', certPath: '/x/cert.p12', webhookToken: '' }), false);
  assert.equal(isEfiConfigured({ env: 'producao', clientId: 'c', clientSecret: 's', pixKey: '', certPath: '', webhookToken: '' }), false);
});
