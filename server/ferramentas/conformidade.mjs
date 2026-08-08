/**
 * Teste de conformidade do contrato v1.
 *
 *   node server/ferramentas/conformidade.mjs
 *
 * Sobe a central com o adaptador simulador e confere, cláusula por
 * cláusula, o que o documento promete: normalização de unidade, códigos
 * de status, rotação de refresh, filtragem de convidado no servidor,
 * handshake do WebSocket, tolerância a capability desconhecida.
 *
 * Se um dia alguém "otimizar" o BFF devolvendo brightness 0–254 porque
 * é o que o Zigbee manda, é aqui que o erro aparece — não na casa do
 * cliente três meses depois.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORTA = 8123;
const BASE = `http://127.0.0.1:${PORTA}/api/v1`;
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

/* ── Sobe a central ─────────────────────────────────────────────── */
const dados = join(RAIZ, 'server', 'dados', 'conformidade');
rmSync(dados, { recursive: true, force: true });
writeFileSync('/tmp/conf-nexo.json', JSON.stringify({ porta: PORTA, adaptador: 'simulador', dados }));

const central = spawn('node', [join(RAIZ, 'server', 'nexo.mjs')],
  { env: { ...process.env, NEXO_CONFIG: '/tmp/conf-nexo.json' }, stdio: ['ignore', 'pipe', 'pipe'] });
const saida = [];
central.stdout.on('data', d => saida.push(d.toString()));
central.stderr.on('data', d => saida.push('ERR ' + d.toString()));
await espera(1500);

