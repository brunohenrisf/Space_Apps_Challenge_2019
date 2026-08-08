/**
 * Adaptador Zigbee2MQTT → contrato v1.
 *
 * Todo adaptador implementa a mesma interface:
 *
 *   iniciar()                        começa a falar com o backend
 *   devices()                        Device[] no formato do contrato
 *   comandar(devId, capId, cmd)      despacha; a confirmação vem por evento
 *   parear(segundos) / pararPareamento()
 *   remover(devId)
 *
 * e avisa a central por `bus`:
 *
 *   bus.estado(devId, capId, changes)   delta parcial
 *   bus.alcance(devId, reachability)
 *   bus.evento(devId, capId, evento)    stateless (botão, cena)
 *   bus.adicionado(device) / bus.removido(devId)
 *   bus.hub(online)
 *   bus.resultado(commandId, status, erro)
 *
 * Trocar isto por um adaptador de Home Assistant não toca em nenhuma
 * outra parte do servidor, e muito menos no cliente. É o princípio 1 do
 * contrato virando estrutura de arquivo.
 */
import mqtt from 'mqtt';
import {
  uuidDe, agora, briParaPct, pctParaBri, miredParaK, kParaMired,
  lqiParaSinal, xyParaHs, sensor, UNIDADE
} from '../contrato/modelo.mjs';

/* ═══════════════════════════════════════════════════════════════
   exposes → Capability[]
   O coração do "capability sobre modelo": as funções do aparelho saem
   do que o Zigbee2MQTT declara, não de uma lista que alguém manteve à
   mão. Lâmpada nova entra na casa e aparece na tela sem deploy de app.
   ═══════════════════════════════════════════════════════════════ */

/** Sufixo de canal: interruptor de 3 teclas vira switch, switch:l2, switch:l3. */
const comCanal = (base, ep) => (ep ? `${base}:${ep}` : base);

function daLuz(ex, caps) {
  const ep = ex.endpoint;
  const f = n => ex.features?.find(x => x.name === n);

  if (f('state')) caps.push({ id: comCanal('switch', ep), type: 'switch',
    state: false, readonly: false, ...(ex.label ? { label: ex.label } : {}) });

  if (f('brightness')) caps.push({ id: comCanal('dimmer', ep), type: 'dimmer',
    value: 0, readonly: false });

  const ct = f('color_temp');
  if (ct) {
    // O Zigbee declara a faixa em mireds e invertida: mired maior = mais
    // quente. O cliente só vê Kelvin, e crescente.
    const minMired = ct.value_min ?? 153, maxMired = ct.value_max ?? 500;
    caps.push({ id: comCanal('color_temp', ep), type: 'color_temp',
      kelvin: miredParaK(Math.round((minMired + maxMired) / 2)),
      minKelvin: miredParaK(maxMired), maxKelvin: miredParaK(minMired), readonly: false });
  }

  if (f('color_xy') || f('color_hs')) caps.push({ id: comCanal('color', ep), type: 'color',
    hue: 0, saturation: 0, readonly: false });
}

function daClimatizacao(ex, caps) {
  const f = n => ex.features?.find(x => x.name === n);
  const alvo = f('occupied_heating_setpoint') || f('occupied_cooling_setpoint');
  const modo = f('system_mode');
  caps.push({
    id: comCanal('thermostat', ex.endpoint), type: 'thermostat',
    currentTemp: 0, targetTemp: alvo?.value_min ?? 20,
    minTemp: alvo?.value_min ?? 5, maxTemp: alvo?.value_max ?? 35,
    step: alvo?.value_step ?? 0.5, mode: 'off',
    availableModes: (modo?.values || ['off','heat']).filter(v =>
      ['off','heat','cool','auto'].includes(v)),
    readonly: false
  });
}

/**
 * Bateria e qualidade de enlace NÃO viram capability (§8). São saúde do
 * aparelho, não função. Se virassem, toda lâmpada a pilha apareceria na
 * tela como uma lista de três sensores.
 */
const SAUDE = new Set(['battery', 'linkquality', 'voltage_battery']);

