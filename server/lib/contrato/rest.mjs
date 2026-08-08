/**
 * REST do contrato v1 (§5).
 *
 * Regras que valem para o arquivo inteiro:
 *  · REST muta, WebSocket notifica. Nenhuma rota aqui devolve estado que
 *    o cliente deveria estar recebendo pelo stream.
 *  · Comando responde 202, não 200: foi aceito e despachado. A confirmação
 *    real chega por `command.result` quando o aparelho responder.
 *  · Erro sempre no formato do §7: { error, message } — o cliente ramifica
 *    por `error`, que é estável; `message` é texto para gente ler e pode
 *    mudar sem aviso.
 */
import { gzipSync } from 'node:zlib';
import { novoUuid, acharCap, validarComando } from './modelo.mjs';
import { podeFazer, podeVerDevice, filtrarDevices } from './auth.mjs';

const MAX_CORPO = 256 * 1024;

const json = (res, codigo, corpo, gz = false) => {
  let buf = Buffer.from(JSON.stringify(corpo));
  const cab = { 'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store' };
  // GET /devices de uma casa cheia passa de 50 KB; comprimir corta ~85%
  // e num Pi que também roda o Zigbee2MQTT isso se nota no Wi-Fi.
  if (gz && buf.length > 1024) { buf = gzipSync(buf); cab['content-encoding'] = 'gzip'; }
  res.writeHead(codigo, cab);
  res.end(buf);
};
const erro = (res, codigo, error, message, details) =>
  json(res, codigo, { error, message, ...(details ? { details } : {}) });

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tamanho = 0; const partes = [];
    req.on('data', c => {
      tamanho += c.length;
      if (tamanho > MAX_CORPO) { reject(new Error('too_large')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch (_) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

/** Casa o caminho contra um padrão com :parâmetros. */
function casar(padrao, caminho) {
  const p = padrao.split('/'), c = caminho.split('/');
  if (p.length !== c.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(c[i]);
    else if (p[i] !== c[i]) return null;
  }
  return params;
}

/* Freio de força bruta nas rotas públicas de credencial. Janela deslizante
 * por IP: 15 POSTs por minuto dá folga para uma família inteira errar a
 * senha e ainda transforma um ataque de dicionário em séculos. */
const tentativas = new Map();
function estourou(ip) {
  const agora = Date.now();
  const arr = (tentativas.get(ip) || []).filter(t => agora - t < 60_000);
  arr.push(agora);
  tentativas.set(ip, arr);
  return arr.length > 15;
}
setInterval(() => {
  const agora = Date.now();
  for (const [ip, arr] of tentativas) {
    const vivas = arr.filter(t => agora - t < 60_000);
    vivas.length ? tentativas.set(ip, vivas) : tentativas.delete(ip);
  }
}, 120_000).unref?.();

export function criarRest({ auth, central }) {
  const rotas = [];
  const rota = (metodo, padrao, opcoes, mao) => rotas.push({ metodo, padrao, ...opcoes, mao });

  /* Healthcheck do contêiner e diagnóstico de bancada. Público e mínimo:
     não revela nada que quem já está na LAN não veja de outro jeito. */
  rota('GET', '/health', { publico: true }, async () =>
    ({ codigo: 200, corpo: central.saude() }));

  /* ── Descoberta e pareamento (§4) ─────────────────────────────── */

  /* Adição ao contrato: o navegador não faz mDNS, então o PWA não tem
     como ler o TXT `setup=<0|1>` do §4. Sem isto ele não sabe se deve
     mostrar "criar conta" ou "entrar". Público de propósito — não revela
     nada que quem já está na LAN não descubra sozinho. */
  rota('GET', '/setup/status', { publico: true }, () => ({
    codigo: 200, corpo: { setup: auth.virgem ? 1 : 0, homeId: auth.homeId,
                          homeName: auth.virgem ? null : auth.homeName, version: 1 }
  }));

  rota('POST', '/setup/claim', { publico: true }, async (ctx) => {
    const r = auth.reivindicar(ctx.corpo);
    if (r.erro === 'already_claimed')
      return { codigo: 409, corpo: { error: 'already_claimed',
        message: 'Esta central já tem dono. Peça um convite a quem a instalou.' } };
    if (r.erro)
      return { codigo: 400, corpo: { error: r.erro, message: r.msg || 'Dados inválidos.' } };
    return { codigo: 201, corpo: r.par };
  });

  rota('POST', '/auth/login', { publico: true }, async (ctx) => {
    const par = auth.entrar(ctx.corpo.email, ctx.corpo.password);
    return par ? { codigo: 200, corpo: par }
               : { codigo: 401, corpo: { error: 'invalid_credentials',
                     message: 'E-mail ou senha incorretos.' } };
  });

  rota('POST', '/auth/refresh', { publico: true }, async (ctx) => {
    const par = auth.renovar(ctx.corpo.refreshToken);
    return par ? { codigo: 200, corpo: par }
               : { codigo: 401, corpo: { error: 'invalid_refresh',
                     message: 'Sessão expirada. Entre novamente.' } };
  });

  rota('POST', '/auth/logout', { publico: true }, async (ctx) => {
    auth.sair(ctx.corpo.refreshToken);
    return { codigo: 204 };
  });

  rota('POST', '/auth/redeem', { publico: true }, async (ctx) => {
    const r = auth.resgatar(ctx.corpo);
    if (r.erro === 'invalid_code') return { codigo: 400, corpo: { error: 'invalid_code',
      message: 'Convite inválido.' } };
    if (r.erro === 'expired_code') return { codigo: 400, corpo: { error: 'expired_code',
      message: 'Este convite expirou. Peça outro.' } };
    if (r.erro) return { codigo: 400, corpo: { error: r.erro, message: r.msg || 'Dados inválidos.' } };
    return { codigo: 201, corpo: r.par };
  });

  rota('POST', '/invites', { permissao: 'gerenciarUsuarios' }, async (ctx) =>
    ({ codigo: 201, corpo: auth.criarConvite(ctx.corpo || {}) }));

  rota('GET', '/users', { permissao: 'gerenciarUsuarios' }, async () =>
    ({ codigo: 200, corpo: { users: auth.usuarios() } }));

  /* ── Leitura (§5.1) ───────────────────────────────────────────── */

  rota('GET', '/home', {}, async () => ({ codigo: 200, corpo: central.home() }));

  rota('GET', '/devices', {}, async (ctx) =>
    ({ codigo: 200, corpo: { devices: filtrarDevices(ctx.claims, central.devices()) } }));

  rota('GET', '/devices/:id', {}, async (ctx) => {
    if (!podeVerDevice(ctx.claims, ctx.params.id)) return naoEncontrado();
    const d = central.device(ctx.params.id);
    return d ? { codigo: 200, corpo: d } : naoEncontrado();
  });

  /* ── Comandos (§5.2) ──────────────────────────────────────────── */

  rota('POST', '/devices/:deviceId/capabilities/:capabilityId/command', {}, async (ctx) => {
    const r = despachar(ctx.claims, ctx.params.deviceId, ctx.params.capabilityId, ctx.corpo);
    return r.aceito
      ? { codigo: 202, corpo: { commandId: r.commandId, accepted: true } }
      : { codigo: r.http, corpo: { error: r.error, message: r.message } };
  });

  /* ── Lote (§5.3) ──────────────────────────────────────────────── */

  rota('POST', '/commands/batch', {}, async (ctx) => {
    const lista = Array.isArray(ctx.corpo?.commands) ? ctx.corpo.commands : null;
    if (!lista) return { codigo: 400, corpo: { error: 'invalid_payload',
      message: 'Esperado um array "commands".' } };
    if (lista.length > 128) return { codigo: 400, corpo: { error: 'batch_too_large',
      message: 'No máximo 128 comandos por lote.' } };

    const results = lista.map(item => {
      const r = despachar(ctx.claims, item.deviceId, item.capabilityId, item.command);
      return r.aceito ? { accepted: true, commandId: r.commandId }
                      : { accepted: false, error: r.error };
    });
    // 207: o lote pode ter sucesso parcial, e o cliente precisa saber
    // exatamente qual linha falhou.
    return { codigo: 207, corpo: { results } };
  });

  /** Um caminho só para comando avulso e em lote — a validação não pode
   *  divergir entre os dois, ou o lote vira porta dos fundos. */
  function despachar(claims, deviceId, capabilityId, comando) {
    if (!podeFazer(claims, 'controlar'))
      return { http: 403, error: 'forbidden', message: 'Sem permissão para controlar.' };
    if (!podeVerDevice(claims, deviceId))
      return { http: 403, error: 'forbidden', message: 'Este dispositivo não está liberado para você.' };

    const device = central.device(deviceId);
    if (!device) return { http: 404, error: 'not_found', message: 'Dispositivo não encontrado.' };

    const cap = acharCap(device, capabilityId);
    if (!cap) return { http: 404, error: 'not_found', message: 'Função não encontrada neste dispositivo.' };

    if (!device.reachability.online)
      return { http: 503, error: 'device_offline', message: `${device.name} está fora do ar.` };

    const v = validarComando(cap, comando);
    if (!v.ok) return { http: v.http, error: v.erro, message: v.msg };

    const commandId = novoUuid();
    return central.comandar(deviceId, capabilityId, comando, commandId)
      ? { aceito: true, commandId }
      : { http: 503, error: 'dispatch_failed', message: 'A central não conseguiu despachar o comando.' };
  }

  /* ── Gestão (§5.4) ────────────────────────────────────────────── */

  rota('PATCH', '/devices/:id', { permissao: 'editarAutomacao' }, async (ctx) => {
    const d = central.renomear(ctx.params.id, ctx.corpo);
    return d ? { codigo: 200, corpo: d } : naoEncontrado();
  });

  rota('DELETE', '/devices/:id', { permissao: 'gerenciarUsuarios' }, async (ctx) =>
    central.remover(ctx.params.id) ? { codigo: 204 } : naoEncontrado());

  rota('POST', '/areas', { permissao: 'editarAutomacao' }, async (ctx) =>
    ({ codigo: 201, corpo: central.criarArea(ctx.corpo) }));

  rota('PATCH', '/areas/:id', { permissao: 'editarAutomacao' }, async (ctx) => {
    const a = central.editarArea(ctx.params.id, ctx.corpo);
    return a ? { codigo: 200, corpo: a } : naoEncontrado();
  });

  rota('DELETE', '/areas/:id', { permissao: 'editarAutomacao' }, async (ctx) =>
    central.apagarArea(ctx.params.id) ? { codigo: 204 } : naoEncontrado());

  rota('POST', '/pairing/start', { permissao: 'gerenciarUsuarios' }, async (ctx) => {
    // Rede aberta sem prazo é falha de segurança: qualquer aparelho na
    // vizinhança entra. O teto de 5 min não é negociável pelo cliente.
    const seg = Math.min(Math.max(Number(ctx.corpo?.durationSec) || 120, 10), 300);
    central.parear(seg);
    return { codigo: 202, corpo: { durationSec: seg } };
  });

  rota('POST', '/pairing/stop', { permissao: 'gerenciarUsuarios' }, async () => {
    central.pararPareamento();
    return { codigo: 204 };
  });

  /* ── Histórico (§5.5) ─────────────────────────────────────────── */

  rota('GET', '/devices/:id/history', { permissao: 'verHistorico' }, async (ctx) => {
    if (!podeVerDevice(ctx.claims, ctx.params.id)) return naoEncontrado();
    const { capabilityId, from, to, bucket } = ctx.query;
    if (!capabilityId) return { codigo: 400, corpo: { error: 'invalid_payload',
      message: 'Informe "capabilityId".' } };
    return { codigo: 200,
             corpo: { points: central.historico(ctx.params.id, capabilityId, { from, to, bucket }) } };
  });

  /* ── Extensões além do contrato revisado ──────────────────────── */
  /* O §9 deixa cenas e automações em aberto. A posição aqui é: recurso
     próprio do BFF, não delegado ao engine do backend — assim a UI não
     fica amarrada ao formato de automação do Home Assistant, e trocar o
     backend não leva junto as rotinas da família. Marcado como extensão
     para ninguém confundir com o contrato acordado. */

  rota('POST', '/devices/:id/favorite', {}, async (ctx) => {
    if (!podeVerDevice(ctx.claims, ctx.params.id)) return naoEncontrado();
    return central.favoritar(ctx.params.id, !!ctx.corpo?.favorite)
      ? { codigo: 204 } : naoEncontrado();
  });

  rota('GET', '/scenes', {}, async () => ({ codigo: 200, corpo: { scenes: central.cenas() } }));

  rota('POST', '/scenes/:id/activate', {}, async (ctx) => {
    const r = central.ativarCena(ctx.params.id, ctx.claims);
    return r ? { codigo: 202, corpo: r } : naoEncontrado();
  });

  rota('GET', '/modes', {}, async () => ({ codigo: 200, corpo: central.modos() }));

  rota('PUT', '/modes/current', { permissao: 'editarAutomacao' }, async (ctx) => {
    const m = central.trocarModo(ctx.corpo?.mode);
    return m ? { codigo: 200, corpo: { mode: m } }
             : { codigo: 400, corpo: { error: 'invalid_mode', message: 'Modo desconhecido.' } };
  });

  rota('GET', '/automations', { permissao: 'editarAutomacao' }, async () =>
    ({ codigo: 200, corpo: { automations: central.automacoes() } }));

  rota('PATCH', '/automations/:id', { permissao: 'editarAutomacao' }, async (ctx) => {
    const a = central.editarAutomacao(ctx.params.id, ctx.corpo);
    return a ? { codigo: 200, corpo: a } : naoEncontrado();
  });

  rota('GET', '/suggestions', { permissao: 'editarAutomacao' }, async () =>
    ({ codigo: 200, corpo: { suggestions: central.sugestoes() } }));

  rota('POST', '/suggestions/:id/decide', { permissao: 'editarAutomacao' }, async (ctx) => {
    const ok = central.decidirSugestao(ctx.params.id, ctx.corpo?.decision);
    return ok ? { codigo: 204 } : naoEncontrado();
  });

  const naoEncontrado = () => ({ codigo: 404,
    corpo: { error: 'not_found', message: 'Recurso não encontrado.' } });

  /* ── Despacho ─────────────────────────────────────────────────── */
  return async function tratar(req, res, url) {
    if (!url.pathname.startsWith('/api/v1')) return false;
    const caminho = url.pathname.slice('/api/v1'.length) || '/';

    for (const r of rotas) {
      if (r.metodo !== req.method) continue;
      const params = casar(r.padrao, caminho);
      if (!params) continue;

      if (r.publico && req.method === 'POST' &&
          estourou(req.socket.remoteAddress || '?')) {
        erro(res, 429, 'rate_limited', 'Muitas tentativas. Aguarde um minuto.');
        return true;
      }

      let claims = null;
      if (!r.publico) {
        const cab = req.headers.authorization || '';
        claims = cab.startsWith('Bearer ') ? auth.verificarAccess(cab.slice(7)) : null;
        if (!claims) { erro(res, 401, 'unauthorized', 'Faça login para continuar.'); return true; }
        if (r.permissao && !podeFazer(claims, r.permissao)) {
          erro(res, 403, 'forbidden', 'Seu perfil não permite esta ação.'); return true;
        }
      }

      let corpo = {};
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        try { corpo = await lerCorpo(req); }
        catch (e) {
          erro(res, 400, e.message === 'too_large' ? 'payload_too_large' : 'invalid_json',
               e.message === 'too_large' ? 'Corpo grande demais.' : 'JSON inválido.');
          return true;
        }
      }

      try {
        const out = await r.mao({ params, corpo, claims,
                                  query: Object.fromEntries(url.searchParams) });
        if (out.codigo === 204) { res.writeHead(204); res.end(); }
        else json(res, out.codigo, out.corpo,
                  (req.headers['accept-encoding'] || '').includes('gzip'));
      } catch (e) {
        console.error('[rest]', r.padrao, e);
        erro(res, 500, 'internal_error', 'Algo falhou na central.');
      }
      return true;
    }

    erro(res, 404, 'not_found', 'Rota não encontrada.');
    return true;
  };
}
