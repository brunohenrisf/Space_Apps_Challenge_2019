/**
 * Banco de ensaio das pontes de E/S.
 *
 *   node server/ferramentas/ponte.mjs
 *
 * Sobe um broker MQTT de verdade (aedes), planta uma ponte fingida —
 * o portão da garagem, com relé, contato, temperatura e campainha — e
 * confere a convenção de docs/pontes-mqtt.md dos dois lados: announce
 * retained vira Device, comando vira MQTT, estado vira delta no WS,
 * LWT vira reachability, e remover limpa os retained do broker.
 *
 * O detalhe que importa: o announce é publicado ANTES de a central
 * subir. É o cenário real de um reinício — a ponte não reapresenta
 * nada, o retained faz o trabalho.
 */
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import mqtt from 'mqtt';
import Aedes from 'aedes';
import { uuidDe, rssiParaSinal } from '../lib/contrato/modelo.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORTA = 8127, MQTT_PORTA = 1893;
const BASE = `http://127.0.0.1:${PORTA}/api/v1`;
const T = 'nexo/pontes/portao';
const espera = ms => new Promise(r => setTimeout(r, ms));

let falhas = 0, total = 0;
const ok  = m => { total++; console.log('  ✓', m); };
const nok = (m, d) => { total++; falhas++; console.log('  ✗', m, d !== undefined ? `→ ${JSON.stringify(d)}` : ''); };
const conf = (cond, m, d) => cond ? ok(m) : nok(m, d);
const secao = t => console.log(`\n  ${t}\n  ${'─'.repeat(t.length)}`);

async function req(metodo, caminho, { corpo, token } = {}) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { ...(corpo ? { 'content-type': 'application/json' } : {}),
               ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await r.text();
  return { status: r.status, corpo: texto ? JSON.parse(texto) : null };
}

/* ── Broker + a ponte fingida, ANTES da central ─────────────────── */
const aedes = new Aedes();
const broker = createServer(aedes.handle);
await new Promise(r => broker.listen(MQTT_PORTA, r));

const ponte = mqtt.connect(`mqtt://127.0.0.1:${MQTT_PORTA}`);
await new Promise(r => ponte.on('connect', r));
const recebidos = [];
ponte.subscribe(`${T}/comando`);
ponte.on('message', (t, c) => { if (t === `${T}/comando`) recebidos.push(JSON.parse(c.toString())); });

const ret = { retain: true };
ponte.publish(`${T}/config`, JSON.stringify({
  nome: 'Portão da garagem', area: 'entrada',
  fabricante: 'Volttex', modelo: 'Ponte E/S v1', descricao: 'Ponte com fio do portão',
  canais: [
    { id: 'rele',      tipo: 'switch',      nome: 'Portão', pulsoMs: 800 },
    { id: 'aberto',    tipo: 'contact',     nome: 'Folha do portão' },
    { id: 'temp',      tipo: 'temperature' },
    { id: 'campainha', tipo: 'botao' },
    { id: 'laser',     tipo: 'laser_2035' },         // do futuro: deve ser ignorado
    { id: 'rssi',      tipo: 'temperature' },        // id reservado à saúde: ignorado
    { id: 'temp',      tipo: 'humidity' }            // duplicado: o primeiro vale
  ]
}), ret);
ponte.publish(`${T}/estado`, JSON.stringify({ rele: false, aberto: false, temp: 29.5, rssi: -58 }), ret);
ponte.publish(`${T}/disponibilidade`, 'online', ret);
await espera(150);

/* ── Sobe a central (modo produção: zigbee2mqtt + pontes) ───────── */
const dados = join(RAIZ, 'server', 'dados', 'ponte-ensaio');
rmSync(dados, { recursive: true, force: true });
writeFileSync('/tmp/ponte-nexo.json', JSON.stringify({
  porta: PORTA, dados, mqtt: { url: `mqtt://127.0.0.1:${MQTT_PORTA}`, base: 'zigbee2mqtt' }
}));
const central = spawn('node', [join(RAIZ, 'server', 'nexo.mjs')],
  { env: { ...process.env, NEXO_CONFIG: '/tmp/ponte-nexo.json', NEXO_ADAPTADOR: 'zigbee2mqtt' },
    stdio: ['ignore', 'pipe', 'pipe'] });
const saida = [];
central.stdout.on('data', d => saida.push(d.toString()));
central.stderr.on('data', d => saida.push('ERR ' + d.toString()));
process.on('exit', () => central.kill());
await espera(1600);

