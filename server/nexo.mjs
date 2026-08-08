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
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { uuidDe, novoUuid, agora } from './lib/contrato/modelo.mjs';
import { Auth } from './lib/contrato/auth.mjs';
import { criarRest } from './lib/contrato/rest.mjs';
import { criarStream } from './lib/contrato/stream.mjs';
import { AdaptadorZigbee2Mqtt } from './lib/adaptadores/zigbee2mqtt.mjs';
import { AdaptadorSimulador } from './lib/adaptadores/simulador.mjs';
import { AdaptadorPonte } from './lib/adaptadores/ponte.mjs';
import { Historico, tipoDeDia } from './lib/historico.mjs';
import { eventoSolar, hhmmSol } from './lib/sol.mjs';
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
// Dentro de um contêiner a configuração vem por ambiente, não por arquivo:
// é o que deixa o mesmo compose replicar em qualquer casa mudando só o .env.
if (process.env.NEXO_ADAPTADOR)    cfg.adaptador     = process.env.NEXO_ADAPTADOR;
if (process.env.NEXO_PORTA)        cfg.porta         = +process.env.NEXO_PORTA;
if (process.env.NEXO_DADOS)        cfg.dados         = process.env.NEXO_DADOS;
if (process.env.NEXO_CASA)         cfg.casa          = process.env.NEXO_CASA;
if (process.env.NEXO_MQTT_URL)     cfg.mqtt.url      = process.env.NEXO_MQTT_URL;
if (process.env.NEXO_MQTT_USUARIO) cfg.mqtt.usuario  = process.env.NEXO_MQTT_USUARIO;
if (process.env.NEXO_MQTT_SENHA)   cfg.mqtt.senha    = process.env.NEXO_MQTT_SENHA;

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

/* Estado que pertence à família — modo, favoritos, apelidos, automações
   criadas pelo aprendiz — sobrevive a reinício e a atualização de imagem.
   Sem isto, cada `docker compose up` apagaria o que a casa aprendeu. */
const persistArq = join(cfg.dados, 'estado.json');

// Um estado.json truncado por queda de energia NÃO pode virar crash-loop
// do contêiner: guarda o corpo ilegível de lado e recomeça dos padrões.
let persistido = {};
if (existsSync(persistArq)) {
  try { persistido = leJson(persistArq); }
  catch (e) {
    console.error('[persist] estado.json ilegível — arquivando como .corrompido e recomeçando:', e.message);
    try { renameSync(persistArq, persistArq + '.corrompido'); } catch (_) { }
  }
}
const persist = Object.assign(
  { modo: 'normal', favoritos: {}, apelidos: {}, recusadas: [], criadas: [],
    estados: {}, areasCriadas: [], areasPatch: {}, areasApagadas: [] },
  persistido
);

// Escrita atômica (tmp + rename): ou o arquivo antigo inteiro, ou o novo
// inteiro — nunca metade de um JSON no disco.
const salvar = () => {
  try {
    const tmp = persistArq + '.tmp';
    writeFileSync(tmp, JSON.stringify(persist, null, 2));
    renameSync(tmp, persistArq);
  } catch (e) { console.error('[persist]', e.message); }
};

const arranque = Date.now();
let modoAtual = persist.modo;
let automacoes = structuredClone(casa.automations || []);
for (const a of automacoes) {
  const e = persist.estados[a.id];
  if (typeof e === 'boolean') a.on = e;                    // formato antigo
  else if (e && typeof e === 'object') {
    if (typeof e.on === 'boolean') a.on = e.on;
    if (e.name) a.name = e.name;
    if (Array.isArray(e.modos)) a.modos = e.modos;
  }
}
automacoes.push(...structuredClone(persist.criadas));

// Cômodos criados/editados/apagados em runtime também sobrevivem.
for (let i = areas.length - 1; i >= 0; i--)
  if (persist.areasApagadas.includes(areas[i].id)) areas.splice(i, 1);