export function exposesParaCapabilities(exposes = []) {
  const caps = [];

  for (const ex of exposes) {
    switch (ex.type) {
      case 'light':  daLuz(ex, caps); break;
      case 'climate':daClimatizacao(ex, caps); break;

      case 'switch': {
        const ep = ex.endpoint;
        caps.push({ id: comCanal('switch', ep), type: 'switch', state: false,
          readonly: false, ...(ex.label ? { label: ex.label } : {}) });
        break;
      }

      case 'cover':
        caps.push({ id: comCanal('cover', ex.endpoint), type: 'cover',
          position: 0, tilt: ex.features?.some(f => f.name === 'tilt') ? 0 : null,
          moving: 'stopped', readonly: false });
        break;

      case 'lock':
        caps.push({ id: comCanal('lock', ex.endpoint), type: 'lock',
          state: 'unknown', readonly: false });
        break;

      case 'numeric': {
        if (SAUDE.has(ex.property)) break;
        const medida = MEDIDA_NUMERICA[ex.property];
        if (!medida) break;                       // grandeza que não sabemos exibir
        caps.push(sensor(ex.property, medida, 0,
          ex.unit ? { unit: ex.unit, precision: UNIDADE[medida]?.precision ?? 1 } : {}));
        break;
      }

      case 'binary': {
        const medida = MEDIDA_BINARIA[ex.property];
        if (!medida) break;
        caps.push({ id: ex.property, type: 'binary_sensor', measure: medida,
          state: false, readonly: true });
        break;
      }

      case 'enum':
        // 'action' é o botão: stateless, só emite evento.
        if (ex.property === 'action') {
          caps.push({ id: 'action', type: 'event', measure: 'button',
            supportedEvents: ex.values || [], readonly: true });
        }
        break;

      case 'composite':
      case 'text':
      default:
        break;   // nada que o contrato v1 saiba exibir
    }
  }
  return caps;
}

const MEDIDA_NUMERICA = {
  temperature:'temperature', humidity:'humidity', illuminance:'illuminance',
  illuminance_lux:'illuminance', pressure:'pressure', co2:'co2', voc:'voc',
  pm25:'pm25', power:'power', energy:'energy', voltage:'voltage', current:'current'
};

const MEDIDA_BINARIA = {
  contact:'contact', occupancy:'occupancy', motion:'motion', presence:'occupancy',
  water_leak:'water_leak', smoke:'smoke', gas:'gas', vibration:'vibration', tamper:'tamper'
};

/* ═══════════════════════════════════════════════════════════════
   Adaptador
   ═══════════════════════════════════════════════════════════════ */
export class AdaptadorZigbee2Mqtt {
  nome = 'zigbee2mqtt';

  #cfg; #bus; #cliente; #casa;
  #porUuid = new Map();      // uuid → { device, z2m }
  #porZ2m  = new Map();      // friendly_name → uuid
  #pendentes = new Map();    // commandId → { uuid, capId, esperado, prazo }

  constructor({ mqtt: cfg, casa, bus }) {
    this.#cfg = cfg; this.#casa = casa; this.#bus = bus;
  }

