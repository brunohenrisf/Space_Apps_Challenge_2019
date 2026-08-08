/**
 * Modelo do contrato v1 — tipos, normalização e validação de comandos.
 *
 * Esta é a fronteira. Tudo que atravessa daqui para o cliente já está em
 * unidade de exibição: percentual 0–100, temperatura de cor em Kelvin,
 * temperatura ambiente em °C, sinal 0–100. As unidades do rádio (0–254,
 * mireds, xy, LQI 0–255) morrem aqui.
 *
 * "Sem exceção — a primeira exceção vira dez." Por isso as conversões
 * ficam em funções nomeadas neste arquivo e em nenhum outro: quando
 * alguém precisar de um valor cru, vai ter que vir aqui e explicar.
 */
import { createHash, randomUUID } from 'node:crypto';

/* ── Identidade ──────────────────────────────────────────────────── */

/**
 * UUID determinístico a partir de (espaço, nome nativo).
 *
 * O contrato pede id "estável, gerado pela central". Sortear um UUIDv4 e
 * guardar num banco funcionaria, mas derivar do identificador nativo faz
 * o id sobreviver a reinício, a restauração de backup e a troca de
 * cartão SD sem estado nenhum para manter. Mesmo formato de um UUIDv5.
 */
export function uuidDe(espaco, nome) {
  const h = createHash('sha1').update(`${espaco}:${nome}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;   // versão 5
  h[8] = (h[8] & 0x3f) | 0x80;   // variante RFC 4122
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20,32)}`;
}

export const novoUuid = randomUUID;
export const agora = () => new Date().toISOString();

/* ── Normalização ────────────────────────────────────────────────── */

const limitar = (n, a, b) => (n < a ? a : n > b ? b : n);

/** Zigbee 0–254 → 0–100. O cliente nunca vê 254. */
export const briParaPct = b => limitar(Math.round((b / 254) * 100), 0, 100);
export const pctParaBri = p => limitar(Math.round((p / 100) * 254), 0, 254);

/** Mireds ↔ Kelvin. O cliente nunca vê mired. */
export const miredParaK = m => Math.round(1e6 / m);
export const kParaMired = k => Math.round(1e6 / k);

/**
 * LQI 0–255 → sinal 0–100.
 *
 * Não é regra de três: LQI abaixo de ~40 já é um enlace ruim e acima de
 * ~180 a diferença não se percebe. A curva achata as pontas para que a
 * barrinha na tela signifique alguma coisa para quem está instalando.
 */
export function lqiParaSinal(lqi) {
  if (!Number.isFinite(lqi)) return null;
  const x = limitar(lqi, 0, 255);
  if (x <= 40)  return Math.round((x / 40) * 25);
  if (x >= 180) return Math.round(90 + ((x - 180) / 75) * 10);
  return Math.round(25 + ((x - 40) / 140) * 65);
}

/** xy CIE 1931 → HS. Aproximação suficiente para um seletor de cor. */
export function xyParaHs(x, y, brilho = 1) {
  const z = 1 - x - y;
  const Y = brilho, X = (Y / y) * x, Z = (Y / y) * z;
  let r =  X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b =  X * 0.051713 - Y * 0.121364 + Z * 1.011530;
  const gama = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1/2.4) - 0.055);
  [r, g, b] = [r, g, b].map(c => limitar(gama(Math.max(0, c)), 0, 1));
  return rgbParaHs(r, g, b);
}

export function rgbParaHs(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
  }
  return { hue: Math.round(((h * 60) + 360) % 360), saturation: Math.round((max ? d / max : 0) * 100) };
}

/* ── Capabilities ────────────────────────────────────────────────── */

/**
 * Tipos que o contrato v1 define. Um adaptador pode emitir tipo fora
 * desta lista; o cliente é obrigado a ignorar em silêncio. A lista existe
 * para documentar e para o teste de conformidade, não para barrar.
 */
export const TIPOS = Object.freeze([
  'switch', 'dimmer', 'color_temp', 'color', 'cover',
  'thermostat', 'sensor', 'binary_sensor', 'event', 'lock'
]);

export const MEDIDAS_NUMERICAS = Object.freeze([
  'temperature', 'humidity', 'illuminance', 'pressure',
  'co2', 'voc', 'pm25', 'power', 'energy', 'voltage', 'current'
]);

