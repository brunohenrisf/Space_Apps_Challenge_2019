#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
 * NEXO — central de automação, contrato v1
 *
 * A central é um BFF: fala o contrato v1 com o cliente e um dialeto de
 * backend com quem tem o rádio. O cliente nunca sabe qual backend está
 * atrás — hoje Zigbee2MQTT, amanhã Home Assistant, sem que o PWA mude.
 *
 *   node server/nexo.mjs
 *   NEXO_ADAPTADOR=simulador node server/nexo.mjs    # sem hub nenhum
 *
 * Dependências: mqtt e ws, ambas em JS puro. Num Pi de cliente, cada
 * pacote que compila é uma instalação que pode travar.
 * ───────────────────────────────────────────────────────────────────── */
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { uuidDe, novoUuid, agora } from './lib/contrato/modelo.mjs';
import { Auth } from './lib/contrato/auth.mjs';
import { criarRest } from './lib/contrato/rest.mjs';
import { criarStream } from './lib/contrato/stream.mjs';
import { AdaptadorZigbee2Mqtt } from './lib/adaptadores/zigbee2mqtt.mjs';
import { AdaptadorSimulador } from './lib/adaptadores/simulador.mjs';
import { Historico, tipoDeDia } from './lib/historico.mjs';
import { sugerir } from './lib/aprendiz.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leJson = p => JSON.parse(readFileSync(p, 'utf8'));

const cfgArq = process.env.NEXO_CONFIG || join(RAIZ, 'server', 'config.json');
const cfg = Object.assign({
  porta: 8080,
  adaptador: process.env.NEXO_ADAPTADOR || 'zigbee2mqtt',
  app: join(RAIZ, 'app'),
  casa: join(RAIZ, 'casa', 'casa.json'),
  dados: join(RAIZ, 'server', 'dados'),
  mqtt: { url: 'mqtt://127.0.0.1:1883', base: 'zigbee2mqtt', usuario: null, senha: null }
}, existsSync(cfgArq) ? leJson(cfgArq) : {});
if (process.env.NEXO_ADAPTADOR) cfg.adaptador = process.env.NEXO_ADAPTADOR;

const casa = leJson(cfg.casa);
mkdirSync(cfg.dados, { recursive: true });

const auth = new Auth(cfg.dados);
const historico = new Historico(join(cfg.dados, 'historico'));

/* ═══════════════════════════════════════════════════════════════
   CENTRAL
   ═══════════════════════════════════════════════════════════════ */
const areas = casa.areas.map(a => ({
  id: uuidDe('area', a.key), key: a.key, name: a.name, icon: a.icon, order: a.order
}));

let modoAtual = 'normal';
let automacoes = structuredClone(casa.automations || []);
let sugestoes = [];
const recusadas = new Set();
const favoritos = {};
const ultimoEvento = new Map();      // deviceId:capId → { event, ts }

let stream, adaptador;

/* ── Ponte adaptador → central ────────────────────────────────── */
const bus = {
  hub: online => { hubOnline = online; },

  estado(deviceId, capabilityId, changes) {
    stream?.estadoMudou(deviceId, capabilityId, changes);
    registrarHistorico(deviceId, capabilityId, changes);
    avaliarGatilhoDeEvento(deviceId, capabilityId, changes);
  },

  alcance: (deviceId, reachability) => stream?.alcance(deviceId, reachability),

  evento(deviceId, capabilityId, event) {
    ultimoEvento.set(`${deviceId}:${capabilityId}`, { event, ts: agora() });
    stream?.eventoDe(deviceId, capabilityId, event);
  },

  adicionado: device => stream?.adicionado(device),
  removido:   deviceId => stream?.removido(deviceId),

  resultado(commandId, status, error) {
    stream?.resultado(commandId, status, error);
    const p = pendentes.get(commandId);
    if (!p) return;
    pendentes.delete(commandId);
    // Só o que de fato pegou vira histórico. Comando que falhou no rádio
    // não é hábito da família — contá-lo ensinaria o aprendiz errado.
    if (status === 'applied') historico.registrar({
      id: p.deviceId, cap: p.capabilityId, acao: acaoDe(p.comando),
      valor: p.comando, modo: modoAtual, origem: p.origem,
      ...(p.rotina ? { rotina: p.rotina } : {})
    });
  }
};

let hubOnline = false;
const pendentes = new Map();   // commandId → { deviceId, capabilityId, comando, origem }