try {
  secao('Announce retained → Device do contrato');

  let r = await req('POST', '/setup/claim',
    { corpo: { name: 'Instalador', email: 'i@casa.test', password: 'senhaforte1', homeName: 'Bancada' } });
  conf(r.status === 201, 'claim da bancada', r.status);
  const token = r.corpo.accessToken;

  r = await req('GET', '/devices', { token });
  conf(r.corpo.devices.length === 1, 'a ponte é o único aparelho — nada vazou do z2m', r.corpo.devices.length);

  const idPonte = uuidDe('ponte', 'portao');
  const d = r.corpo.devices.find(x => x.id === idPonte);
  conf(!!d, 'id determinístico uuidDe("ponte","portao") — sobrevive a reinício');
  conf(d?.name === 'Portão da garagem' && d?.model.protocol === 'ponte',
       'nome do announce e protocol "ponte"', d?.model);
  conf(d?.capabilities.length === 4,
       'desconhecido, id reservado e duplicado são ignorados: 7 anunciados, 4 na tela',
       d?.capabilities.map(c => c.id));

  const rele = d.capabilities.find(c => c.id === 'rele');
  conf(rele?.type === 'switch' && rele.label === 'Portão' && rele.state === false,
       'relé vira switch com label, estado do retained', rele);
  const temp = d.capabilities.find(c => c.id === 'temp');
  conf(temp?.type === 'sensor' && temp.measure === 'temperature'
       && temp.unit === '°C' && temp.value === 29.5,
       'temperatura vira sensor com unidade — e o valor veio do retained', temp);
  const aberto = d.capabilities.find(c => c.id === 'aberto');
  conf(aberto?.type === 'binary_sensor' && aberto.measure === 'contact' && aberto.readonly === true,
       'contato vira binary_sensor readonly (true = aberto, sem inversão de legado)', aberto);
  const camp = d.capabilities.find(c => c.id === 'campainha');
  conf(camp?.type === 'event' && camp.measure === 'button', 'campainha vira event/button', camp);
  conf(d.reachability.online === true && d.reachability.signal === rssiParaSinal(-58),
       `RSSI −58 dBm → sinal ${rssiParaSinal(-58)} na régua do contrato`, d.reachability);

  /* ── Stream ─────────────────────────────────────────────────── */
  const ws = new WebSocket(`ws://127.0.0.1:${PORTA}/api/v1/stream`);
  await new Promise(res => ws.on('open', res));
  const eventos = [];
  ws.on('message', x => eventos.push(JSON.parse(x)));
  ws.send(JSON.stringify({ type: 'auth', token }));
  await espera(300);

  secao('Comando → MQTT → estado → delta e confirmação');

  let marca = eventos.length;
  r = await req('POST', `/devices/${idPonte}/capabilities/rele/command`,
    { token, corpo: { type: 'switch', state: true } });
  conf(r.status === 202 && r.corpo.commandId, 'comando aceito com 202', r.status);
  const cid = r.corpo?.commandId;
  await espera(300);
  conf(recebidos.length === 1 && recebidos[0].canal === 'rele' && recebidos[0].valor === true,
       'a ponte recebeu { canal: "rele", valor: true } no tópico /comando', recebidos);

  // O firmware fecha o relé e reporta — é o eco que confirma o comando.
  ponte.publish(`${T}/estado`, JSON.stringify({ rele: true, aberto: false, temp: 29.5, rssi: -58 }), ret);
  await espera(400);
  const delta = eventos.slice(marca).find(e => e.type === 'state.changed' && e.payload?.capabilityId === 'rele');
  conf(delta?.payload.changes.state === true, 'delta state.changed chegou pelo stream', delta?.payload);
  const res1 = eventos.slice(marca).find(e => e.type === 'command.result' && e.payload?.commandId === cid);
  conf(res1?.payload.status === 'applied', 'command.result applied — o otimismo do app se resolve', res1?.payload);

  r = await req('POST', `/devices/${idPonte}/capabilities/aberto/command`,
    { token, corpo: { type: 'switch', state: true } });
  conf(r.status === 409 && r.corpo.error === 'capability_readonly',
       'mandar no contato é 409 capability_readonly — sensor não obedece', r.corpo);

  secao('Evento, queda e reapresentação');

  marca = eventos.length;
  ponte.publish(`${T}/evento`, JSON.stringify({ canal: 'campainha', valor: 'single' }));
  await espera(300);
  const ev = eventos.slice(marca).find(e => e.type === 'device.event');
  conf(ev?.payload.capabilityId === 'campainha' && ev?.payload.event === 'single',
       'campainha toca como device.event — stateless, nada fica aceso', ev?.payload);

  marca = eventos.length;
  ponte.publish(`${T}/disponibilidade`, 'offline', ret);
  await espera(300);
  const alc = eventos.slice(marca).find(e => e.type === 'device.reachability');
  conf(alc?.payload.reachability.online === false, 'LWT offline → reachability.online false', alc?.payload);
  r = await req('GET', `/devices/${idPonte}`, { token });
  conf(r.corpo.reachability.online === false, 'GET confirma o aparelho fora do ar');
  ponte.publish(`${T}/disponibilidade`, 'online', ret);

  marca = eventos.length;
  ponte.publish(`${T}/config`, JSON.stringify({
    nome: 'Portão da garagem', area: 'entrada',
    canais: [
      { id: 'rele', tipo: 'switch', nome: 'Portão', pulsoMs: 800 },
      { id: 'aberto', tipo: 'contact', nome: 'Folha do portão' },
      { id: 'temp', tipo: 'temperature' },
      { id: 'campainha', tipo: 'botao' },
      { id: 'umid', tipo: 'humidity' }                 // firmware atualizado ganhou um canal
    ]
  }), ret);
  await espera(300);
  r = await req('GET', '/devices', { token });
  const d2 = r.corpo.devices.find(x => x.id === idPonte);
  conf(r.corpo.devices.length === 1 && d2?.capabilities.length === 5,
       'announce novo ATUALIZA o aparelho — nada de duplicata', r.corpo.devices.length);
  conf(d2?.capabilities.find(c => c.id === 'rele')?.state === true,
       'e o estado que a casa conhecia sobrevive à atualização');
  conf(!eventos.slice(marca).some(e => e.type === 'device.added'),
       'sem device.added repetido no stream');

  // A ordem dos retained entre tópicos é loteria do broker: o estado
  // pode muito bem chegar antes do config. A central guarda o órfão e
  // aplica quando o announce aparecer.
  ponte.publish('nexo/pontes/quadro/estado', JSON.stringify({ tq: 41.5, rssi: -70 }), ret);
  await espera(200);
  ponte.publish('nexo/pontes/quadro/config', JSON.stringify({
    nome: 'Quadro elétrico', area: 'entrada',
    canais: [{ id: 'tq', tipo: 'temperature', nome: 'Temperatura do quadro' }]
  }), ret);
  await espera(300);
  r = await req('GET', '/devices', { token });
  const q = r.corpo.devices.find(x => x.id === uuidDe('ponte', 'quadro'));
  conf(!!q, 'segunda ponte entrou com announce DEPOIS do estado');
  conf(q?.capabilities[0]?.value === 41.5,
       'o estado que chegou antes do config não se perdeu', q?.capabilities[0]);

  secao('Prazo e remoção');

  marca = eventos.length;
  r = await req('POST', `/devices/${idPonte}/capabilities/rele/command`,
    { token, corpo: { type: 'switch', state: false } });
  const cid2 = r.corpo?.commandId;
  await espera(7200);   // ninguém responde: o prazo de 6 s estoura
  const res2 = eventos.slice(marca).find(e => e.type === 'command.result' && e.payload?.commandId === cid2);
  conf(res2?.payload.status === 'failed' && res2?.payload.error === 'device_no_response',
       'comando sem eco em 6 s falha com device_no_response', res2?.payload);

  marca = eventos.length;
  r = await req('DELETE', `/devices/${idPonte}`, { token });
  conf(r.status === 200 || r.status === 204, 'DELETE do aparelho aceito', r.status);
  await espera(300);
  r = await req('GET', '/devices', { token });
  conf(!r.corpo.devices.some(x => x.id === idPonte) && r.corpo.devices.length === 1,
       'o portão saiu da lista — e só ele', r.corpo.devices.map(x => x.name));
  conf(eventos.slice(marca).some(e => e.type === 'device.removed'), 'device.removed no stream');

  // Os retained têm que morrer no broker, senão a ponte "renasce" na
  // próxima subida da central.
  const espiao = mqtt.connect(`mqtt://127.0.0.1:${MQTT_PORTA}`);
  await new Promise(res => espiao.on('connect', res));
  let renasceu = false;
  espiao.subscribe(`${T}/config`);
  espiao.on('message', () => { renasceu = true; });
  await espera(400);
  conf(!renasceu, 'retained de config limpo no broker — remoção é de verdade');
  espiao.end(true);

  ws.close();
} catch (e) {
  nok('exceção no ensaio', e.message);
  console.error(e);
  console.error(saida.join('').slice(-1200));
}

central.kill();
ponte.end(true);
broker.close(); aedes.close();

console.log(`\n  ${total - falhas}/${total} conformes${falhas ? ` — ${falhas} FALHAS` : ''}\n`);
process.exit(falhas ? 1 : 0);
