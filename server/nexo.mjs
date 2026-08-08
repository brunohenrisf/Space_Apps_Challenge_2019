#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
 * NEXO — painel, versão Raspberry Pi
 *
 * Faz o mesmo que firmware/nexo-panel/nexo-panel.ino faz no ESP32, com
 * o mesmo contrato REST/WebSocket — a interface não sabe qual dos dois
 * está do outro lado e não muda uma linha entre os dois modos.
 *
 * O que só existe aqui, porque o ESP32 não tinha como:
 *   · histórico de meses e o aprendiz que propõe rotinas (lib/aprendiz.mjs)
 *   · relógio confiável, então rotina por horário funciona
 *   · motor de rotinas com modos da casa
 *   · dezenas de telefones simultâneos em vez de meia dúzia
 *
 * Dependências: mqtt e ws. As duas em JS puro — nada compila, que é o
 * que faz a instalação num Pi de cliente não travar.
 *
 *   node server/nexo.mjs
 * ───────────────────────────────────────────────────────────────────── */
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import mqtt from 'mqtt';

import { Historico, tipoDeDia } from './lib/historico.mjs';
import { sugerir } from './lib/aprendiz.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── Configuração ───────────────────────────────────────────────── */
const cfgArq = process.env.NEXO_CONFIG || join(RAIZ, 'server', 'config.json');
const cfg = Object.assign({
  porta: 8080,
  app: join(RAIZ, 'app'),
  casa: join(RAIZ, 'casa'),
  dados: join(RAIZ, 'server', 'dados'),
  mqtt: { url: 'mqtt://127.0.0.1:1883', base: 'zigbee2mqtt', usuario: null, senha: null },
  pin: '1234',
  tarifa: 0.92
}, existsSync(cfgArq) ? JSON.parse(readFileSync(cfgArq, 'utf8')) : {});

const leJson = p => JSON.parse(readFileSync(p, 'utf8'));
const catalogo = leJson(join(cfg.casa, 'devices.json'));
const cenas    = leJson(join(cfg.casa, 'scenes.json'));

mkdirSync(cfg.dados, { recursive: true });
const historico = new Historico(join(cfg.dados, 'historico'));

/* Estado que sobrevive a reinício: modo, rotinas criadas, recusas. */
const persistArq = join(cfg.dados, 'estado.json');
const persist = Object.assign(
  { modo: 'normal', rotinas: [], recusadas: [], favoritos: {} },
  existsSync(persistArq) ? leJson(persistArq) : {}
);
const salvar = () => writeFileSync(persistArq, JSON.stringify(persist, null, 2));

/* Rotinas base (do instalador) + as que a casa criou e o morador aceitou. */
const rotinasBase = existsSync(join(cfg.casa, 'routines.json'))
  ? leJson(join(cfg.casa, 'routines.json')).routines : [];
let rotinas = [...rotinasBase, ...persist.rotinas];

/* Estado ao vivo de cada dispositivo, indexado por id. */
const vivo = new Map(catalogo.devices.map(d => [d.id, { st: {}, seen: 0, lqi: 0, bat: null, ieee: null }]));
const porId  = id => catalogo.devices.find(d => d.id === id);
const porZ2M = n  => catalogo.devices.find(d => d.z2m === n);

let sugestoes = [];
let hubOnline = false;
const arranque = Date.now();

/* ═══════════════════════════════════════════════════════════════
   TRADUÇÃO ZIGBEE ↔ INTERFACE
   Mora aqui e em mais lugar nenhum — é o que permite trocar de hub
   sem tocar no aplicativo. Espelha a mesma tabela do .ino.
   ═══════════════════════════════════════════════════════════════ */
function zigbeeParaApp(z, st) {
  if (typeof z.state === 'string') {
    if (z.state === 'LOCK' || z.state === 'UNLOCK') st.trancado = z.state === 'LOCK';
    else st.on = z.state === 'ON';
  }
  if (Number.isFinite(z.brightness))  st.bri = Math.round(z.brightness / 2.54);
  if (Number.isFinite(z.color_temp))  st.k   = Math.round(1e6 / z.color_temp);
  if (Number.isFinite(z.position))    st.pos = z.position;
  if (Number.isFinite(z.power))       st.w   = z.power;
  if (Number.isFinite(z.energy))      st.kwh = z.energy;
  if (Number.isFinite(z.temperature)) st.t   = z.temperature;
  if (Number.isFinite(z.humidity))    st.h   = z.humidity;
  if (typeof z.occupancy  === 'boolean') st.motion = z.occupancy;
  if (typeof z.contact    === 'boolean') st.aberto = !z.contact;   // Zigbee reporta contato FECHADO
  if (typeof z.water_leak === 'boolean') st.leak   = z.water_leak;
  return st;
}

