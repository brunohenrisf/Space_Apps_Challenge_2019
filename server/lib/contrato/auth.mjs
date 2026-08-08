/**
 * Autenticação do contrato v1 (§3 e §4).
 *
 * Access token JWT EdDSA de 15 min, refresh opaco de 60 dias que rotaciona
 * a cada uso. Sem dependência: Ed25519 e scrypt saem do node:crypto — num
 * Pi de cliente, cada pacote que compila é um risco de instalação travada.
 *
 * A chave é gerada no primeiro boot e fica só no disco da central. Cada
 * central é sua própria autoridade: não há segredo compartilhado entre
 * instalações, então vazar uma casa não vaza nenhuma outra.
 */
import {
  generateKeyPairSync, sign, verify, randomBytes,
  scryptSync, timingSafeEqual, createHash
} from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { novoUuid, agora } from './modelo.mjs';

const ACCESS_TTL  = 15 * 60;             // segundos
const REFRESH_TTL = 60 * 24 * 3600e3;    // ms

const b64u  = b => Buffer.from(b).toString('base64url');
const deB64 = s => Buffer.from(s, 'base64url');
const hash  = s => createHash('sha256').update(s).digest('hex');

export class Auth {
  #arq; #dados; #priv; #pub;

  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.#arq = join(dir, 'auth.json');
    this.#dados = existsSync(this.#arq)
      ? JSON.parse(readFileSync(this.#arq, 'utf8'))
      : { chave: null, usuarios: [], refresh: {}, convites: {}, homeId: novoUuid() };

    if (!this.#dados.chave) {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      this.#dados.chave = {
        priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        pub:  publicKey.export({ type: 'spki',  format: 'pem' })
      };
      this.#salvar();
    }
    this.#priv = this.#dados.chave.priv;
    this.#pub  = this.#dados.chave.pub;
  }

