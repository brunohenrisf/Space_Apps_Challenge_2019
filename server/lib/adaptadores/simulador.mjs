/**
 * Adaptador simulador — mesma interface do Zigbee2MQTT, casa inteira em
 * memória. Serve para três coisas:
 *
 *   · demonstrar o produto sem levar hub nenhum à reunião;
 *   · rodar o teste de conformidade do contrato sem broker;
 *   · exercitar o que quase nunca acontece na bancada e sempre acontece
 *     na casa do cliente — nó que não responde, sensor que some.
 *
 * Um dos aparelhos declara uma capability `air_quality`, que NÃO existe
 * no contrato v1. É de propósito: o §2.3 manda o cliente ignorar tipo
 * desconhecido em silêncio, sem deixar de renderizar o resto do device.
 * Se algum dia alguém quebrar essa regra, o simulador denuncia na hora.
 */
import { uuidDe, agora, sensor } from '../contrato/modelo.mjs';

const cap = (id, type, extra) => ({ id, type, readonly: false, ...extra });

export class AdaptadorSimulador {
  nome = 'simulador';

  #bus; #casa; #porId = new Map(); #timers = [];

  constructor({ casa, bus }) { this.#casa = casa; this.#bus = bus; }

  iniciar() {
    for (const d of this.#semear()) this.#porId.set(d.device.id, d);
    this.#bus.hub(true);

    // Deriva de sensores e consumo: painel parado engana quem avalia.
    this.#timers.push(setInterval(() => {
      this.#mexer('clima-varanda', 'temperature', v => +(v + (Math.random() - .5) * .3).toFixed(1), 14, 34);
      this.#mexer('tomada-geladeira', 'power', v => Math.round(v + (Math.random() - .5) * 14), 92, 146);
    }, 4000));
  }

  parar() { this.#timers.forEach(clearInterval); }

  #mexer(nativo, capId, fn, min, max) {
    const reg = [...this.#porId.values()].find(r => r.nativo === nativo);
    if (!reg) return;
    const c = reg.device.capabilities.find(x => x.id === capId);
    if (!c) return;
    const novo = Math.max(min, Math.min(max, fn(c.value)));
    if (novo === c.value) return;
    c.value = novo;
    reg.device.reachability.lastSeen = agora();
    this.#bus.estado(reg.device.id, capId, { value: novo });
  }

  devices() { return [...this.#porId.values()].map(r => r.device); }

  uuidDoNativo(chave) {
    const id = uuidDe('sim', chave);
    return this.#porId.has(id) ? id : null;
  }

  comandar(id, capId, cmd, commandId) {
    const reg = this.#porId.get(id);
    if (!reg) return false;
    const c = reg.device.capabilities.find(x => x.id === capId);
    if (!c) return false;

    // Latência de rádio de verdade, e um nó no limite da malha que às
    // vezes não volta — é o que obriga a interface a tratar comando que
    // não confirma, em vez de fingir que Zigbee é instantâneo.
    const atraso = 140 + Math.random() * 260;
    const perde = reg.fraco && Math.random() < 0.3;

    setTimeout(() => {
      if (perde) return this.#bus.resultado(commandId, 'failed', 'device_no_response');

      const mudou = {};
      if (cmd.type === 'switch') mudou.state = cmd.toggle ? !c.state : cmd.state;
      if (cmd.type === 'dimmer') {
        mudou.value = cmd.value;
        const sw = reg.device.capabilities.find(x => x.type === 'switch');
        if (sw) { sw.state = cmd.value > 0; this.#bus.estado(id, sw.id, { state: sw.state }); }
      }
      if (cmd.type === 'color_temp') mudou.kelvin = cmd.kelvin;
      if (cmd.type === 'color') { mudou.hue = cmd.hue; mudou.saturation = cmd.saturation; }
      if (cmd.type === 'cover') mudou.position = cmd.action === 'open' ? 100
        : cmd.action === 'close' ? 0 : cmd.action === 'stop' ? c.position : cmd.position;
      if (cmd.type === 'lock') mudou.state = cmd.state;
      if (cmd.type === 'thermostat') {
        if (cmd.targetTemp !== undefined) mudou.targetTemp = cmd.targetTemp;
        if (cmd.mode !== undefined) mudou.mode = cmd.mode;
      }

      Object.assign(c, mudou);
      reg.device.reachability.lastSeen = agora();
      this.#bus.estado(id, capId, mudou);

      // Tomada com medição: ligar a tomada muda o consumo relatado.
      const pot = reg.device.capabilities.find(x => x.measure === 'power');
      if (pot && 'state' in mudou) {
        pot.value = mudou.state ? (reg.watts || 90) : 0;
        this.#bus.estado(id, pot.id, { value: pot.value });
      }

      this.#bus.resultado(commandId, 'applied');
    }, atraso);

    return true;
  }

  parear(seg) {
    if (seg <= 0) return;
    // Depois de metade da janela, aparece um aparelho novo — é assim que
    // o instalador vê o fluxo de pareamento funcionar sem ter o hub.
    this.#timers.push(setTimeout(() => {
      const nativo = 'lampada-nova-' + Math.floor(Math.random() * 900 + 100);
      const d = this.#fazer(nativo, 'Lâmpada nova', null, 'IKEA', 'LED2109G6', 'Lâmpada RGBW E27', [
        cap('switch', 'switch', { state: false }),
        cap('dimmer', 'dimmer', { value: 50 }),
        cap('color_temp', 'color_temp', { kelvin: 2700, minKelvin: 2200, maxKelvin: 6500 }),
        cap('color', 'color', { hue: 30, saturation: 60 })
      ], { signal: 74 });
      this.#porId.set(d.device.id, d);
      this.#bus.adicionado(d.device);
    }, Math.max(1200, seg * 500)));
  }
  pararPareamento() { }

  remover(id) {
    if (!this.#porId.delete(id)) return false;
    this.#bus.removido(id);
    return true;
  }

  /* ── A casa de demonstração ───────────────────────────────────── */
  #fazer(nativo, nome, area, fab, modelo, tipo, capabilities, r = {}) {
    const apelido = this.#casa.devices?.[nativo] || {};
    return {
      nativo, fraco: !!r.fraco, watts: r.watts,
      device: {
        id: uuidDe('sim', nativo),
        name: apelido.name || nome,
        areaId: (apelido.area || area) ? uuidDe('area', apelido.area || area) : null,
        model: { manufacturer: fab, model: modelo, friendlyType: tipo, protocol: 'zigbee' },
        capabilities,
        reachability: { online: true, lastSeen: agora(),
                        signal: r.signal ?? 88, battery: r.battery ?? null },
        createdAt: agora()
      }
    };
  }

  #semear() {
    const L = (k, ...a) => cap(k, ...a);
    return [
      this.#fazer('luz-sala-teto', 'Luz principal', 'sala', 'IKEA', 'LED2109G6', 'Lâmpada RGBW E27', [
        L('switch','switch',{state:true}), L('dimmer','dimmer',{value:64}),
        L('color_temp','color_temp',{kelvin:3000,minKelvin:2200,maxKelvin:6500}),
        L('color','color',{hue:32,saturation:18})
      ], { signal: 92 }),

      this.#fazer('sanca-sala', 'Sanca LED', 'sala', 'Tuya', 'TS0502B', 'Fita LED dimerizável', [
        L('switch','switch',{state:true}), L('dimmer','dimmer',{value:28})
      ], { signal: 84 }),

      this.#fazer('tomada-rack', 'TV e rack', 'sala', 'Tuya', 'TS011F', 'Tomada 16 A com medição', [
        L('switch','switch',{state:true}),
        sensor('power','power',96), sensor('energy','energy',1.42)
      ], { signal: 88, watts: 96 }),

      this.#fazer('cortina-sala', 'Cortina', 'sala', 'Zemismart', 'ZM25TQ', 'Motor de cortina', [
        L('cover','cover',{position:100,tilt:null,moving:'stopped'})
      ], { signal: 79 }),

      this.#fazer('presenca-sala', 'Presença sala', 'sala', 'Aqara', 'RTCGQ11LM', 'Sensor de presença', [
        { id:'occupancy', type:'binary_sensor', measure:'occupancy', state:false, readonly:true },
        sensor('illuminance','illuminance',42)
      ], { signal: 71, battery: 82 }),

      // Interruptor de 3 teclas: UM device, três capabilities switch (§2.1).
      // O usuário vê um objeto na parede, não três.
      this.#fazer('interruptor-sala', 'Interruptor da sala', 'sala', 'Tuya', 'TS0013', 'Interruptor 3 teclas', [
        { id:'switch',    type:'switch', label:'Teto',    state:true,  readonly:false },
        { id:'switch:l2', type:'switch', label:'Sanca',   state:true,  readonly:false },
        { id:'switch:l3', type:'switch', label:'Arandela',state:false, readonly:false }
      ], { signal: 90 }),

      this.#fazer('luz-bancada', 'Luz da bancada', 'cozinha', 'Philips', 'LTA001', 'Lâmpada branco ajustável', [
        L('switch','switch',{state:false}), L('dimmer','dimmer',{value:80}),
        L('color_temp','color_temp',{kelvin:4000,minKelvin:2200,maxKelvin:6500})
      ], { signal: 86 }),

      this.#fazer('tomada-geladeira', 'Geladeira', 'cozinha', 'Tuya', 'TS011F', 'Tomada 16 A com medição', [
        L('switch','switch',{state:true}),
        sensor('power','power',118), sensor('energy','energy',2.86)
      ], { signal: 82, watts: 118 }),

      this.#fazer('vazamento-pia', 'Sensor de vazamento', 'cozinha', 'Aqara', 'SJCGQ11LM', 'Sensor de vazamento', [
        { id:'water_leak', type:'binary_sensor', measure:'water_leak', state:false, readonly:true }
      ], { signal: 64, battery: 91 }),

      this.#fazer('luz-suite', 'Luz do teto', 'suite', 'IKEA', 'LED1949C5', 'Lâmpada branco ajustável', [
        L('switch','switch',{state:false}), L('dimmer','dimmer',{value:55}),
        L('color_temp','color_temp',{kelvin:2700,minKelvin:2200,maxKelvin:6500})
      ], { signal: 89 }),

      this.#fazer('abajur-suite', 'Abajur', 'suite', 'Tuya', 'TS0501B', 'Lâmpada dimerizável', [
        L('switch','switch',{state:false}), L('dimmer','dimmer',{value:22})
      ], { signal: 76 }),

      this.#fazer('ar-suite', 'Ar-condicionado', 'suite', 'Moes', 'BHT-002', 'Termostato', [
        L('thermostat','thermostat',{ currentTemp:24.2, targetTemp:22, minTemp:16, maxTemp:30,
          step:0.5, mode:'off', availableModes:['off','cool','heat','auto'] })
      ], { signal: 81 }),

      this.#fazer('janela-suite', 'Janela', 'suite', 'Aqara', 'MCCGQ11LM', 'Sensor de abertura', [
        { id:'contact', type:'binary_sensor', measure:'contact', state:false, readonly:true }
      ], { signal: 68, battery: 74 }),

      this.#fazer('luz-escritorio', 'Luz do escritório', 'escrit', 'Philips', 'LTA001', 'Lâmpada branco ajustável', [
        L('switch','switch',{state:true}), L('dimmer','dimmer',{value:88}),
        L('color_temp','color_temp',{kelvin:4600,minKelvin:2200,maxKelvin:6500})
      ], { signal: 91 }),

      this.#fazer('tomada-bancada', 'Tomada da bancada', 'escrit', 'Tuya', 'TS011F', 'Tomada 16 A com medição', [
        L('switch','switch',{state:true}),
        sensor('power','power',212), sensor('energy','energy',4.07)
      ], { signal: 85, watts: 212 }),

      this.#fazer('botao-cabeceira', 'Botão da cabeceira', 'suite', 'IKEA', 'E1743', 'Botão de 2 teclas', [
        { id:'action', type:'event', measure:'button',
          supportedEvents:['on','off','brightness_move_up','brightness_move_down'], readonly:true }
      ], { signal: 73, battery: 88 }),

      // Este aqui carrega uma capability FORA do contrato v1. O cliente
      // deve renderizar as duas conhecidas e ignorar a terceira, calado.
      this.#fazer('clima-varanda', 'Estação da varanda', 'varanda', 'Aqara', 'WSDCGQ11LM', 'Sensor de clima', [
        sensor('temperature','temperature',19.4),
        sensor('humidity','humidity',71),
        { id:'air_quality', type:'air_quality', index:42, category:'boa', readonly:true }
      ], { signal: 52, battery: 63 }),

      this.#fazer('fechadura', 'Fechadura', 'entrada', 'Tuya', 'ZS-SF-EU', 'Fechadura eletrônica', [
        L('lock','lock',{state:'locked'})
      ], { signal: 70, battery: 57 }),

      // Nó no limite da malha: existe em toda instalação real, e é a razão
      // de a interface precisar tratar comando que não confirma.
      this.#fazer('luz-portao', 'Luz do portão', 'entrada', 'Tuya', 'TS0502A', 'Lâmpada dimerizável', [
        L('switch','switch',{state:false}), L('dimmer','dimmer',{value:60})
      ], { signal: 18, fraco: true })
    ];
  }
}
