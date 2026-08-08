/**
 * Nascer e pôr do sol, calculados localmente — sem internet, sem API.
 *
 * É o que permite à automação "acender a varanda no pôr do sol" continuar
 * certa em junho e em dezembro, sem ninguém reajustar horário. Algoritmo
 * do Almanac for Computers (o mesmo que a NOAA publica em forma
 * simplificada); erro típico de ±2 min, irrelevante para acender lâmpada.
 *
 * A conversão para hora local usa o fuso do processo (TZ do contêiner),
 * então o resultado já vem em minuto-do-dia local, pronto para comparar
 * com o relógio do agendador.
 */

const RAD = Math.PI / 180;
const sen = g => Math.sin(g * RAD);
const cos = g => Math.cos(g * RAD);
const mod = (n, m) => ((n % m) + m) % m;

/**
 * @param {number} lat  latitude em graus (sul negativo)
 * @param {number} lon  longitude em graus (oeste negativo)
 * @param {Date}   data dia de interesse, no fuso local do processo
 * @param {'nascer'|'por'} tipo
 * @returns {number|null} minuto do dia local (0..1439), ou null quando o
 *          evento não ocorre (sol da meia-noite / noite polar)
 */
export function eventoSolar(lat, lon, data, tipo) {
  const zenite = 90.833;                      // sol geométrico + refração

  const inicioAno = new Date(data.getFullYear(), 0, 0);
  const N = Math.floor((data - inicioAno) / 864e5);

  const lngHora = lon / 15;
  const t = N + (((tipo === 'nascer' ? 6 : 18) - lngHora) / 24);

  // Anomalia média e longitude verdadeira do sol
  const M = (0.9856 * t) - 3.289;
  let L = mod(M + (1.916 * sen(M)) + (0.020 * sen(2 * M)) + 282.634, 360);

  // Ascensão reta, ajustada para o mesmo quadrante de L
  let RA = mod(Math.atan(0.91764 * Math.tan(L * RAD)) / RAD, 360);
  RA += (Math.floor(L / 90) * 90) - (Math.floor(RA / 90) * 90);
  RA /= 15;

  // Declinação e ângulo horário local
  const senDec = 0.39782 * sen(L);
  const cosDec = Math.cos(Math.asin(senDec));
  const cosH = (cos(zenite) - (senDec * sen(lat))) / (cosDec * cos(lat));
  if (cosH > 1 || cosH < -1) return null;     // não nasce / não se põe hoje

  let H = tipo === 'nascer'
    ? 360 - (Math.acos(cosH) / RAD)
    : Math.acos(cosH) / RAD;
  H /= 15;

  // Hora média local do evento → UTC → local do processo.
  // O offset é o do INSTANTE do evento, não o da meia-noite: em fusos com
  // horário de verão, no dia da virada os dois diferem em 60 min e usar o
  // errado atrasaria (ou adiantaria) todas as automações solares do dia.
  const T = H + RA - (0.06571 * t) - 6.622;
  const UT = mod(T - lngHora, 24);
  const instanteUTC = new Date(Date.UTC(
    data.getFullYear(), data.getMonth(), data.getDate(), 0, Math.round(UT * 60)));
  const offsetLocalMin = -instanteUTC.getTimezoneOffset();
  return Math.round(mod(UT * 60 + offsetLocalMin, 1440));
}

/** "18h07" — para log e para o texto das automações. */
export const hhmmSol = m =>
  `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
