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

const catalogo = JSON.parse(readFileSync(join(RAIZ, 'casa', 'devices.json'), 'utf8'));
const rotinas  = JSON.parse(readFileSync(join(RAIZ, 'casa', 'routines.json'), 'utf8')).routines;

rmSync(destino, { recursive: true, force: true });
const h = new Historico(destino);

const DIA = 864e5;
const meiaNoite = d => { const x = new Date(Date.now() - d * DIA); x.setHours(0,0,0,0); return +x; };
const ehUtil = ts => { const d = new Date(ts).getDay(); return d !== 0 && d !== 6; };
const em = (ts, h_, m) => ts + h_ * 36e5 + m * 60e3;
const ruido = n => Math.round((Math.random() - 0.5) * 2 * n);

let n = 0;
const reg = e => { h.registrar(e); n++; };

for (let d = 29; d >= 0; d--) {
  const base = meiaNoite(d);
  const util = ehUtil(base);

  /* ── Padrão 1: a luz da bancada, todo dia útil, por volta das 6h45 ── */
  if (util && Math.random() < 0.86) {
    reg({ ts: em(base, 6, 45 + ruido(9)), id: 'coz_bancada', acao: 'on',
          valor: { on: true, bri: 88 + ruido(4), k: 4600 }, modo: 'normal', origem: 'manual' });
  }

  /* ── Padrão 2: a rotina "Fim de tarde" dispara e alguém desfaz ────── */
  const disparo = em(base, 18, 0);
  reg({ ts: disparo, id: 'var_luz', acao: 'on', valor: { on: true, bri: 45 },
        modo: 'normal', origem: 'rotina', rotina: 'r1' });
  if (Math.random() < 0.55) {
    reg({ ts: disparo + (2 + Math.random() * 6) * 60e3, id: 'var_luz', acao: 'off',
          valor: { on: false }, modo: 'normal', origem: 'manual' });
  }

  /* ── Padrão 3: a casa dorme e a TV fica ligada mais uns 40 min ────── */
  const dormir = em(base, 23, 15 + ruido(20));
  reg({ ts: dormir, id: '_casa', acao: 'modo', valor: { modo: 'dormindo' },
        modo: 'dormindo', origem: 'manual' });
  if (Math.random() < 0.8) {
    reg({ ts: dormir + (38 + ruido(10)) * 60e3, id: 'sala_tv', acao: 'off',
          valor: { on: false }, modo: 'dormindo', origem: 'manual' });
  }

  /* ── Ruído: uso avulso, sem padrão nenhum ─────────────────────────── */
  for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
    const alvo = ['sala_teto','sui_teto','qt2_teto','esc_teto','sui_abajur','sala_sanca'][
      Math.floor(Math.random() * 6)];
    reg({ ts: em(base, 8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60)),
          id: alvo, acao: Math.random() < 0.5 ? 'on' : 'off',
          valor: { on: true, bri: 40 + Math.floor(Math.random() * 55) },
          modo: 'normal', origem: 'manual' });
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
