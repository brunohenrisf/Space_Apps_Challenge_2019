/**
 * Semeia 30 dias de histórico sintético para exercitar o aprendiz.
 *
 *   node server/ferramentas/semear.mjs [destino]
 *
 * Planta três padrões de propósito, um para cada detector, e por cima
 * deles espalha ruído — ação avulsa, em horário aleatório — para que o
 * teste não seja fácil demais. Se o aprendiz achar os três e não
 * inventar um quarto, o motor está fazendo o que deveria.
 *
 * Isto NÃO vai para a casa do cliente. É banco de ensaio.
 */
import { Historico } from '../lib/historico.mjs';
import { sugerir } from '../lib/aprendiz.mjs';
import { readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const destino = process.argv[2] || join(RAIZ, 'server', 'dados', 'ensaio');

/* O aprendiz de produção recebe o catálogo ENRIQUECIDO pelo nexo.mjs
 * (switchCap/dimmerCap/ctCap) e eventos carimbados com `cap`. O banco de
 * ensaio precisa falar exatamente esse formato — senão testa outra coisa. */
const bruto = JSON.parse(readFileSync(join(RAIZ, 'casa', 'devices.json'), 'utf8'));
const catalogo = { devices: bruto.devices.map(d => ({
  id: d.id, name: d.name,
  switchCap: d.caps?.includes('onoff') ? 'switch'     : null,
  dimmerCap: d.caps?.includes('dim')   ? 'dimmer'     : null,
  ctCap:     d.caps?.includes('cct')   ? 'color_temp' : null
})) };
const rotinas = JSON.parse(readFileSync(join(RAIZ, 'casa', 'routines.json'), 'utf8')).routines;

rmSync(destino, { recursive: true, force: true });
const h = new Historico(destino);

const DIA = 864e5;
const meiaNoite = d => { const x = new Date(Date.now() - d * DIA); x.setHours(0,0,0,0); return +x; };
const ehUtil = ts => { const d = new Date(ts).getDay(); return d !== 0 && d !== 6; };
const em = (ts, h_, m) => ts + h_ * 36e5 + m * 60e3;

/* Aleatório COM semente (mulberry32): banco de ensaio que às vezes passa
 * e às vezes não ensina a desconfiar do teste, não do código. Uma rodada
 * azarada de sorteio() derrubava o padrão 2 de vez em quando. Mude a
 * semente de propósito (SEMENTE=42 node …) para explorar outros sorteios. */
let semente = (Number(process.env.SEMENTE) || 7) >>> 0;
function sorteio() {
  semente = (semente + 0x6D2B79F5) >>> 0;
  let t = semente;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ruido = n => Math.round((sorteio() - 0.5) * 2 * n);

let n = 0;
const reg = e => { h.registrar(e); n++; };

for (let d = 29; d >= 0; d--) {
  const base = meiaNoite(d);
  const util = ehUtil(base);

  /* ── Padrão 1: a luz da bancada, todo dia útil, por volta das 6h45 ──
     Ligar + ajustar brilho + ajustar temperatura são TRÊS comandos em
     produção (uma capability cada), e é assim que o detector reconstrói
     "a 88%, 4600K": pela mediana dos ajustes feitos perto do acender. */
  if (util && sorteio() < 0.86) {
    const t1 = em(base, 6, 45 + ruido(9));
    reg({ ts: t1, id: 'coz_bancada', cap: 'switch', acao: 'on',
          valor: { type: 'switch', state: true }, modo: 'normal', origem: 'manual' });
    reg({ ts: t1 + 20e3, id: 'coz_bancada', cap: 'dimmer', acao: 'dimmer',
          valor: { type: 'dimmer', value: 88 + ruido(4) }, modo: 'normal', origem: 'manual' });
    reg({ ts: t1 + 40e3, id: 'coz_bancada', cap: 'color_temp', acao: 'color_temp',
          valor: { type: 'color_temp', kelvin: 4600 }, modo: 'normal', origem: 'manual' });
  }

  /* ── Padrão 2: a rotina "Fim de tarde" dispara e alguém desfaz ────── */
  const disparo = em(base, 18, 0);
  reg({ ts: disparo, id: 'var_luz', cap: 'switch', acao: 'on',
        valor: { type: 'switch', state: true }, modo: 'normal', origem: 'rotina', rotina: 'r1' });
  if (sorteio() < 0.55) {
    reg({ ts: disparo + (2 + sorteio() * 6) * 60e3, id: 'var_luz', cap: 'switch',
          acao: 'off', valor: { type: 'switch', state: false }, modo: 'normal', origem: 'manual' });
  }

  /* ── Padrão 3: a casa dorme e a TV fica ligada mais uns 40 min ────── */
  const dormir = em(base, 23, 15 + ruido(20));
  reg({ ts: dormir, id: '_casa', acao: 'modo', valor: { modo: 'dormindo' },
        modo: 'dormindo', origem: 'manual' });
  if (sorteio() < 0.8) {
    reg({ ts: dormir + (38 + ruido(10)) * 60e3, id: 'sala_tv', cap: 'switch', acao: 'off',
          valor: { type: 'switch', state: false }, modo: 'dormindo', origem: 'manual' });
  }

  /* ── Ruído: uso avulso, sem padrão nenhum ─────────────────────────── */
  for (let i = 0; i < 3 + Math.floor(sorteio() * 4); i++) {
    const alvo = ['sala_teto','sui_teto','qt2_teto','esc_teto','sui_abajur','sala_sanca'][
      Math.floor(sorteio() * 6)];
    const liga = sorteio() < 0.5;
    reg({ ts: em(base, 8 + Math.floor(sorteio() * 14), Math.floor(sorteio() * 60)),
          id: alvo, cap: 'switch', acao: liga ? 'on' : 'off',
          valor: { type: 'switch', state: liga }, modo: 'normal', origem: 'manual' });
  }
}

console.log(`\n  ${n} eventos semeados em ${destino}\n`);

/* ── O que o aprendiz encontra ──────────────────────────────────────── */
const achadas = sugerir({ historico: h, catalogo, rotinas });

console.log(`  ${achadas.length} sugestões\n`);
for (const s of achadas) {
  console.log(`  ┌ ${s.tipo === 'recuar' ? 'RECUAR' : 'CRIAR '}  ${s.confianca}%   [${s.id}]`);
  console.log(`  │ ${s.texto}`);
  console.log(`  │ ${s.evidencia}`);
  console.log(`  └→ ${s.acao}\n`);
}

const esperados = ['h:coz_bancada', 'r:r1', 'c:sala_tv'];
const faltando = esperados.filter(e => !achadas.some(s => s.id.startsWith(e)));
const extras   = achadas.filter(s => !esperados.some(e => s.id.startsWith(e)));

if (faltando.length) console.log('  ✗ não encontrou:', faltando.join(', '));
if (extras.length)   console.log('  ! sugeriu além do plantado:', extras.map(s => s.id).join(', '));
if (!faltando.length && !extras.length) console.log('  ✓ os três padrões plantados, e nada inventado\n');

process.exit(faltando.length ? 1 : 0);