for (const a of areas) Object.assign(a, persist.areasPatch[a.id] || {});
areas.push(...structuredClone(persist.areasCriadas));
let sugestoes = [];
const recusadas = new Set(persist.recusadas);
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
    if (!adaptador.devices().some(x => x.id === id)) return null;
    // Apelido persistido, nunca mutação do objeto do adaptador — um resync
    // do bridge/devices reconstruiria o Device e apagaria o rename.
    const ap = persist.apelidos[id] || (persist.apelidos[id] = {});
    if (typeof name === 'string' && name.trim()) ap.name = name.trim();
    if (areaId !== undefined) ap.areaId = areaId;
    salvar();
    return central.device(id);
  },

  remover: id => adaptador.remover(id),

  favoritar(id, valor){
    if (!adaptador.devices().some(d => d.id === id)) return false;
    persist.favoritos[id] = valor;
    salvar();
    return true;
  },

  /** Para o healthcheck do contêiner e para diagnóstico rápido. */
  saude: () => ({
    status: 'ok',
    uptime: Math.round((Date.now() - arranque) / 1000),
    adaptador: adaptador?.nome || null,
    hub: hubOnline,
    devices: adaptador ? adaptador.devices().length : 0,
    historico: historico.tamanho
  }),

  parear: seg => adaptador.parear(seg),
  pararPareamento: () => adaptador.pararPareamento(),

  criarArea({ name, icon }) {
    const a = { id: novoUuid(), key: null, name: name || 'Novo cômodo', icon,
                order: areas.length + 1 };
    areas.push(a);
    persist.areasCriadas.push({ ...a });
    salvar();
    return { id: a.id, name: a.name, icon: a.icon, order: a.order };
  },
  editarArea(id, patch) {
    const a = areas.find(x => x.id === id); if (!a) return null;
    if (patch.name) a.name = patch.name;
    if (patch.icon !== undefined) a.icon = patch.icon;
    if (Number.isFinite(patch.order)) a.order = patch.order;
    const criada = persist.areasCriadas.find(x => x.id === id);
    if (criada) Object.assign(criada, { name: a.name, icon: a.icon, order: a.order });
    else persist.areasPatch[id] = { name: a.name, icon: a.icon, order: a.order };
    salvar();
    return { id: a.id, name: a.name, icon: a.icon, order: a.order };
  },
  apagarArea(id) {
    const i = areas.findIndex(x => x.id === id); if (i < 0) return false;
    areas.splice(i, 1);
    for (const d of adaptador.devices()) if (d.areaId === id) d.areaId = null;
    const iC = persist.areasCriadas.findIndex(x => x.id === id);
    if (iC >= 0) persist.areasCriadas.splice(iC, 1);
    else if (!persist.areasApagadas.includes(id)) persist.areasApagadas.push(id);
    delete persist.areasPatch[id];
    // Apelidos que apontavam para o cômodo morto não podem ficar órfãos.
    for (const ap of Object.values(persist.apelidos))
      if (ap.areaId === id) ap.areaId = null;
    salvar();
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
    persist.modo = id;
    salvar();
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
    // Criada pelo aprendiz? Atualiza a cópia persistida. Automação do
    // instalador persiste o que a API aceitou mudar (on, name, modos) como
    // sobreposição — casa.json continua sendo a base.
    const criada = persist.criadas.find(x => x.id === a.id);
    if (criada) Object.assign(criada, { on: a.on, name: a.name, modos: a.modos });
    else {
      const e = (typeof persist.estados[a.id] === 'object' && persist.estados[a.id]) || {};
      if (typeof patch.on === 'boolean') e.on = a.on;
      if (patch.name) e.name = a.name;
      if (Array.isArray(patch.modos)) e.modos = a.modos;
      persist.estados[a.id] = e;
    }
    salvar();
    stream?.emitir('automation.changed', { automation: a });
    return a;
  },

  sugestoes: () => sugestoes,

  decidirSugestao(id, decisao) {
    const g = sugestoes.find(s => s.id === id); if (!g) return false;
    if (decisao === 'aceitar') {
      if (g.tipo === 'recuar') {
        const alvo = automacoes.find(a => a.id === g.alvo);
        if (alvo) {
          alvo.on = false;
          // O desligamento tem que sobreviver ao reinício — senão a rotina
          // suspensa volta ligada e a sugestão de recuo, já consumida,
          // nunca é reoferecida.
          const criada = persist.criadas.find(x => x.id === alvo.id);
          if (criada) criada.on = false;
          else {
            const e = (typeof persist.estados[alvo.id] === 'object' && persist.estados[alvo.id]) || {};
            e.on = false;
            persist.estados[alvo.id] = e;
          }
        }
        recusadas.add(g.id);
      } else {
        // Aceita também entra em recusadas: os ids das sugestões são
        // determinísticos, e sem isto o recálculo horário reofereceria a
        // mesma sugestão — re-aceitar duplicaria a automação.
        recusadas.add(g.id);
        const nova = { id: 'auto_' + Date.now().toString(36), on: true,
          supervisionada: true, name: g.rotina.nome, desc: g.rotina.desc,
          icon: g.rotina.icon, modos: g.rotina.modos, gatilho: g.rotina.gatilho,
          steps: g.rotina.steps || [] };
        automacoes.push(nova);
        persist.criadas.push(structuredClone(nova));
      }
    } else if (decisao === 'nunca') recusadas.add(g.id);

    persist.recusadas = [...recusadas];
    salvar();
    sugestoes = sugestoes.filter(s => s.id !== id);
    stream?.emitir('suggestions.changed', { suggestions: sugestoes });
    stream?.emitir('automation.changed', { automations: central.automacoes() });
    return true;
  }
};