function appParaZigbee(p) {
  const z = {};
  if ('on'  in p) z.state      = p.on ? 'ON' : 'OFF';
  if ('bri' in p) z.brightness = Math.round(p.bri * 2.54);
  if ('k'   in p) z.color_temp = Math.round(1e6 / p.k);
  if ('pos' in p) z.position   = p.pos;
  if ('trancado' in p) z.state = p.trancado ? 'LOCK' : 'UNLOCK';
  return z;
}

/* ═══════════════════════════════════════════════════════════════
   MQTT
   ═══════════════════════════════════════════════════════════════ */
const cliente = mqtt.connect(cfg.mqtt.url, {
  username: cfg.mqtt.usuario || undefined,
  password: cfg.mqtt.senha || undefined,
  clientId: 'nexo-painel',
  reconnectPeriod: 5000
});

cliente.on('connect', () => {
  console.log('[mqtt] conectado a', cfg.mqtt.url);
  cliente.subscribe([`${cfg.mqtt.base}/+`, `${cfg.mqtt.base}/bridge/state`, `${cfg.mqtt.base}/bridge/devices`]);
});
cliente.on('error', e => console.error('[mqtt]', e.message));
cliente.on('offline', () => { hubOnline = false; difundir({ t: 'hub', p: { online: false } }); });

cliente.on('message', (topico, carga) => {
  const texto = carga.toString();

  if (topico.endsWith('/bridge/state')) {
    hubOnline = texto.includes('online');
    return difundir({ t: 'hub', p: { online: hubOnline } });
  }

  if (topico.endsWith('/bridge/devices')) {
    // Só para preencher IEEE e modelo — o catálogo da casa manda no resto.
    try {
      for (const d of JSON.parse(texto)) {
        const meta = porZ2M(d.friendly_name);
        if (meta && vivo.has(meta.id)) vivo.get(meta.id).ieee = d.ieee_address || null;
      }
    } catch (_) { }
    return;
  }

  if (topico.startsWith(`${cfg.mqtt.base}/bridge/`)) return;

  const meta = porZ2M(topico.slice(cfg.mqtt.base.length + 1));
  if (!meta) return;

  let z;
  try { z = JSON.parse(texto); } catch (_) { return; }

  const v = vivo.get(meta.id);
  const antes = { ...v.st };
  zigbeeParaApp(z, v.st);
  if (Number.isFinite(z.linkquality)) v.lqi = z.linkquality;
  if (Number.isFinite(z.battery))     v.bat = z.battery;
  v.seen = Date.now();

  difundir({ t: 'state', id: meta.id, p: v.st });
  avaliarGatilhosDeEvento(meta.id, antes, v.st);
});

/** Publica um comando e devolve o que foi enviado. */
function comandar(id, zigbee) {
  const meta = porId(id);
  if (!meta) return;
  cliente.publish(`${cfg.mqtt.base}/${meta.z2m}/set`, JSON.stringify(zigbee));
}

/* ═══════════════════════════════════════════════════════════════
   AÇÕES — todo caminho que mexe num dispositivo passa por aqui,
   porque é aqui que o histórico é escrito. A distinção entre manual,
   rotina e cena é o que faz o aprendiz funcionar: se a rotina que a
   casa criou realimentasse o histórico como se fosse gente, ela
   confirmaria o próprio palpite para sempre.
   ═══════════════════════════════════════════════════════════════ */
function aplicar(id, patch, origem, extra = {}) {
  const z = appParaZigbee(patch);
  if (!Object.keys(z).length) return;
  comandar(id, z);

  const acao = 'on' in patch ? (patch.on ? 'on' : 'off')
             : 'trancado' in patch ? (patch.trancado ? 'lock' : 'unlock')
             : 'set';
  historico.registrar({ id, acao, valor: patch, modo: persist.modo, origem, ...extra });
}

function aplicarCena(cenaId, origem = 'manual') {
  const c = cenas.scenes.find(s => s.id === cenaId);
  if (!c) return;
  for (const passo of c.steps) {
    comandar(passo.id, passo.set);
    historico.registrar({ id: passo.id, acao: 'cena', valor: passo.set,
      modo: persist.modo, origem, cena: cenaId });
  }
}