  iniciar() {
    this.#cliente = mqtt.connect(this.#cfg.url, {
      username: this.#cfg.usuario || undefined,
      password: this.#cfg.senha || undefined,
      clientId: 'nexo-central', reconnectPeriod: 5000
    });

    this.#cliente.on('connect', () => {
      console.log('[z2m] conectado a', this.#cfg.url);
      this.#cliente.subscribe([
        `${this.#cfg.base}/+`, `${this.#cfg.base}/+/+`,
        `${this.#cfg.base}/bridge/state`, `${this.#cfg.base}/bridge/devices`,
        `${this.#cfg.base}/bridge/event`
      ]);
    });
    this.#cliente.on('error',   e => console.error('[z2m]', e.message));
    this.#cliente.on('offline', () => this.#bus.hub(false));
    this.#cliente.on('message', (t, c) => this.#receber(t, c.toString()));

    // Comando que não confirma dentro do prazo é falha. O cliente precisa
    // saber: ele está mostrando o estado otimista desde o toque.
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

  /** Chave nativa (friendly_name) → UUID do contrato. A configuração da
   *  casa é escrita por gente, então fala em nomes; o contrato fala em
   *  UUID. A tradução é aqui e em nenhum outro lugar. */
  uuidDoNativo(nome) { return this.#porZ2m.get(nome) || null; }

  parar() { try { this.#cliente?.end(true); } catch (_) { } }

  /* ── Entrada ──────────────────────────────────────────────────── */
  #receber(topico, texto) {
    const base = this.#cfg.base;

    if (topico === `${base}/bridge/state`) return this.#bus.hub(texto.includes('online'));

    if (topico === `${base}/bridge/devices`) {
      try { this.#sincronizar(JSON.parse(texto)); } catch (_) { }
      return;
    }
    if (topico === `${base}/bridge/event`) {
      try {
        const e = JSON.parse(texto);
        if (e.type === 'device_leave') {
          const uuid = this.#porZ2m.get(e.data?.friendly_name);
          if (uuid) { this.#porUuid.delete(uuid); this.#porZ2m.delete(e.data.friendly_name);
                      this.#bus.removido(uuid); }
        }
      } catch (_) { }
      return;
    }
    if (topico.startsWith(`${base}/bridge/`)) return;

    const nome = topico.slice(base.length + 1);
    if (nome.endsWith('/set') || nome.endsWith('/get')) return;

    const uuid = this.#porZ2m.get(nome);
    if (!uuid) return;
    let z; try { z = JSON.parse(texto); } catch (_) { return; }
    this.#aplicarRelato(uuid, z);
  }

  /** bridge/devices é a lista viva da malha: entra device, sai device. */
  #sincronizar(lista) {
    const vistos = new Set();

    for (const d of lista) {
      if (d.type === 'Coordinator' || !d.supported) continue;
      const nome = d.friendly_name;
      vistos.add(nome);

      // O id vem do IEEE, não do apelido: renomear no Z2M não pode trocar
      // a identidade do aparelho para o cliente.
      const uuid = uuidDe('z2m', d.ieee_address || nome);
      const jaTinha = this.#porUuid.has(uuid);
      const apelido = this.#casa.devices?.[nome] || {};

      const device = {
        id: uuid,
        name: apelido.name || nome,
        areaId: apelido.area ? uuidDe('area', apelido.area) : null,
        model: {
          manufacturer: d.manufacturer || d.definition?.vendor || 'desconhecido',
          model: d.model_id || d.definition?.model || '—',
          friendlyType: d.definition?.description || 'Dispositivo Zigbee',
          protocol: 'zigbee'
        },
        capabilities: exposesParaCapabilities(d.definition?.exposes || []),
        reachability: {
          online: !d.disabled, lastSeen: agora(),
          signal: null, battery: d.power_source === 'Battery' ? null : undefined
        },
        createdAt: agora()
      };
      if (device.reachability.battery === undefined) delete device.reachability.battery;
      if (!('battery' in device.reachability)) device.reachability.battery = null;

      // Aparelho já conhecido conserva o estado que veio dos relatos.
      if (jaTinha) {
        const antigo = this.#porUuid.get(uuid).device;
        for (const cap of device.capabilities) {
          const velho = antigo.capabilities.find(c => c.id === cap.id);
          if (velho) Object.assign(cap, velho, { id: cap.id, type: cap.type });
        }
        device.reachability = antigo.reachability;
        device.createdAt = antigo.createdAt;
      }

      this.#porUuid.set(uuid, { device, z2m: nome });
      this.#porZ2m.set(nome, uuid);
      if (!jaTinha) this.#bus.adicionado(device);
    }

    for (const [nome, uuid] of [...this.#porZ2m]) {
      if (vistos.has(nome)) continue;
      this.#porZ2m.delete(nome); this.#porUuid.delete(uuid);
      this.#bus.removido(uuid);
    }
  }

  /** Relato do aparelho → deltas de capability, já normalizados. */
  #aplicarRelato(uuid, z) {
    const reg = this.#porUuid.get(uuid);
    if (!reg) return;
    const { device } = reg;
    const cap = id => device.capabilities.find(c => c.id === id);
    const emitir = (c, changes) => { Object.assign(c, changes); this.#bus.estado(uuid, c.id, changes); };

    for (const [chave, valor] of Object.entries(z)) {
      // Multi-canal: state_l2 → capability switch:l2
      const m = /^([a-z_]+?)(?:_(l\d|left|right|center))?$/.exec(chave);
      const ep = m?.[2];

      if (m?.[1] === 'state') {
        const c = cap(comCanal('switch', ep)) || cap(comCanal('lock', ep));
        if (!c) continue;
        if (c.type === 'lock') emitir(c, { state: valor === 'LOCK' ? 'locked' : 'unlocked' });
        else emitir(c, { state: valor === 'ON' });
        continue;
      }
      if (m?.[1] === 'brightness') { const c = cap(comCanal('dimmer', ep)); if (c) emitir(c, { value: briParaPct(valor) }); continue; }
      if (chave === 'color_temp')  { const c = cap('color_temp'); if (c) emitir(c, { kelvin: miredParaK(valor) }); continue; }
      if (chave === 'color')       { const c = cap('color');
        if (c && valor?.x != null) emitir(c, xyParaHs(valor.x, valor.y));
        else if (c && valor?.hue != null) emitir(c, { hue: Math.round(valor.hue), saturation: Math.round(valor.saturation) });
        continue; }
      if (chave === 'position')    { const c = cap('cover'); if (c) emitir(c, { position: valor }); continue; }
      if (chave === 'tilt')        { const c = cap('cover'); if (c) emitir(c, { tilt: valor }); continue; }
      if (chave === 'moving')      { const c = cap('cover'); if (c) emitir(c, { moving: String(valor).toLowerCase() }); continue; }

      if (chave === 'local_temperature')          { const c = cap('thermostat'); if (c) emitir(c, { currentTemp: valor }); continue; }
      if (chave.endsWith('_setpoint'))            { const c = cap('thermostat'); if (c) emitir(c, { targetTemp: valor }); continue; }
      if (chave === 'system_mode')                { const c = cap('thermostat'); if (c) emitir(c, { mode: valor }); continue; }

      // Saúde do aparelho: vai para reachability, não vira capability.
      if (chave === 'linkquality') {
        device.reachability.signal = lqiParaSinal(valor);
        device.reachability.lastSeen = agora(); device.reachability.online = true;
        this.#bus.alcance(uuid, device.reachability); continue;
      }
      if (chave === 'battery') {
        device.reachability.battery = valor;
        this.#bus.alcance(uuid, device.reachability); continue;
      }

      // Botão: stateless. Emite evento e não guarda valor.
      if (chave === 'action' && valor) {
        const c = cap('action'); if (c) this.#bus.evento(uuid, c.id, String(valor));
        continue;
      }

      const c = cap(chave);
      if (c?.type === 'sensor')        emitir(c, { value: valor });
      else if (c?.type === 'binary_sensor')
        // O Zigbee reporta contact=true com a porta FECHADA. O contrato diz
        // que state=true é o estado "ativo" — aberto. Inverte aqui.
        emitir(c, { state: c.measure === 'contact' ? !valor : !!valor });
    }

    device.reachability.lastSeen = agora();
    this.#resolverPendentes(uuid);
  }

  #resolverPendentes(uuid) {
    for (const [cid, p] of this.#pendentes) {
      if (p.uuid !== uuid) continue;
      this.#pendentes.delete(cid);
      this.#bus.resultado(cid, 'applied');
    }
  }

  /* ── Saída ────────────────────────────────────────────────────── */
  comandar(uuid, capId, cmd, commandId) {
    const reg = this.#porUuid.get(uuid);
    if (!reg) return false;
    const cap = reg.device.capabilities.find(c => c.id === capId);
    if (!cap) return false;

    const ep = capId.includes(':') ? capId.split(':')[1] : null;
    const suf = ep ? `_${ep}` : '';
    const p = {};

    switch (cmd.type) {
      case 'switch':
        p[`state${suf}`] = cmd.toggle ? 'TOGGLE' : (cmd.state ? 'ON' : 'OFF'); break;
      case 'dimmer':
        p[`brightness${suf}`] = pctParaBri(cmd.value);
        if (cmd.value > 0) p[`state${suf}`] = 'ON';
        break;
      case 'color_temp': p.color_temp = kParaMired(cmd.kelvin); break;
      case 'color':      p.color = { hue: cmd.hue, saturation: cmd.saturation }; break;
      case 'cover':
        if (cmd.action) p.state = cmd.action.toUpperCase();
        else p.position = cmd.position;
        break;
      case 'thermostat':
        if (cmd.targetTemp !== undefined) p.occupied_heating_setpoint = cmd.targetTemp;
        if (cmd.mode !== undefined) p.system_mode = cmd.mode;
        break;
      case 'lock': p.state = cmd.state === 'locked' ? 'LOCK' : 'UNLOCK'; break;
      default: return false;
    }

    if (cmd.transition !== undefined) p.transition = cmd.transition;

    this.#cliente.publish(`${this.#cfg.base}/${reg.z2m}/set`, JSON.stringify(p));
    // 6 s cobre um roteado lento; além disso é falha de verdade.
    this.#pendentes.set(commandId, { uuid, capId, prazo: Date.now() + 6000 });
    return true;
  }

  parear(segundos) {
    this.#cliente.publish(`${this.#cfg.base}/bridge/request/permit_join`,
      JSON.stringify({ value: segundos > 0, time: segundos }));
  }
  pararPareamento() { this.parear(0); }

  remover(uuid) {
    const reg = this.#porUuid.get(uuid);
    if (!reg) return false;
    this.#cliente.publish(`${this.#cfg.base}/bridge/request/device/remove`,
      JSON.stringify({ id: reg.z2m }));
    return true;
  }
}
