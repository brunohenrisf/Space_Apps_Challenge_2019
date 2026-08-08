/**
 * Adaptador de Pontes de E/S → contrato v1.
 *
 * "Ponte" é qualquer coisa com fio que o Zigbee não alcança — o relé do
 * portão, um dimmer 0–10 V, o contato seco do alarme, uma campainha —
 * pendurada num ESP32 (ou num Arduino com Ethernet, ou num script) que
 * fala uma convenção MQTT de quatro tópicos:
 *
 *   nexo/pontes/<id>/config           retained — a ponte se apresenta
 *   nexo/pontes/<id>/estado           retained — último estado dos canais
 *   nexo/pontes/<id>/evento           efêmero  — botão, campainha
 *   nexo/pontes/<id>/comando          a central manda { canal, valor }
 *   nexo/pontes/<id>/disponibilidade  retained + LWT — "online"/"offline"
 *
 * A convenção completa está em docs/pontes-mqtt.md; o firmware de
 * referência em firmware/nexo-ponte. Diferente do Zigbee, que arrasta
 * legado (contact invertido, brilho 0–254), a convenção já nasce no
 * vocabulário do contrato: percentuais 0–100, true = ativo = aberto.
 * Por isso este adaptador quase não converte — só ancora cada canal
 * numa capability tipada.
 *
 * O cliente não sabe que isto existe. Um portão com fio e uma lâmpada
 * Zigbee chegam no app pelo mesmo GET /devices — é o princípio 1 do
 * contrato pagando o segundo dividendo.
 */
import mqtt from 'mqtt';
import { uuidDe, agora, sensor, rssiParaSinal,
         MEDIDAS_NUMERICAS, MEDIDAS_BINARIAS } from '../contrato/modelo.mjs';

/* ── Canal declarado no config → Capability do contrato ──────────── */