function trocarModo(novo) {
  if (persist.modo === novo) return;
  persist.modo = novo;
  salvar();
  historico.registrar({ id: '_casa', acao: 'modo', valor: { modo: novo }, modo: novo, origem: 'manual' });
  difundir({ t: 'modo', p: { modo: novo } });
  agendarAposModo(novo);
}

/* ═══════════════════════════════════════════════════════════════
   MOTOR DE ROTINAS
   Uma rotina só age se o modo atual estiver na sua lista. É isso que
   faz o mesmo gatilho se comportar diferente conforme o estado da
   casa — sem modo, cada caso vira uma regra com exceções aninhadas.
   ═══════════════════════════════════════════════════════════════ */
const valeNoModo = r => !r.modos || r.modos.includes(persist.modo);

function executar(r) {
  console.log('[rotina]', r.name || r.nome);
  for (const passo of (r.passos || [])) {
    comandar(passo.id, passo.set);
    const acao = passo.set.state === 'OFF' ? 'off' : passo.set.state === 'ON' ? 'on' : 'set';
    historico.registrar({ id: passo.id, acao, valor: passo.set,
      modo: persist.modo, origem: 'rotina', rotina: r.id });
  }
  if (r.cena) aplicarCena(r.cena, 'rotina');
  r.ultimaVez = Date.now();
}

/* Gatilho por horário, com precisão de minuto. Varre a cada 30 s e
 * guarda o dia do último disparo para não repetir — o relógio pode ser
 * ajustado por NTP e voltar alguns segundos. */
setInterval(() => {
  const agora = new Date();
  const minuto = agora.getHours() * 60 + agora.getMinutes();
  const tipo = tipoDeDia(Date.now());
  const hoje = agora.toDateString();

  for (const r of rotinas) {
    if (!r.on || !valeNoModo(r)) continue;
    const g = r.gatilho;
    if (g?.tipo !== 'hora') continue;
    if (g.dias && g.dias !== 'todos' && g.dias !== tipo) continue;
    if (minuto !== g.minuto || r.disparouEm === hoje) continue;
    r.disparouEm = hoje;
    executar(r);
  }
}, 30_000);

/* Gatilho "N minutos depois que a casa entrou no modo X". */
const agendados = new Set();
function agendarAposModo(modo) {
  for (const t of agendados) clearTimeout(t);
  agendados.clear();

  for (const r of rotinas) {
    const g = r.gatilho;
    if (!r.on || g?.tipo !== 'apos-modo' || g.modo !== modo) continue;
    const t = setTimeout(() => {
      // Reconfere: se a casa saiu do modo nesse meio-tempo, não age.
      if (persist.modo === modo && r.on) executar(r);
    }, g.minutos * 60e3);
    agendados.add(t);
  }
}

/* Gatilho por evento de dispositivo (vazamento, contato, presença). */
function avaliarGatilhosDeEvento(id, antes, depois) {
  for (const r of rotinas) {
    if (!r.on || !valeNoModo(r)) continue;
    const g = r.gatilho;
    if (g?.tipo !== 'evento' || g.id !== id) continue;

    const [chave, esperado] = Object.entries(g.quando)[0];
    if (depois[chave] === esperado && antes[chave] !== esperado) executar(r);
  }
}

/* ═══════════════════════════════════════════════════════════════
   APRENDIZ — recalcula de hora em hora e na partida
   ═══════════════════════════════════════════════════════════════ */
function recalcularSugestoes() {
  sugestoes = sugerir({
    historico, catalogo, rotinas,
    recusadas: new Set(persist.recusadas)
  });
  console.log(`[aprendiz] ${historico.tamanho} eventos, ${sugestoes.length} sugestões`);
  difundir({ t: 'sugestoes', p: sugestoes });
}
setInterval(recalcularSugestoes, 3600_000);

function decidirSugestao(id, decisao) {
  const g = sugestoes.find(s => s.id === id);
  if (!g) return;

  if (decisao === 'aceitar') {
    if (g.tipo === 'recuar') {
      const alvo = rotinas.find(r => r.id === g.alvo);
      if (alvo) { alvo.on = false; persist.rotinas = persist.rotinas.map(r => r.id === alvo.id ? alvo : r); }
      persist.recusadas.push(g.id);          // não reoferecer o mesmo recuo
    } else {
      const nova = { id: 'auto_' + Date.now().toString(36), on: true, supervisionada: true,
        name: g.rotina.nome, ...g.rotina };
      rotinas.push(nova);
      persist.rotinas.push(nova);
      if (nova.gatilho?.tipo === 'apos-modo') agendarAposModo(persist.modo);
    }
  } else if (decisao === 'nunca') {
    persist.recusadas.push(g.id);
  }
  // "depois" não persiste nada: volta na próxima varredura, de propósito.

  salvar();
  sugestoes = sugestoes.filter(s => s.id !== id);
  difundir({ t: 'sugestoes', p: sugestoes });
  difundir({ t: 'rotinas', p: rotinas });
}

