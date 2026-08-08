/**
 * WebSocket do contrato v1 (§6).
 *
 * Autenticação na primeira mensagem, e não em header: o navegador não
 * deixa mandar header customizado no handshake de WebSocket. Cinco
 * segundos para se identificar, senão a conexão cai — assim ninguém
 * segura socket aberto de graça.
 *
 * Envelope com `seq` monotônico por conexão. Ele não serve para replay
 * (§6.4 dispensa buffer), serve para o cliente perceber que perdeu
 * mensagem e refazer o GET /devices.
 */
import { WebSocketServer } from 'ws';
import { agora } from './modelo.mjs';
import { podeVerDevice } from './auth.mjs';

const PRAZO_AUTH = 5_000;
const PING       = 30_000;
const PACIENCIA  = 60_000;

export function criarStream({ servidor, auth }) {
  const wss = new WebSocketServer({ server: servidor, path: '/api/v1/stream' });
  const sessoes = new Map();   // ws → { claims, seq, vivoEm }

  wss.on('connection', (ws) => {
    const s = { claims: null, seq: 0, vivoEm: Date.now() };
    sessoes.set(ws, s);

    const corte = setTimeout(() => {
      if (!s.claims) ws.close(4401, 'auth_timeout');
    }, PRAZO_AUTH);

    ws.on('pong', () => { s.vivoEm = Date.now(); });

    ws.on('message', (dados) => {
      let m; try { m = JSON.parse(dados); } catch (_) { return; }

      if (m.type === 'auth') {
        const claims = auth.verificarAccess(m.token);
        if (!claims) { ws.close(4401, 'invalid_token'); return; }
        s.claims = claims;
        clearTimeout(corte);
        ws.send(JSON.stringify({ type: 'auth.ok', serverTime: agora() }));
        return;
      }

      // Nada além de auth entra pelo stream: ação é REST (§ princípio 4).
      // Um segundo caminho de mutação seria um segundo lugar para esquecer
      // de validar permissão.
      if (!s.claims) { ws.close(4401, 'unauthenticated'); return; }
      if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', serverTime: agora() }));
    });

    ws.on('close', () => { clearTimeout(corte); sessoes.delete(ws); });
    ws.on('error', () => { try { ws.close(); } catch (_) { } });
  });

  const bater = setInterval(() => {
    const limite = Date.now() - PACIENCIA;
    for (const [ws, s] of sessoes) {
      if (s.vivoEm < limite) { ws.terminate(); sessoes.delete(ws); continue; }
      try { ws.ping(); } catch (_) { }
    }
  }, PING);
  bater.unref?.();

  /**
   * Difunde um evento. `alvo` é o deviceId quando o evento fala de um
   * dispositivo — é por ele que o convidado é filtrado, no servidor.
   * Filtrar só na tela deixaria o estado da casa inteira num socket que
   * o convidado já tem aberto.
   */
  function emitir(type, payload, alvo = null) {
    for (const [ws, s] of sessoes) {
      if (ws.readyState !== 1 || !s.claims) continue;
      if (alvo && !podeVerDevice(s.claims, alvo)) continue;
      try {
        ws.send(JSON.stringify({ type, seq: ++s.seq, ts: agora(), payload }));
      } catch (_) { }
    }
  }

  return {
    emitir,
    get conectados() { return [...sessoes.values()].filter(s => s.claims).length; },

    /* Os eventos do §6.3, com nome próprio para o resto do código não
       precisar decorar string. */
    estadoMudou: (deviceId, capabilityId, changes) =>
      emitir('state.changed', { deviceId, capabilityId, changes }, deviceId),
    alcance: (deviceId, reachability) =>
      emitir('device.reachability', { deviceId, reachability }, deviceId),
    eventoDe: (deviceId, capabilityId, event) =>
      emitir('device.event', { deviceId, capabilityId, event }, deviceId),
    adicionado: (device) => emitir('device.added', { device }, device.id),
    removido:   (deviceId) => emitir('device.removed', { deviceId }, deviceId),
    resultado:  (commandId, status, error) =>
      emitir('command.result', { commandId, status, ...(error ? { error } : {}) }),

    fechar() { clearInterval(bater); wss.close(); }
  };
}
