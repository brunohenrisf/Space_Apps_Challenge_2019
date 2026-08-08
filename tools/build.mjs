/**
 * Prepara os arquivos que vão para o cartão SD do ESP32.
 *
 *   node tools/build.mjs
 *
 * Faz duas coisas:
 *  1. Pré-comprime tudo em .gz. O ESP32 serve o .gz com
 *     Content-Encoding: gzip e economiza CPU e tempo de rádio — é a
 *     diferença entre o app abrir em 300 ms e em 2 s.
 *  2. Gera dist/preview.html, uma versão de página única para abrir no
 *     navegador durante o desenho da interface, sem ESP32 nenhum.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ   = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP    = join(RAIZ, 'app');
const CASA   = join(RAIZ, 'casa');
const DIST   = join(RAIZ, 'dist');

const COMPRIMIVEL = /\.(html|js|css|webmanifest|svg)$/i;

function varrer(dir) {
  return readdirSync(dir).flatMap(nome => {
    const p = join(dir, nome);
    return statSync(p).isDirectory() ? varrer(p) : [p];
  });
}

mkdirSync(DIST, { recursive: true });

let bruto = 0, comprimido = 0;
const linhas = [];

/* app/ é a interface; casa/ é a configuração da instalação. Os dois vão para
 * a raiz do cartão, mas a configuração fica legível — quem for atender um
 * chamado precisa conseguir abrir devices.json num editor de texto. */
for (const [origem, gzipar] of [[APP, true], [CASA, false]]) {
  for (const arq of varrer(origem)) {
    const rel = relative(origem, arq);
    const dados = readFileSync(arq);
    const destino = join(DIST, 'sd', rel);
    mkdirSync(dirname(destino), { recursive: true });

    if (gzipar && COMPRIMIVEL.test(arq)) {
      const gz = gzipSync(dados, { level: 9 });
      writeFileSync(destino + '.gz', gz);
      bruto += dados.length; comprimido += gz.length;
      linhas.push([rel + '.gz', dados.length, gz.length]);
    } else {
      writeFileSync(destino, dados);
      bruto += dados.length; comprimido += dados.length;
      linhas.push([rel, dados.length, dados.length]);
    }
  }
}

/* ── Versão de página única para pré-visualização ──────────────── */
const html = readFileSync(join(APP, 'index.html'), 'utf8');
const corpo  = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
const estilo = html.match(/<style>[\s\S]*?<\/style>/i);
if (corpo && estilo) {
  writeFileSync(join(DIST, 'preview.html'), estilo[0] + '\n' + corpo[1].trim() + '\n');
}

const kb = n => (n / 1024).toFixed(1).padStart(7) + ' KB';
console.log('\n  arquivo                          original    no cartão');
console.log('  ' + '─'.repeat(56));
for (const [n, a, b] of linhas) console.log('  ' + n.padEnd(30) + kb(a) + '  ' + kb(b));
console.log('  ' + '─'.repeat(56));
console.log('  ' + 'total'.padEnd(30) + kb(bruto) + '  ' + kb(comprimido)
  + `   (${Math.round((1 - comprimido / bruto) * 100)}% menor)\n`);
console.log('  Copie dist/sd/ para a raiz do cartão SD.\n');