export const MEDIDAS_BINARIAS = Object.freeze([
  'contact', 'occupancy', 'motion', 'water_leak',
  'smoke', 'gas', 'vibration', 'tamper'
]);

/** Unidade e precisão convencionais de cada medida numérica. */
export const UNIDADE = Object.freeze({
  temperature:{ unit:'°C',  precision:1 }, humidity:  { unit:'%',   precision:0 },
  illuminance:{ unit:'lx',  precision:0 }, pressure:  { unit:'hPa', precision:0 },
  co2:        { unit:'ppm', precision:0 }, voc:       { unit:'ppb', precision:0 },
  pm25:       { unit:'µg/m³',precision:0 }, power:    { unit:'W',   precision:0 },
  energy:     { unit:'kWh', precision:2 }, voltage:   { unit:'V',   precision:0 },
  current:    { unit:'A',   precision:2 }
});

export const sensor = (id, measure, value, extra = {}) => ({
  id, type: 'sensor', measure, value,
  ...UNIDADE[measure], readonly: true, ...extra
});

/* ── Validação de comandos (§5.2) ────────────────────────────────── */

const num = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;

/**
 * Confere o comando contra a capability alvo.
 * Devolve { ok } ou { erro, http } com o código estável do §7.
 *
 * A validação é do lado do servidor porque o cliente é substituível: um
 * PWA velho em cache, um script de teste ou um integrador terceiro batem
 * na mesma porta.
 */
export function validarComando(cap, cmd) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string')
    return { erro: 'invalid_payload', http: 400, msg: 'Comando sem tipo.' };

  if (cap.readonly)
    return { erro: 'capability_readonly', http: 409,
             msg: 'Esta função é somente leitura.' };

  if (cmd.type !== cap.type)
    return { erro: 'type_mismatch', http: 400,
             msg: `Comando "${cmd.type}" não vale para uma função "${cap.type}".` };

  const mal = m => ({ erro: 'invalid_payload', http: 400, msg: m });

  switch (cap.type) {
    case 'switch':
      if (cmd.toggle === true) return { ok: true };
      if (typeof cmd.state !== 'boolean') return mal('Esperado "state" booleano ou "toggle": true.');
      return { ok: true };

    case 'dimmer':
      if (!num(cmd.value, 0, 100)) return mal('Brilho deve ficar entre 0 e 100.');
      break;

    case 'color_temp':
      if (!num(cmd.kelvin, cap.minKelvin, cap.maxKelvin))
        return mal(`Temperatura de cor deve ficar entre ${cap.minKelvin}K e ${cap.maxKelvin}K.`);
      break;

    case 'color':
      if (!num(cmd.hue, 0, 360))       return mal('Matiz deve ficar entre 0 e 360.');
      if (!num(cmd.saturation, 0, 100))return mal('Saturação deve ficar entre 0 e 100.');
      break;

    case 'cover':
      if (cmd.action !== undefined) {
        if (!['open','close','stop'].includes(cmd.action)) return mal('Ação inválida para cortina.');
        return { ok: true };
      }
      if (!num(cmd.position, 0, 100)) return mal('Posição deve ficar entre 0 e 100.');
      break;

    case 'thermostat': {
      if (cmd.targetTemp === undefined && cmd.mode === undefined)
        return mal('Informe "targetTemp", "mode" ou ambos.');
      if (cmd.targetTemp !== undefined && !num(cmd.targetTemp, cap.minTemp, cap.maxTemp))
        return mal(`Temperatura alvo deve ficar entre ${cap.minTemp}°C e ${cap.maxTemp}°C.`);
      if (cmd.mode !== undefined && !cap.availableModes.includes(cmd.mode))
        return mal(`Modo "${cmd.mode}" não é suportado por este aparelho.`);
      return { ok: true };
    }

    case 'lock':
      if (!['locked','unlocked'].includes(cmd.state)) return mal('Estado deve ser "locked" ou "unlocked".');
      return { ok: true };

    default:
      // Capability sem comando definido (sensor, binary_sensor, event).
      return { erro: 'capability_readonly', http: 409, msg: 'Esta função é somente leitura.' };
  }

  if (cmd.transition !== undefined && !num(cmd.transition, 0, 3600))
    return mal('Transição deve ficar entre 0 e 3600 segundos.');

  return { ok: true };
}

/** Busca uma capability dentro do device. */
export const acharCap = (device, capId) =>
  device?.capabilities.find(c => c.id === capId) || null;