/** Anexa o que é da central, não do backend: favorito e último evento. */
function enfeitar(d) {
  const ap = persist.apelidos[d.id] || {};
  const nativo = Object.entries(casa.devices || {}).find(([, v]) => v.name === d.name)?.[0];
  const fav = (d.id in persist.favoritos)
    ? !!persist.favoritos[d.id]
    : (nativo ? !!casa.devices[nativo].favorito : false);
  const caps = d.capabilities.map(c => {
    if (c.type !== 'event') return c;
    const u = ultimoEvento.get(`${d.id}:${c.id}`);
    return u ? { ...c, lastEvent: u.event, lastEventAt: u.ts } : c;
  });
  return { ...d, name: ap.name || d.name,
           areaId: ap.areaId !== undefined ? ap.areaId : d.areaId,
           capabilities: caps, favorite: fav };
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

/* O sol de hoje, calculado uma vez por dia. "Acender no pôr do sol"
 * continua certa em junho e em dezembro sem ninguém reajustar horário —
 * e sem internet: é astronomia, não API. */
let solCache = { dia: '', nascer: null, por: null };
function minutosSol(evento, d) {
  const dia = d.toDateString();
  if (solCache.dia !== dia) {
    const { lat, lon } = casa.home;
    const temCoords = Number.isFinite(lat) && Number.isFinite(lon);
    if (!temCoords && (casa.automations || []).some(x => x.gatilho?.tipo === 'sol'))
      console.warn('[sol] automação solar configurada mas home.lat/lon ausentes em casa.json — ela nunca vai disparar');
    solCache = { dia,
      nascer: temCoords ? eventoSolar(lat, lon, d, 'nascer') : null,
      por:    temCoords ? eventoSolar(lat, lon, d, 'por')    : null };
    if (solCache.por !== null)
      console.log(`[sol] hoje: nasce ${hhmmSol(solCache.nascer)}, põe ${hhmmSol(solCache.por)}`);
  }
  return evento === 'nascer' ? solCache.nascer : solCache.por;
}

setInterval(() => {
  const d = new Date();
  const minuto = d.getHours() * 60 + d.getMinutes();
  const tipoDia = tipoDeDia(Date.now());
  const hoje = d.toDateString();

  for (const a of automacoes) {
    if (!a.on || !valeNoModo(a)) continue;
    const g = a.gatilho;

    let alvo = null;
    if (g?.tipo === 'hora') {
      if (g.dias && g.dias !== 'todos' && g.dias !== tipoDia) continue;
      alvo = g.minuto;
    } else if (g?.tipo === 'sol') {
      const base = minutosSol(g.evento || 'por', d);
      if (base === null) continue;          // latitude sem o evento hoje
      const off = Number.isFinite(g.offsetMin) ? g.offsetMin : 0;
      // Módulo de verdade: qualquer offset, por mais absurdo, cai em 0..1439
      // em vez de virar alvo negativo que nunca dispara.
      alvo = (((base + off) % 1440) + 1440) % 1440;
    } else continue;

    if (minuto !== alvo || a.disparouEm === hoje) continue;   // NTP pode voltar o relógio
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
    const cab = { 'content-type': tipo,
      // Ícones não mudam entre versões; o resto revalida sempre.
      'cache-control': extname(alvo) === '.png' ? 'public, max-age=604800' : 'no-cache' };
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
/* Em produção a central fala com DOIS mundos ao mesmo tempo: a malha
   Zigbee (via Zigbee2MQTT) e as pontes de E/S com fio (convenção MQTT
   própria — docs/pontes-mqtt.md). A fachada apresenta os dois como um
   adaptador só; nenhum outro ponto do servidor sabe da diferença. */
const adaptadores = cfg.adaptador === 'simulador'
  ? [new AdaptadorSimulador({ casa, bus })]
  : [new AdaptadorZigbee2Mqtt({ mqtt: cfg.mqtt, casa, bus }),
     new AdaptadorPonte({ mqtt: cfg.mqtt, casa, bus })];

const donoDe = id => adaptadores.find(a => a.devices().some(d => d.id === id));
adaptador = {
  get nome() { return adaptadores.map(a => a.nome).join('+'); },
  devices: () => adaptadores.flatMap(a => a.devices()),
  comandar: (id, capId, cmd, commandId) =>
    donoDe(id)?.comandar(id, capId, cmd, commandId) ?? false,
  remover: id => donoDe(id)?.remover(id) ?? false,
  uuidDoNativo: nome => {
    for (const a of adaptadores) { const u = a.uuidDoNativo(nome); if (u) return u; }
    return null;
  },
  // Pareamento é conceito de rádio: vai para o adaptador da malha, que é
  // sempre o primeiro. Pontes entram na casa por fio, não por pareamento.
  parear: seg => adaptadores[0].parear(seg),
  pararPareamento: () => adaptadores[0].pararPareamento(),
  parar: () => adaptadores.forEach(a => a.parar?.()),
};

adaptadores.forEach(a => a.iniciar());
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
  process.on(sinal, () => { salvar(); adaptador.parar?.(); process.exit(0); });