const acaoDe = c =>
  c.type === 'switch' ? (c.toggle ? 'toggle' : c.state ? 'on' : 'off')
  : c.type === 'lock' ? c.state
  : c.type;

const central = {
  home: () => ({
    id: auth.homeId, name: auth.homeName || casa.home.name,
    timezone: casa.home.timezone,
    areas: areas.map(({ id, name, icon, order }) => ({ id, name, icon, order }))
  }),

  devices: () => adaptador.devices().map(enfeitar),
  device: id => { const d = adaptador.devices().find(x => x.id === id); return d ? enfeitar(d) : null; },

  comandar(deviceId, capabilityId, comando, commandId, origem = 'manual', rotina = null) {
    pendentes.set(commandId, { deviceId, capabilityId, comando, origem, rotina });
    const ok = adaptador.comandar(deviceId, capabilityId, comando, commandId);
    if (!ok) pendentes.delete(commandId);
    return ok;
  },

  renomear(id, { name, areaId }) {
    const d = adaptador.devices().find(x => x.id === id);
    if (!d) return null;
    if (typeof name === 'string' && name.trim()) d.name = name.trim();
    if (areaId !== undefined) d.areaId = areaId;
    return enfeitar(d);
  },

  remover: id => adaptador.remover(id),

  favoritar(id, valor){
    if (!adaptador.devices().some(d => d.id === id)) return false;
    favoritos[id] = valor;
    return true;
  },

  parear: seg => adaptador.parear(seg),
  pararPareamento: () => adaptador.pararPareamento(),

  criarArea({ name, icon }) {
    const a = { id: novoUuid(), key: null, name: name || 'Novo cômodo', icon,
                order: areas.length + 1 };
    areas.push(a);
    return { id: a.id, name: a.name, icon: a.icon, order: a.order };
  },
  editarArea(id, patch) {
    const a = areas.find(x => x.id === id); if (!a) return null;
    if (patch.name) a.name = patch.name;
    if (patch.icon !== undefined) a.icon = patch.icon;
    if (Number.isFinite(patch.order)) a.order = patch.order;
    return { id: a.id, name: a.name, icon: a.icon, order: a.order };
  },
  apagarArea(id) {
    const i = areas.findIndex(x => x.id === id); if (i < 0) return false;
    areas.splice(i, 1);
    for (const d of adaptador.devices()) if (d.areaId === id) d.areaId = null;
    return true;
  },

  historico: (deviceId, capabilityId, opcoes) =>
    serieHistorica(deviceId, capabilityId, opcoes),

  /* ── Extensões (§9) ───────────────────────────────────────────── */
  cenas: () => (casa.scenes || []).map(({ id, name, icon, steps }) =>
    ({ id, name, icon, deviceCount: new Set(steps.map(s => s.device)).size })),

  ativarCena(cenaId, claims) {
    const cena = (casa.scenes || []).find(s => s.id === cenaId);
    if (!cena) return null;
    return { commandIds: executarPassos(cena.steps, 'cena') };
  },

  modos: () => ({ current: modoAtual, available: casa.modes || [] }),

  trocarModo(id) {
    if (!(casa.modes || []).some(m => m.id === id)) return null;
    modoAtual = id;
    historico.registrar({ id: '_casa', acao: 'modo', valor: { modo: id },
                          modo: id, origem: 'manual' });
    stream?.emitir('mode.changed', { mode: id });
    agendarAposModo(id);
    return id;
  },

  automacoes: () => automacoes.map(a => ({ ...a, activeNow: a.on && valeNoModo(a) })),

  editarAutomacao(id, patch) {
    const a = automacoes.find(x => x.id === id); if (!a) return null;
    if (typeof patch.on === 'boolean') a.on = patch.on;
    if (patch.name) a.name = patch.name;
    if (Array.isArray(patch.modos)) a.modos = patch.modos;
    stream?.emitir('automation.changed', { automation: a });
    return a;
  },

  sugestoes: () => sugestoes,

  decidirSugestao(id, decisao) {
    const g = sugestoes.find(s => s.id === id); if (!g) return false;
    if (decisao === 'aceitar') {
      if (g.tipo === 'recuar') {
        const alvo = automacoes.find(a => a.id === g.alvo);
        if (alvo) alvo.on = false;
        recusadas.add(g.id);
      } else {
        automacoes.push({ id: 'auto_' + Date.now().toString(36), on: true,
          supervisionada: true, name: g.rotina.nome, desc: g.rotina.desc,
          icon: g.rotina.icon, modos: g.rotina.modos, gatilho: g.rotina.gatilho,
          steps: g.rotina.steps || [] });
      }
    } else if (decisao === 'nunca') recusadas.add(g.id);

    sugestoes = sugestoes.filter(s => s.id !== id);
    stream?.emitir('suggestions.changed', { suggestions: sugestoes });
    stream?.emitir('automation.changed', { automations: central.automacoes() });
    return true;
  }
};