try {
  /* ═══ §4 — Pareamento ═══════════════════════════════════════════ */
  secao('§4 Pareamento e primeiro acesso');

  let r = await req('GET', '/setup/status');
  conf(r.status === 200 && r.corpo.setup === 1, 'central virgem anuncia setup=1', r.corpo);

  r = await req('POST', '/setup/claim',
    { corpo: { name: 'Bruno', email: 'bruno@casa.test', password: 'senhaforte1', homeName: 'Casa Ribeiro' } });
  conf(r.status === 201, 'claim devolve 201', r.status);
  conf(r.corpo?.accessToken && r.corpo?.refreshToken && r.corpo?.expiresIn === 900,
       'claim devolve TokenPair com TTL de 15 min', r.corpo?.expiresIn);
  const dono = r.corpo;

  r = await req('POST', '/setup/claim',
    { corpo: { name: 'Invasor', email: 'x@y.z', password: 'senhaforte1' } });
  conf(r.status === 409 && r.corpo.error === 'already_claimed',
       'segundo claim é 409 already_claimed — a janela fecha para sempre', r.corpo);

  r = await req('GET', '/setup/status');
  conf(r.corpo.setup === 0 && r.corpo.homeName === 'Casa Ribeiro', 'setup=0 depois do claim');

  /* ═══ §3 — Autenticação ═════════════════════════════════════════ */
  secao('§3 Autenticação');

  conf((await req('GET', '/devices')).status === 401, 'sem token: 401');
  conf((await req('GET', '/devices', { token: 'lixo' })).status === 401, 'token inválido: 401');

  // alg:none é o ataque clássico contra JWT mal verificado.
  const [, corpoJwt] = dono.accessToken.split('.');
  const falso = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${corpoJwt}.`;
  conf((await req('GET', '/devices', { token: falso })).status === 401, 'alg:none rejeitado');

  r = await req('POST', '/auth/login', { corpo: { email: 'bruno@casa.test', password: 'errada' } });
  conf(r.status === 401 && r.corpo.error === 'invalid_credentials', 'senha errada: invalid_credentials');

  r = await req('POST', '/auth/login', { corpo: { email: 'bruno@casa.test', password: 'senhaforte1' } });
  conf(r.status === 200 && r.corpo.accessToken, 'login correto devolve TokenPair');
  const sessao = r.corpo;

  // Rotação e detecção de reuso (§4.1).
  r = await req('POST', '/auth/refresh', { corpo: { refreshToken: sessao.refreshToken } });
  conf(r.status === 200 && r.corpo.refreshToken !== sessao.refreshToken,
       'refresh rotaciona o token');
  const renovado = r.corpo;

  r = await req('POST', '/auth/refresh', { corpo: { refreshToken: sessao.refreshToken } });
  conf(r.status === 401 && r.corpo.error === 'invalid_refresh',
       'refresh já consumido: 401');

  r = await req('POST', '/auth/refresh', { corpo: { refreshToken: renovado.refreshToken } });
  conf(r.status === 401,
       'reuso derruba a família inteira, inclusive o token bom — vazamento não se distingue de cópia');

  const token = dono.accessToken;

  /* ═══ §2 e §5.1 — Modelo e leitura ══════════════════════════════ */
  secao('§2 Modelo de dados e §5.1 leitura');

  r = await req('GET', '/home', { token });
  conf(r.status === 200 && Array.isArray(r.corpo.areas) && r.corpo.timezone === 'America/Sao_Paulo',
       `Home com ${r.corpo?.areas?.length} cômodos e timezone IANA`);

  r = await req('GET', '/devices', { token });
  const devices = r.corpo.devices;
  conf(r.status === 200 && devices.length > 10, `GET /devices devolve ${devices.length} aparelhos`);

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  conf(devices.every(d => uuid.test(d.id)), 'todo device tem UUID');
  conf(devices.every(d => d.model?.manufacturer && d.model?.friendlyType && d.model?.protocol),
       'todo device declara DeviceModel completo');
  conf(devices.every(d => typeof d.reachability?.online === 'boolean' && d.reachability.lastSeen),
       'todo device declara Reachability');

  const luz = devices.find(d => d.name === 'Luz principal');
  const cap = (d, t) => d.capabilities.find(c => c.type === t);

  /* A regra que mais importa: unidade de exibição na fronteira. */
  secao('§2.3 Normalização — a regra que a primeira exceção destrói');

  const dim = cap(luz, 'dimmer');
  conf(dim && dim.value >= 0 && dim.value <= 100, `dimmer em 0–100 (${dim?.value}), nunca 0–254`);

  const ct = cap(luz, 'color_temp');
  conf(ct && ct.kelvin > 1500 && ct.kelvin < 8000, `color_temp em Kelvin (${ct?.kelvin}K), nunca mired`);
  conf(ct && ct.minKelvin < ct.maxKelvin, `faixa crescente: ${ct?.minKelvin}–${ct?.maxKelvin}K`);

  const cor = cap(luz, 'color');
  conf(cor && cor.hue >= 0 && cor.hue <= 360 && cor.saturation >= 0 && cor.saturation <= 100,
       'color em hue 0–360 / saturation 0–100');

  conf(devices.every(d => d.reachability.signal === null ||
       (d.reachability.signal >= 0 && d.reachability.signal <= 100)),
       'signal normalizado 0–100, nunca LQI 0–255');

  conf(!devices.some(d => d.capabilities.some(c =>
        ['battery', 'linkquality'].includes(c.id))),
       '§8: bateria e linkquality NÃO viram capability — vão para Reachability');

  const sensorBat = devices.find(d => d.reachability.battery !== null);
  conf(sensorBat && sensorBat.reachability.battery >= 0 && sensorBat.reachability.battery <= 100,
       `bateria em Reachability (${sensorBat?.name}: ${sensorBat?.reachability.battery}%)`);

  const temp = devices.flatMap(d => d.capabilities).find(c => c.measure === 'temperature');
  conf(temp?.unit === '°C' && Number.isInteger(temp?.precision),
       `sensor traz unit e precision (${temp?.unit}, ${temp?.precision} casas)`);

  /* §2.1 — multi-canal é UM device */
  secao('§2.1 Multi-canal');
  const trio = devices.find(d => d.capabilities.filter(c => c.type === 'switch').length === 3);
  conf(trio, 'interruptor de 3 teclas é UM device, não três');
  conf(trio?.capabilities.filter(c => c.type === 'switch').every(c => c.label),
       'cada canal traz label própria', trio?.capabilities.map(c => c.label));
  conf(new Set(trio?.capabilities.map(c => c.id)).size === trio?.capabilities.length,
       'ids de capability únicos dentro do device');

  /* §2.3 — capability desconhecida atravessa intacta */
  const estranha = devices.flatMap(d => d.capabilities).find(c => c.type === 'air_quality');
  conf(estranha, 'capability fora do contrato atravessa o BFF sem ser podada — quem ignora é o cliente');

  /* ═══ §5.2 — Comandos ═══════════════════════════════════════════ */
  secao('§5.2 Comandos');

  r = await req('POST', `/devices/${luz.id}/capabilities/dimmer/command`,
    { token, corpo: { type: 'dimmer', value: 42 } });
  conf(r.status === 202, 'comando responde 202 Accepted, não 200', r.status);
  conf(r.corpo?.commandId && r.corpo?.accepted === true, 'resposta traz commandId e accepted');
  const commandId = r.corpo.commandId;

  r = await req('POST', `/devices/${luz.id}/capabilities/dimmer/command`,
    { token, corpo: { type: 'dimmer', value: 150 } });
  conf(r.status === 400 && r.corpo.error, `valor fora da faixa: 400 ${r.corpo?.error}`);

  r = await req('POST', `/devices/${luz.id}/capabilities/dimmer/command`,
    { token, corpo: { type: 'switch', state: true } });
  conf(r.status === 400, 'comando de tipo diferente da capability: 400');

  const estacao = devices.find(d => d.capabilities.some(c => c.measure === 'temperature'));
  r = await req('POST', `/devices/${estacao.id}/capabilities/temperature/command`,
    { token, corpo: { type: 'sensor', value: 20 } });
  conf(r.status === 409 && r.corpo.error === 'capability_readonly',
       'capability readonly: 409', r.corpo);

  r = await req('POST', `/devices/${luz.id}/capabilities/naoexiste/command`,
    { token, corpo: { type: 'switch', state: true } });
  conf(r.status === 404, 'capability inexistente: 404');

  r = await req('POST', '/devices/00000000-0000-4000-8000-000000000000/capabilities/switch/command',
    { token, corpo: { type: 'switch', state: true } });
  conf(r.status === 404, 'device inexistente: 404');

  conf(Object.keys((await req('GET', '/devices', { token })).corpo).length >= 1 &&
       typeof (await req('POST', `/devices/${luz.id}/capabilities/switch/command`,
         { token, corpo: {} })).status === 'number', 'payload vazio não derruba a central');

  /* ═══ §5.3 — Lote ═══════════════════════════════════════════════ */
  secao('§5.3 Lote');
  r = await req('POST', '/commands/batch', { token, corpo: { commands: [
    { deviceId: luz.id, capabilityId: 'switch', command: { type: 'switch', state: true } },
    { deviceId: luz.id, capabilityId: 'dimmer', command: { type: 'dimmer', value: 40 } },
    { deviceId: luz.id, capabilityId: 'dimmer', command: { type: 'dimmer', value: 999 } }
  ] } });
  conf(r.status === 207, 'lote responde 207 Multi-Status', r.status);
  conf(r.corpo.results.length === 3 && r.corpo.results[0].accepted &&
       r.corpo.results[2].accepted === false,
       'sucesso parcial: o cliente vê qual linha falhou', r.corpo.results);

  /* ═══ §6 — WebSocket ════════════════════════════════════════════ */
  secao('§6 WebSocket');

  const eventos = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORTA}/api/v1/stream`);
  await new Promise(res => ws.on('open', res));
  ws.on('message', d => eventos.push(JSON.parse(d)));

  ws.send(JSON.stringify({ type: 'auth', token }));
  await espera(300);
  conf(eventos[0]?.type === 'auth.ok' && eventos[0]?.serverTime,
       'auth na primeira mensagem devolve auth.ok com serverTime');

  // O lote do §5.3 ainda pode estar em voo — o simulador tem latência de
  // rádio de verdade. Marca a posição para não ler o delta do comando
  // anterior e concluir a coisa errada.
  await espera(700);
  const marca = eventos.length;
  const r2 = await req('POST', `/devices/${luz.id}/capabilities/dimmer/command`,
    { token, corpo: { type: 'dimmer', value: 77 } });
  await espera(900);

  const mudanca = eventos.slice(marca).find(e => e.type === 'state.changed' &&
    e.payload.deviceId === luz.id && e.payload.capabilityId === 'dimmer');
  conf(mudanca, 'state.changed chega pelo stream');
  conf(mudanca && Object.keys(mudanca.payload.changes).length <= 2 &&
       !mudanca.payload.changes.type,
       'delta parcial: só o que mudou, nunca o Device inteiro', mudanca?.payload.changes);
  conf(mudanca?.payload.changes.value === 77, 'o delta traz o valor normalizado');

  const resultado = eventos.slice(marca).find(e => e.type === 'command.result' &&
    e.payload.commandId === r2.corpo.commandId);
  conf(resultado?.payload.status === 'applied',
       'command.result confirma o comando aceito com 202', resultado?.payload);

  const seqs = eventos.filter(e => e.seq !== undefined).map(e => e.seq);
  conf(seqs.every((v, i) => i === 0 || v > seqs[i - 1]), 'seq monotônico por conexão');
  conf(eventos.filter(e => e.ts).every(e => !Number.isNaN(Date.parse(e.ts))), 'ts em ISO-8601');

  // Nó fraco: comando que não volta vira failed, e o cliente precisa saber
  // porque está mostrando estado otimista desde o toque.
  const portao = devices.find(d => d.name === 'Luz do portão');
  let viuFalha = false;
  for (let i = 0; i < 12 && !viuFalha; i++) {
    const c = await req('POST', `/devices/${portao.id}/capabilities/switch/command`,
      { token, corpo: { type: 'switch', toggle: true } });
    await espera(500);
    viuFalha = eventos.some(e => e.type === 'command.result' &&
      e.payload.commandId === c.corpo?.commandId && e.payload.status === 'failed');
  }
  conf(viuFalha, 'nó no limite da malha reporta command.result failed');

  ws.close();

  // Handshake: quem não se identifica em 5 s cai.
  const mudo = new WebSocket(`ws://127.0.0.1:${PORTA}/api/v1/stream`);
  await new Promise(res => mudo.on('open', res));
  const fechou = await Promise.race([
    new Promise(res => mudo.on('close', c => res(c))),
    espera(7000).then(() => null)
  ]);
  conf(fechou === 4401, 'conexão sem auth em 5 s é fechada com 4401', fechou);

  /* ═══ §3.2 — Papéis ═════════════════════════════════════════════ */
  secao('§3.2 Papéis e escopo do convidado');

  const permitido = devices.find(d => d.name === 'Luz da bancada');
  r = await req('POST', '/invites', { token, corpo: { role: 'guest', allowedDeviceIds: [permitido.id] } });
  conf(r.status === 201 && r.corpo.code, `convite de convidado criado (${r.corpo?.code})`);

  r = await req('POST', '/auth/redeem', { corpo: { code: r.corpo.code, name: 'Visita',
    email: 'visita@casa.test', password: 'senhaforte1' } });
  conf(r.status === 201, 'convite resgatado');
  const visita = r.corpo.accessToken;

  r = await req('GET', '/devices', { token: visita });
  conf(r.corpo.devices.length === 1 && r.corpo.devices[0].id === permitido.id,
       `convidado vê só o que foi liberado (${r.corpo.devices.length} de ${devices.length})`);

  r = await req('POST', `/devices/${luz.id}/capabilities/switch/command`,
    { token: visita, corpo: { type: 'switch', state: true } });
  conf(r.status === 403, 'convidado comandando fora do escopo: 403 — barrado no SERVIDOR', r.status);

  r = await req('POST', `/devices/${permitido.id}/capabilities/switch/command`,
    { token: visita, corpo: { type: 'switch', state: true } });
  conf(r.status === 202, 'convidado comanda o que lhe foi liberado');

  conf((await req('GET', `/devices/${luz.id}/history?capabilityId=power`, { token: visita })).status === 403,
       'convidado não vê histórico: 403');
  conf((await req('POST', '/invites', { token: visita, corpo: {} })).status === 403,
       'convidado não cria convite: 403');

  /* ═══ §5.4, §5.5 e §7 ═══════════════════════════════════════════ */
  secao('§5.4 Gestão, §5.5 histórico, §7 erros');

  r = await req('PATCH', `/devices/${luz.id}`, { token, corpo: { name: 'Lustre da sala' } });
  conf(r.status === 200 && r.corpo.name === 'Lustre da sala', 'PATCH renomeia o device');

  r = await req('POST', '/pairing/start', { token, corpo: { durationSec: 9999 } });
  conf(r.status === 202 && r.corpo.durationSec <= 300,
       `pairing sempre com teto (${r.corpo?.durationSec}s) — rede aberta sem prazo é falha`);

  const tomada = devices.find(d => d.capabilities.some(c => c.measure === 'power'));
  r = await req('GET', `/devices/${tomada.id}/history?capabilityId=power&bucket=1h`, { token });
  conf(r.status === 200 && Array.isArray(r.corpo.points), 'histórico devolve série de pontos');

  r = await req('GET', `/devices/${tomada.id}/history`, { token });
  conf(r.status === 400, 'histórico sem capabilityId: 400');

  r = await req('GET', '/naoexiste', { token });
  conf(r.status === 404 && typeof r.corpo.error === 'string' && typeof r.corpo.message === 'string',
       '§7: todo erro traz { error, message }', r.corpo);
  conf(/[áàâãéêíóôõúç]/i.test(r.corpo.message) || r.corpo.message.includes('não'),
       'message em pt-BR para exibir, error estável para ramificar');

  /* ═══ §9 — Extensões ════════════════════════════════════════════ */
  secao('§9 Extensões do BFF (cenas, modos, automações)');

  r = await req('GET', '/scenes', { token });
  conf(r.status === 200 && r.corpo.scenes.length >= 4, `${r.corpo?.scenes?.length} cenas`);

  r = await req('POST', '/scenes/boanoite/activate', { token });
  conf(r.status === 202 && r.corpo.commandIds.length > 0,
       `cena vira ${r.corpo?.commandIds?.length} comandos num round-trip só`);

  r = await req('PUT', '/modes/current', { token, corpo: { mode: 'dormindo' } });
  conf(r.status === 200 && r.corpo.mode === 'dormindo', 'modo da casa alterado');

  r = await req('GET', '/automations', { token });
  const dormindo = r.corpo.automations.find(a => a.id === 'a2');
  conf(dormindo && dormindo.activeNow === false,
       'automação fora do modo atual reporta activeNow=false');

  r = await req('PUT', '/modes/current', { token, corpo: { mode: 'inventado' } });
  conf(r.status === 400, 'modo desconhecido: 400');

} catch (e) {
  nok('exceção durante o teste', e.message);
  console.error(e);
}

central.kill();
await espera(200);
if (falhas) console.log('\n' + saida.join(''));
console.log(`\n  ${total - falhas}/${total} conformes${falhas ? ` — ${falhas} FALHA(S)` : ''}\n`);
process.exit(falhas ? 1 : 0);
