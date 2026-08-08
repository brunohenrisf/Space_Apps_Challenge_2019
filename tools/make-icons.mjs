/**
 * Gera os ícones PNG do Nexo sem depender de nenhuma biblioteca.
 *
 * O desenho é feito por campo de distância com supersampling 2x2, e o
 * PNG é montado à mão (IHDR / IDAT / IEND) sobre o zlib do Node. Assim
 * o repositório não carrega binários opacos: o ícone é código, e quem
 * quiser mudar a marca muda quatro números aqui.
 *
 *   node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = join(RAIZ, 'app', 'icons');

/* ── PNG ──────────────────────────────────────────────────────── */
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
}

/** rgba: Uint8Array de tamanho w*h*4 */
function png(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // 8 bits por canal
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Cada linha leva um byte de filtro (0 = nenhum) na frente.
  const bruto = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    bruto[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(bruto, y * (w * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ── Desenho ──────────────────────────────────────────────────── */
const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);
const lerp = (a, b, t) => a + (b - a) * t;

/** Interpola uma rampa de paradas [[t, [r,g,b]], …] */
function rampa(paradas, t) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < paradas.length; i++) {
    if (t <= paradas[i][0]) {
      const [t0, c0] = paradas[i - 1], [t1, c1] = paradas[i];
      const k = (t - t0) / (t1 - t0 || 1);
      return c0.map((v, j) => lerp(v, c1[j], k));
    }
  }
  return paradas[paradas.length - 1][1];
}

const sdCirculo = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function sdSegmento(px, py, ax, ay, bx, by, esp) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(wx - vx * t, wy - vy * t) - esp / 2;
}

/** Retângulo de cantos arredondados, centrado em (0.5,0.5) no espaço unitário. */
function sdRetArred(px, py, meio, r) {
  const qx = Math.abs(px - 0.5) - (meio - r);
  const qy = Math.abs(py - 0.5) - (meio - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const FUNDO   = [[0, [255, 209, 140]], [0.55, [246, 169, 59]], [1, [211, 118, 12]]];
const TINTA   = [42, 27, 6];   // --accent-ink

/**
 * A marca: um nó central e três satélites ligados a ele. É a malha
 * Zigbee — a coisa que o produto de fato é — e não uma casinha genérica.
 */
function desenhar(tam, { sangra = false } = {}) {
  const rgba = new Uint8Array(tam * tam * 4);
  const SS = 2, passo = 1 / SS;

  // Geometria do glifo em espaço unitário.
  const escala = sangra ? 0.50 : 0.62;
  const cx = 0.5, cy = 0.5;
  const rNo  = 0.108 * escala * 1.6;
  const rSat = 0.062 * escala * 1.6;
  const dist = 0.245 * escala * 1.6;
  const esp  = 0.030 * escala * 1.6;
  const sats = [-90, 30, 150].map(g => {
    const a = (g * Math.PI) / 180;
    return [cx + Math.cos(a) * dist, cy + Math.sin(a) * dist];
  });

  const meio = sangra ? 0.5 : 0.5 - 0.008;
  const raioCanto = sangra ? 0.5 : 0.225;

  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      let aF = 0, aG = 0, somaR = 0, somaG = 0, somaB = 0, n = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) * passo) / tam;
          const py = (y + (sy + 0.5) * passo) / tam;
          const aa = 1 / tam;   // largura de uma amostra, para o antisserrilhado

          // Fundo
          const dF = sangra ? -1 : sdRetArred(px, py, meio, raioCanto);
          const cF = clamp(0.5 - dF / aa, 0, 1);
          aF += cF;
          if (cF > 0) {
            const c = rampa(FUNDO, (px * 0.62 + py * 0.38));
            somaR += c[0] * cF; somaG += c[1] * cF; somaB += c[2] * cF;
          }

          // Glifo: linhas primeiro, círculos por cima.
          let dG = Infinity;
          for (const [sxp, syp] of sats) {
            dG = Math.min(dG, sdSegmento(px, py, cx, cy, sxp, syp, esp));
            dG = Math.min(dG, sdCirculo(px, py, sxp, syp, rSat));
          }
          dG = Math.min(dG, sdCirculo(px, py, cx, cy, rNo));
          aG += clamp(0.5 - dG / aa, 0, 1);

          n++;
        }
      }

      const covF = aF / n, covG = aG / n;
      const bg = covF > 0 ? [somaR / aF, somaG / aF, somaB / aF] : [0, 0, 0];

      // Glifo composto sobre o fundo, e o conjunto sobre transparente.
      const r = lerp(bg[0], TINTA[0], covG / (covF || 1) > 1 ? 1 : covG / (covF || 1));
      const g = lerp(bg[1], TINTA[1], covG / (covF || 1) > 1 ? 1 : covG / (covF || 1));
      const b = lerp(bg[2], TINTA[2], covG / (covF || 1) > 1 ? 1 : covG / (covF || 1));

      const i = (y * tam + x) * 4;
      rgba[i]     = Math.round(clamp(r, 0, 255));
      rgba[i + 1] = Math.round(clamp(g, 0, 255));
      rgba[i + 2] = Math.round(clamp(b, 0, 255));
      rgba[i + 3] = Math.round(clamp(Math.max(covF, covG) * 255, 0, 255));
    }
  }
  return rgba;
}

/* ── Saída ────────────────────────────────────────────────────── */
mkdirSync(SAIDA, { recursive: true });

const alvos = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { sangra: true }],
  // O iOS aplica a própria máscara, então o ícone dele é quadrado cheio.
  ['apple-touch-icon.png', 180, { sangra: true }]
];

for (const [nome, tam, opts] of alvos) {
  const buf = png(desenhar(tam, opts), tam, tam);
  writeFileSync(join(SAIDA, nome), buf);
  console.log(`${nome.padEnd(24)} ${tam}×${tam}  ${(buf.length / 1024).toFixed(1)} KB`);
}