/** Anexa o que é da central, não do backend: favorito e último evento. */
function enfeitar(d) {
  const nativo = Object.entries(casa.devices || {}).find(([, v]) => v.name === d.name)?.[0];
  const fav = favoritos[d.id] ?? (nativo ? !!casa.devices[nativo].favorito : false);
  const caps = d.capabilities.map(c => {
    if (c.type !== 'event') return c;
    const u = ultimoEvento.get(`${d.id}:${c.id}`);
    return u ? { ...c, lastEvent: u.event, lastEventAt: u.ts } : c;
  });
  return { ...d, capabilities: caps, favorite: fav };
}

/* ── Passos de cena e automação ───────────────────────────────── */
/* Passo escrito à mão fala em chave nativa ("luz-sala-teto"); passo que a
 * casa gerou já nasce com o UUID. Aceitar os dois evita obrigar o aprendiz
 * a inventar um nome nativo que pode nem existir depois de um repareamento. */
function executarPassos(steps, origem, rotina = null) {
  const ids = [];
  for (const s of steps) {
    const deviceId = s.deviceId || adaptador.uuidDoNativo(s.device);
    if (!deviceId) continue;
    const commandId = novoUuid();
    if (central.comandar(deviceId, s.capability, s.command, commandId, origem, rotina))
      ids.push(commandId);
  }
  return ids;
}

/* ── Motor de automações ──────────────────────────────────────── */
const valeNoModo = a => !a.modos || a.modos.includes(modoAtual);

function executarAutomacao(a) {
  console.log('[automação]', a.name);
  executarPassos(a.steps || [], 'rotina', a.id);
  historico.registrar({ id: '_casa', acao: 'automacao', valor: { id: a.id },
                        modo: modoAtual, origem: 'rotina', rotina: a.id });
}

setInterval(() => {
  const d = new Date();
  const minuto = d.getHours() * 60 + d.getMinutes();
  const tipo = tipoDeDia(Date.now());
  const hoje = d.toDateString();

  for (const a of automacoes) {
    if (!a.on || !valeNoModo(a)) continue;
    const g = a.gatilho;
    if (g?.tipo !== 'hora' || minuto !== g.minuto) continue;
    if (g.dias && g.dias !== 'todos' && g.dias !== tipo) continue;
    if (a.disparouEm === hoje) continue;    // NTP pode voltar o relógio
    a.disparouEm = hoje;
    executarAutomacao(a);
  }
}, 30_000).unref?.();

const agendados = new Set();
function agendarAposModo(modo) {
  for (const t of agendados) clearTimeout(t);
  agendados.clear();
  for (const a of automacoes) {
    const g = a.gatilho;
    if (!a.on || g?.tipo !== 'apos-modo' || g.modo !== modo) continue;
    const t = setTimeout(() => { if (modoAtual === modo && a.on) executarAutomacao(a); },
                         g.minutos * 60e3);
    agendados.add(t);
  }
}

function avaliarGatilhoDeEvento(deviceId, capabilityId, changes) {
  if (typeof changes.state !== 'boolean' || changes.state !== true) return;
  for (const a of automacoes) {
    if (!a.on || !valeNoModo(a)) continue;
    const g = a.gatilho;
    if (g?.tipo !== 'evento' || g.capability !== capabilityId) continue;
    if (adaptador.uuidDoNativo(g.device) !== deviceId) continue;
    executarAutomacao(a);
  }
}

/* ── Histórico e séries (§5.5) ────────────────────────────────── */
function registrarHistorico(deviceId, capabilityId, changes) {
  const v = changes.value ?? changes.currentTemp;
  if (Number.isFinite(v)) historico.registrar({ id: deviceId, cap: capabilityId,
    acao: 'medida', valor: { v }, modo: modoAtual, origem: 'sensor' });
}

const BALDE = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '1d': 864e5 };