/* ═══════════════════════════════════════════════════════════════
   HTTP
   ═══════════════════════════════════════════════════════════════ */
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8', '.png':'image/png',
  '.svg':'image/svg+xml', '.ico':'image/x-icon' };

function fotografia() {
  return {
    house: catalogo.house || { name: 'Casa', tarifa: cfg.tarifa },
    hub:   { online: hubOnline, coord: 'Zigbee2MQTT', canal: '—', panId: '—', permitJoin: 0 },
    painel:{ ip: '—', rssi: 0, uptime: Math.round((Date.now() - arranque) / 1000),
             heap: Math.round(process.memoryUsage().heapUsed / 1024), fw: 'pi-1.0.0',
             sd: `${historico.tamanho} eventos no histórico` },
    modo:  persist.modo,
    rooms: catalogo.rooms,
    scenes: catalogo.scenes,
    routines: rotinas.map(r => ({ ...r, name: r.name || r.nome })),
    sugestoes,
    devices: catalogo.devices.map(d => {
      const v = vivo.get(d.id);
      return { ...d, st: v.st, seen: v.seen || Date.now(), lqi: v.lqi, bat: v.bat,
               ieee: v.ieee || '—', fav: persist.favoritos[d.id] ?? d.fav ?? false };
    }),
    energia: energia24h()
  };
}

/** Consumo por hora, somando os relatos das tomadas com medição. */
function energia24h() {
  const horas = new Array(24).fill(0);
  for (const d of catalogo.devices) {
    if (!d.caps?.includes('power')) continue;
    const w = vivo.get(d.id).st.w;
    if (Number.isFinite(w)) horas[new Date().getHours()] += w / 1000;
  }
  return { horas: horas.map(v => +v.toFixed(2)), total: +horas.reduce((a, b) => a + b, 0).toFixed(1) };
}

const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');

  if (u.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(fotografia()));
  }

  // Estáticos, preferindo o .gz quando existe — mesma economia do ESP32,
  // e aqui também poupa o cartão do Pi.
  let rel = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
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

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('não encontrado');
});

/* ═══════════════════════════════════════════════════════════════
   WEBSOCKET — mesmo vocabulário do firmware
   ═══════════════════════════════════════════════════════════════ */
const wss = new WebSocketServer({ server: servidor, path: '/ws' });

function difundir(msg) {
  const texto = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(texto);
}

wss.on('connection', c => {
  c.send(JSON.stringify({ t: 'hub', p: { online: hubOnline } }));

  c.on('message', dados => {
    let m; try { m = JSON.parse(dados); } catch (_) { return; }

    if (m.t === 'set')        aplicar(m.id, m.p, 'manual');
    else if (m.t === 'scene') aplicarCena(m.id, 'manual');
    else if (m.t === 'modo')  trocarModo(m.id);
    else if (m.t === 'sug')   decidirSugestao(m.id, m.v);
    else if (m.t === 'fav')   { persist.favoritos[m.id] = !!m.v; salvar(); }
    else if (m.t === 'routine') {
      const r = rotinas.find(x => x.id === m.id);
      if (r) { r.on = !r.on; persist.rotinas = persist.rotinas.map(x => x.id === r.id ? r : x); salvar(); }
      difundir({ t: 'rotinas', p: rotinas });
    }
    else if (m.t === 'pair') {
      cliente.publish(`${cfg.mqtt.base}/bridge/request/permit_join`,
        JSON.stringify({ value: m.s > 0, time: m.s }));
    }
  });
});

/* ── Partida ────────────────────────────────────────────────────── */
recalcularSugestoes();
agendarAposModo(persist.modo);
servidor.listen(cfg.porta, () => {
  console.log(`[http] no ar em http://0.0.0.0:${cfg.porta}`);
  console.log(`[casa] ${catalogo.devices.length} dispositivos, ${rotinas.length} rotinas, modo ${persist.modo}`);
});

process.on('SIGTERM', () => { salvar(); process.exit(0); });
process.on('SIGINT',  () => { salvar(); process.exit(0); });