export function canalParaCapability(c) {
  if (!c || typeof c.id !== 'string' || !c.id) return null;
  // "rssi" e "bateria" são as chaves de saúde do relato — um canal com
  // esse id nunca receberia valor. Melhor não nascer do que nascer morto.
  if (c.id === 'rssi' || c.id === 'bateria') return null;
  const rotulo = c.nome ? { label: c.nome } : {};

  if (c.tipo === 'switch')
    return { id: c.id, type: 'switch', state: false, readonly: false, ...rotulo };

  if (c.tipo === 'dimmer')
    return { id: c.id, type: 'dimmer', value: 0, readonly: false, ...rotulo };

  if (c.tipo === 'botao')
    return { id: c.id, type: 'event', measure: 'button',
             supportedEvents: c.eventos || ['single'], readonly: true };

  if (MEDIDAS_NUMERICAS.includes(c.tipo))
    return sensor(c.id, c.tipo, 0, rotulo);

  if (MEDIDAS_BINARIAS.includes(c.tipo))
    return { id: c.id, type: 'binary_sensor', measure: c.tipo,
             state: false, readonly: true, ...rotulo };

  // Tipo que este servidor não conhece: ignora o CANAL, não a ponte —
  // o mesmo espírito da regra do cliente para capability desconhecida.
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   Adaptador
   ═══════════════════════════════════════════════════════════════ */
export class AdaptadorPonte {
  nome = 'pontes';

  #cfg; #casa; #bus; #cliente;
  #base;
  #porUuid  = new Map();     // uuid → { device, ponte }
  #porPonte = new Map();     // ponteId → uuid
  #pendentes = new Map();    // commandId → { uuid, prazo }
  // O broker NÃO garante ordem de retained entre tópicos: o estado pode
  // chegar antes do config no mesmo subscribe. Guarda o órfão e aplica
  // quando o announce aparecer — senão a central abriria "zerada" até o
  // próximo relato da ponte.
  #orfaos = new Map();       // ponteId → { estado?, disponibilidade? }

  constructor({ mqtt: cfg, casa, bus }) {
    this.#cfg = cfg; this.#casa = casa || {}; this.#bus = bus;
    this.#base = cfg.pontes || 'nexo/pontes';
  }

  iniciar() {
    this.#cliente = mqtt.connect(this.#cfg.url, {
      username: this.#cfg.usuario || undefined,
      password: this.#cfg.senha || undefined,
      clientId: 'nexo-pontes', reconnectPeriod: 5000
    });

    this.#cliente.on('connect', () => {
      console.log('[pontes] escutando', `${this.#base}/#`);
      this.#cliente.subscribe(`${this.#base}/+/+`);
    });
    this.#cliente.on('error', e => console.error('[pontes]', e.message));
    this.#cliente.on('message', (t, c) => this.#receber(t, c.toString()));

    setInterval(() => {
      const t = Date.now();
      for (const [cid, p] of this.#pendentes) {
        if (p.prazo > t) continue;
        this.#pendentes.delete(cid);
        this.#bus.resultado(cid, 'failed', 'device_no_response');
      }
    }, 1000).unref?.();
  }

  devices() { return [...this.#porUuid.values()].map(x => x.device); }

  /** casa.json fala no id da ponte ("portao"); o contrato fala em UUID. */
  uuidDoNativo(nome) { return this.#porPonte.get(nome) || null; }

  parar() { try { this.#cliente?.end(true); } catch (_) { } }

  /* ── Entrada ──────────────────────────────────────────────────── */
  #receber(topico, texto) {
    if (!topico.startsWith(this.#base + '/')) return;
    // Um announce honesto tem centenas de bytes. Um retained de megabytes
    // é engano ou abuso — e não vira JSON.parse na memória da central.
    if (texto.length > 65536) return;
    const resto = topico.slice(this.#base.length + 1).split('/');
    if (resto.length !== 2) return;
    const [ponteId, canalTopico] = resto;
    if (!ponteId || canalTopico === 'comando') return;   // eco do que nós publicamos

    if (canalTopico === 'config') {
      // Config retained vazio = ponte removida de vez.
      if (!texto.trim()) return this.#esquecer(ponteId);
      let cfg; try { cfg = JSON.parse(texto); } catch (_) { return; }
      return this.#apresentar(ponteId, cfg);
    }

    const uuid = this.#porPonte.get(ponteId);
    if (!uuid) {
      // Chegou antes do announce (ordem de retained é loteria). Guarda —
      // com teto, para retained alheio não virar memória sem fim. Vazio
      // não é estado: é a limpeza de um retained de remoção passando.
      if ((canalTopico === 'estado' || canalTopico === 'disponibilidade') && texto.trim()) {
        if (this.#orfaos.size >= 64 && !this.#orfaos.has(ponteId)) return;
        const o = this.#orfaos.get(ponteId) || {};
        o[canalTopico] = texto;
        this.#orfaos.set(ponteId, o);
      }
      return;
    }
    const { device } = this.#porUuid.get(uuid);

    if (canalTopico === 'disponibilidade') {
      device.reachability.online = texto.trim() === 'online';
      device.reachability.lastSeen = agora();
      this.#bus.alcance(uuid, device.reachability);
      return;
    }

    if (canalTopico === 'evento') {
      let e; try { e = JSON.parse(texto); } catch (_) { return; }
      const cap = device.capabilities.find(c => c.id === e.canal && c.type === 'event');
      if (cap) this.#bus.evento(uuid, cap.id, String(e.valor ?? 'single'));
      device.reachability.lastSeen = agora();
      return;
    }

    if (canalTopico === 'estado') {
      let z; try { z = JSON.parse(texto); } catch (_) { return; }
      this.#aplicarRelato(uuid, device, z);
    }
  }

  /** O announce (config retained) vira — ou atualiza — um Device. */
  #apresentar(ponteId, cfg) {
    const uuid = uuidDe('ponte', ponteId);
    const jaTinha = this.#porUuid.has(uuid);
    // Teto de sanidade: pontes se contam nos dedos. Uma enxurrada de
    // announces só pode ser engano (ou abuso) — e não vira memória.
    if (!jaTinha && this.#porUuid.size >= 128) {
      console.warn(`[pontes] limite de 128 pontes atingido; ignorando "${ponteId}"`);
      return;
    }
    // O instalador pode renomear pelo casa.json sem reflashar a ponte.
    const apelido = this.#casa.devices?.[ponteId] || {};
    const areaKey = apelido.area || cfg.area || null;

    // A convenção exige id único por canal; se a ponte descumprir, o
    // PRIMEIRO vale — dois controles disputando o mesmo id só confunde.
    const porId = new Map();
    for (const cap of (Array.isArray(cfg.canais) ? cfg.canais : [])
        .map(canalParaCapability).filter(Boolean))
      if (!porId.has(cap.id)) porId.set(cap.id, cap);

    const device = {
      id: uuid,
      name: apelido.name || cfg.nome || ponteId,
      areaId: areaKey ? uuidDe('area', areaKey) : null,
      model: {
        manufacturer: cfg.fabricante || 'Nexo',
        model: cfg.modelo || 'Ponte de E/S',
        friendlyType: cfg.descricao || 'Ponte com fio',
        protocol: 'ponte'
      },
      capabilities: [...porId.values()],
      reachability: { online: true, lastSeen: agora(), signal: null, battery: null },
      createdAt: agora()
    };

    if (jaTinha) {
      // Announce repetido (reconexão da ponte) conserva estado e história.
      const antigo = this.#porUuid.get(uuid).device;
      for (const cap of device.capabilities) {
        const velho = antigo.capabilities.find(c => c.id === cap.id && c.type === cap.type);
        if (velho) Object.assign(cap, velho, { id: cap.id, type: cap.type });
      }
      device.reachability = antigo.reachability;
      device.createdAt = antigo.createdAt;
    }

    this.#porUuid.set(uuid, { device, ponte: ponteId });
    this.#porPonte.set(ponteId, uuid);
    if (!jaTinha) this.#bus.adicionado(device);

    // O que chegou antes do announce entra agora, na ordem certa.
    const orfao = this.#orfaos.get(ponteId);
    if (orfao) {
      this.#orfaos.delete(ponteId);
      if (orfao.estado) {
        try { this.#aplicarRelato(uuid, device, JSON.parse(orfao.estado)); } catch (_) { }
      }
      if (orfao.disponibilidade) {
        device.reachability.online = orfao.disponibilidade.trim() === 'online';
        this.#bus.alcance(uuid, device.reachability);
      }
    }
  }

  /** Estado da ponte → deltas de capability. A convenção já fala a
   *  língua do contrato, então aqui não há tabela de tradução — cada
   *  chave é o id de um canal, mais as duas de saúde (rssi, bateria). */
  #aplicarRelato(uuid, device, z) {
    const emitir = (c, changes) => { Object.assign(c, changes); this.#bus.estado(uuid, c.id, changes); };

    for (const [chave, valor] of Object.entries(z)) {
      if (chave === 'rssi') {
        device.reachability.signal = rssiParaSinal(valor);
        continue;
      }
      if (chave === 'bateria') {
        device.reachability.battery = Number.isFinite(valor) ? valor : null;
        continue;
      }

      const c = device.capabilities.find(x => x.id === chave);
      if (!c) continue;
      if (c.type === 'switch')             emitir(c, { state: !!valor });
      else if (c.type === 'dimmer')        emitir(c, { value: Math.max(0, Math.min(100, Math.round(+valor || 0))) });
      else if (c.type === 'sensor')        { if (Number.isFinite(+valor)) emitir(c, { value: +valor }); }
      else if (c.type === 'binary_sensor') emitir(c, { state: !!valor });
      // event não guarda estado: chega pelo tópico /evento.
    }

    device.reachability.lastSeen = agora();
    device.reachability.online = true;
    this.#bus.alcance(uuid, device.reachability);
    this.#resolverPendentes(uuid);
  }

  #resolverPendentes(uuid) {
    for (const [cid, p] of this.#pendentes) {
      if (p.uuid !== uuid) continue;
      this.#pendentes.delete(cid);
      this.#bus.resultado(cid, 'applied');
    }
  }

  #esquecer(ponteId) {
    const uuid = this.#porPonte.get(ponteId);
    if (!uuid) return;
    this.#porPonte.delete(ponteId);
    this.#porUuid.delete(uuid);
    this.#bus.removido(uuid);
  }

  /* ── Saída ────────────────────────────────────────────────────── */
  comandar(uuid, capId, cmd, commandId) {
    const reg = this.#porUuid.get(uuid);
    if (!reg) return false;
    const cap = reg.device.capabilities.find(c => c.id === capId);
    if (!cap) return false;

    let valor;
    switch (cmd.type) {
      case 'switch': valor = cmd.toggle ? !cap.state : !!cmd.state; break;
      case 'dimmer': valor = cmd.value; break;
      default: return false;               // ponte v1 só liga e regula
    }

    this.#cliente.publish(`${this.#base}/${reg.ponte}/comando`,
      JSON.stringify({ canal: capId, valor }));
    // Wi-Fi local responde rápido; 6 s sem eco de estado é falha.
    this.#pendentes.set(commandId, { uuid, prazo: Date.now() + 6000 });
    return true;
  }

  /** Pontes não pareiam por rádio: instalar é espetar e anunciar. */
  parear() { }
  pararPareamento() { }

  remover(uuid) {
    const reg = this.#porUuid.get(uuid);
    if (!reg) return false;
    // Limpa os retained para a ponte não "renascer" na próxima subida.
    for (const t of ['config', 'estado', 'disponibilidade'])
      this.#cliente.publish(`${this.#base}/${reg.ponte}/${t}`, '', { retain: true });
    this.#esquecer(reg.ponte);
    return true;
  }
}