function serieHistorica(deviceId, capabilityId, { from, to, bucket = '1h' } = {}) {
  const passo = BALDE[bucket] || BALDE['1h'];
  const fim   = to ? Date.parse(to) : Date.now();
  const ini   = from ? Date.parse(from) : fim - 24 * 3600e3;
  const dias  = Math.ceil((Date.now() - ini) / 864e5) + 1;

  const pontos = historico.desde(dias, e =>
    e.id === deviceId && e.cap === capabilityId && e.ts >= ini && e.ts <= fim &&
    Number.isFinite(e.valor?.v));

  // Média por balde. Nas séries de energia, o cliente quer a tendência —
  // amostra crua de 5 s em 5 s afogaria o gráfico e a rede.
  const baldes = new Map();
  for (const p of pontos) {
    const k = Math.floor(p.ts / passo) * passo;
    const b = baldes.get(k) || { soma: 0, n: 0 };
    b.soma += p.valor.v; b.n++;
    baldes.set(k, b);
  }
  return [...baldes.entries()].sort((a, b) => a[0] - b[0])
    .map(([k, b]) => ({ t: new Date(k).toISOString(), v: +(b.soma / b.n).toFixed(3) }));
}

/* ── Aprendiz ─────────────────────────────────────────────────── */
function recalcularSugestoes() {
  const catalogo = { devices: central.devices().map(d => ({
    id: d.id, name: d.name,
    caps: d.capabilities.map(c => c.type),
    switchCap: d.capabilities.find(c => c.type === 'switch')?.id || null,
    dimmerCap: d.capabilities.find(c => c.type === 'dimmer')?.id || null,
    ctCap:     d.capabilities.find(c => c.type === 'color_temp')?.id || null
  })) };
  sugestoes = sugerir({ historico, catalogo, rotinas: automacoes, recusadas });
  console.log(`[aprendiz] ${historico.tamanho} eventos, ${sugestoes.length} sugestões`);
  stream?.emitir('suggestions.changed', { suggestions: sugestoes });
}
setInterval(recalcularSugestoes, 3600_000).unref?.();

/* ═══════════════════════════════════════════════════════════════
   HTTP: estáticos + REST + stream
   ═══════════════════════════════════════════════════════════════ */
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8', '.png':'image/png',
  '.svg':'image/svg+xml', '.ico':'image/x-icon' };

const rest = criarRest({ auth, central });

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (await rest(req, res, url)) return;

  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/' || rel === '\\') rel = '/index.html';
  const alvo = join(cfg.app, rel);
  if (!alvo.startsWith(cfg.app)) { res.writeHead(403); return res.end(); }

  const tipo = MIME[extname(alvo)] || 'application/octet-stream';
  const aceitaGz = (req.headers['accept-encoding'] || '').includes('gzip');

  for (const [caminho, gz] of [[alvo + '.gz', true], [alvo, false]]) {
    if (gz && !aceitaGz) continue;
    if (!existsSync(caminho) || !statSync(caminho).isFile()) continue;
    const cab = { 'content-type': tipo, 'cache-control': 'no-cache' };
    if (gz) cab['content-encoding'] = 'gzip';
    res.writeHead(200, cab);
    return res.end(readFileSync(caminho));
  }

  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not_found', message: 'Recurso não encontrado.' }));
});

stream = criarStream({ servidor, auth });

/* ═══════════════════════════════════════════════════════════════
   PARTIDA
   ═══════════════════════════════════════════════════════════════ */
adaptador = cfg.adaptador === 'simulador'
  ? new AdaptadorSimulador({ casa, bus })
  : new AdaptadorZigbee2Mqtt({ mqtt: cfg.mqtt, casa, bus });

adaptador.iniciar();
recalcularSugestoes();
agendarAposModo(modoAtual);

servidor.listen(cfg.porta, () => {
  console.log(`[http] contrato v1 em http://0.0.0.0:${cfg.porta}/api/v1`);
  console.log(`[central] adaptador ${adaptador.nome}, ${areas.length} cômodos`);
  console.log(auth.virgem
    ? '[setup] central virgem — o primeiro POST /api/v1/setup/claim cria o dono'
    : `[setup] casa "${auth.homeName}" já reivindicada`);
});

for (const sinal of ['SIGTERM', 'SIGINT'])
  process.on(sinal, () => { adaptador.parar?.(); process.exit(0); });