  #salvar() {
    writeFileSync(this.#arq, JSON.stringify(this.#dados, null, 2));
    try { chmodSync(this.#arq, 0o600); } catch (_) { }
  }

  get homeId()   { return this.#dados.homeId; }
  /** setup=1 enquanto ninguém reivindicou a central (§4). */
  get virgem()   { return this.#dados.usuarios.length === 0; }

  /* ── Senhas ───────────────────────────────────────────────────── */
  #hashSenha(senha, sal = randomBytes(16).toString('hex')) {
    return { sal, hash: scryptSync(senha, sal, 64).toString('hex') };
  }
  #conferirSenha(senha, u) {
    const a = scryptSync(senha, u.sal, 64);
    const b = Buffer.from(u.hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /* ── JWT EdDSA ────────────────────────────────────────────────── */
  #emitirAccess(u) {
    const cab = b64u(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
    const iat = Math.floor(Date.now() / 1000);
    const corpo = b64u(JSON.stringify({
      sub: u.id, home: this.#dados.homeId, role: u.role, iat, exp: iat + ACCESS_TTL
    }));
    const assinatura = b64u(sign(null, Buffer.from(`${cab}.${corpo}`), this.#priv));
    return `${cab}.${corpo}.${assinatura}`;
  }

  /** Devolve os claims ou null. Nunca lança — entrada hostil é rotina aqui. */
  verificarAccess(token) {
    try {
      const [cab, corpo, ass] = String(token).split('.');
      if (!cab || !corpo || !ass) return null;
      if (JSON.parse(deB64(cab)).alg !== 'EdDSA') return null;   // nada de alg:none
      if (!verify(null, Buffer.from(`${cab}.${corpo}`), this.#pub, deB64(ass))) return null;

      const claims = JSON.parse(deB64(corpo));
      if (claims.exp * 1000 < Date.now()) return null;
      if (claims.home !== this.#dados.homeId) return null;

      const u = this.#dados.usuarios.find(x => x.id === claims.sub);
      if (!u) return null;
      return { ...claims, allowedDeviceIds: u.allowedDeviceIds || null };
    } catch (_) { return null; }
  }

  /* ── Refresh rotativo com detecção de reuso ───────────────────── */
  #emitirPar(u) {
    const bruto = randomBytes(32).toString('base64url');
    const familia = randomBytes(8).toString('hex');
    this.#dados.refresh[hash(bruto)] = {
      familia, userId: u.id, expiraEm: Date.now() + REFRESH_TTL, consumido: false
    };
    this.#salvar();
    return { accessToken: this.#emitirAccess(u), refreshToken: bruto, expiresIn: ACCESS_TTL };
  }

  #rotacionar(u, familia) {
    const bruto = randomBytes(32).toString('base64url');
    this.#dados.refresh[hash(bruto)] = {
      familia, userId: u.id, expiraEm: Date.now() + REFRESH_TTL, consumido: false
    };
    return bruto;
  }

  renovar(refreshToken) {
    const chave = hash(String(refreshToken));
    const reg = this.#dados.refresh[chave];
    if (!reg || reg.expiraEm < Date.now()) return null;

    // Refresh já usado voltando = ou o token vazou, ou dois clientes estão
    // com a mesma cópia. Nos dois casos a resposta certa é derrubar a
    // família inteira e obrigar login — não dá para distinguir, e errar
    // para o lado permissivo é errar para o lado do invasor.
    if (reg.consumido) {
      for (const [k, v] of Object.entries(this.#dados.refresh))
        if (v.familia === reg.familia) delete this.#dados.refresh[k];
      this.#salvar();
      console.warn('[auth] refresh reutilizado — família', reg.familia, 'invalidada');
      return null;
    }

    const u = this.#dados.usuarios.find(x => x.id === reg.userId);
    if (!u) return null;

    reg.consumido = true;
    const novo = this.#rotacionar(u, reg.familia);
    this.#salvar();
    return { accessToken: this.#emitirAccess(u), refreshToken: novo, expiresIn: ACCESS_TTL };
  }

  sair(refreshToken) {
    const reg = this.#dados.refresh[hash(String(refreshToken))];
    if (reg) {
      for (const [k, v] of Object.entries(this.#dados.refresh))
        if (v.familia === reg.familia) delete this.#dados.refresh[k];
      this.#salvar();
    }
  }

  /* ── Ciclo de vida de usuários ────────────────────────────────── */

  /** §4.1 — aceito uma única vez. Depois disso, sempre 409. */
  reivindicar({ name, email, password, homeName }) {
    if (!this.virgem) return { erro: 'already_claimed' };
    if (!email || !password || password.length < 8)
      return { erro: 'invalid_payload', msg: 'A senha precisa de ao menos 8 caracteres.' };

    const u = { id: novoUuid(), name, email: String(email).toLowerCase(), role: 'owner',
                criadoEm: agora(), ...this.#hashSenha(password) };
    this.#dados.usuarios.push(u);
    this.#dados.homeName = homeName || 'Casa';
    this.#salvar();
    return { par: this.#emitirPar(u), homeName: this.#dados.homeName };
  }

  entrar(email, senha) {
    const u = this.#dados.usuarios.find(x => x.email === String(email || '').toLowerCase());
    if (!u || !this.#conferirSenha(String(senha || ''), u)) return null;
    return this.#emitirPar(u);
  }

  criarConvite({ role = 'member', allowedDeviceIds = null, validoPorHoras = 24 }) {
    const code = randomBytes(4).toString('hex').toUpperCase();
    this.#dados.convites[code] = {
      role, allowedDeviceIds, expiresAt: new Date(Date.now() + validoPorHoras * 3600e3).toISOString()
    };
    this.#salvar();
    return { code, expiresAt: this.#dados.convites[code].expiresAt };
  }

  resgatar({ code, name, email, password }) {
    const c = this.#dados.convites[String(code || '').toUpperCase()];
    if (!c) return { erro: 'invalid_code' };
    if (new Date(c.expiresAt) < new Date()) {
      delete this.#dados.convites[code]; this.#salvar();
      return { erro: 'expired_code' };
    }
    if (!password || password.length < 8)
      return { erro: 'invalid_payload', msg: 'A senha precisa de ao menos 8 caracteres.' };

    const u = { id: novoUuid(), name, email: String(email).toLowerCase(), role: c.role,
                allowedDeviceIds: c.allowedDeviceIds, criadoEm: agora(),
                ...this.#hashSenha(password) };
    this.#dados.usuarios.push(u);
    delete this.#dados.convites[String(code).toUpperCase()];
    this.#salvar();
    return { par: this.#emitirPar(u) };
  }

  usuarios() {
    return this.#dados.usuarios.map(({ id, name, email, role, criadoEm }) =>
      ({ id, name, email, role, criadoEm }));
  }

  get homeName() { return this.#dados.homeName || 'Casa'; }

  /**
   * Reset de fábrica (§4.1): apaga usuários e sessões, preserva o
   * pareamento dos dispositivos. Não é exposto por API de propósito —
   * só quem tem acesso físico ao botão da central chega aqui.
   */
  resetFisico() {
    this.#dados.usuarios = [];
    this.#dados.refresh = {};
    this.#dados.convites = {};
    this.#salvar();
  }
}

/* ── Permissões (§3.2) ───────────────────────────────────────────── */

export const PODE = Object.freeze({
  controlar:      ['owner', 'member', 'guest'],
  verHistorico:   ['owner', 'member'],
  editarAutomacao:['owner', 'member'],
  gerenciarUsuarios: ['owner']
});

export const podeFazer = (claims, acao) => !!claims && PODE[acao]?.includes(claims.role);

/**
 * O convidado só enxerga o que lhe foi liberado — e a filtragem é aqui,
 * no servidor. Filtrar só na tela deixaria os outros dispositivos a um
 * curl de distância.
 */
export const podeVerDevice = (claims, deviceId) =>
  !claims?.allowedDeviceIds || claims.allowedDeviceIds.includes(deviceId);

export const filtrarDevices = (claims, devices) =>
  claims?.allowedDeviceIds ? devices.filter(d => claims.allowedDeviceIds.includes(d.id)) : devices;
