/*
 * Gera dist/index.html: o painel inteiro em UM único arquivo.
 *
 *   node tools/build-single.mjs
 *
 * CSS, JavaScript e ícones entram embutidos (data: URI). Serve para gravar
 * um arquivo só no LittleFS ou para levar o painel de um lado para o outro.
 *
 * O que fica de fora, por limitação do formato:
 *   - service worker: precisa ser um arquivo próprio, com URL. Sem ele não há
 *     cache offline — o que já era o caso servindo por HTTP puro pelo ESP32.
 *   - manifest e splash screens: o iOS não usa o manifest para instalar (usa
 *     as meta tags apple-*), e as splash pesariam ~400 KB em base64.
 *     Para instalar no Android/desktop, use a versão multiarquivo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const b64  = p => fs.readFileSync(path.join(ROOT, p)).toString('base64');

const css = read('css/style.css');
const js  = read('js/app.js');
const svgIcon   = `data:image/svg+xml,${encodeURIComponent(read('icons/icon.svg'))}`;
const touchIcon = `data:image/png;base64,${b64('icons/icon-180.png')}`;

let html = read('index.html');

// Marca a página como build de arquivo único: o app.js pula o service worker.
html = html.replace('<html lang="pt-BR">', '<html lang="pt-BR" data-single-file>');

// Troca todos os links de recurso externo por versões embutidas.
html = html
  .replace(/^\s*<!-- PWA -->\n/m, '')
  .replace(/^\s*<link rel="manifest"[^>]*>\n/m, '')
  .replace(/^\s*<link rel="icon"[^>]*>\n/gm, '')
  .replace(/^\s*<link rel="apple-touch-icon"[^>]*>\n/m, '')
  .replace(/^\s*<!-- Tela de abertura no iOS[^>]*-->\n/m, '')
  .replace(/^\s*<link rel="apple-touch-startup-image"[\s\S]*?>\n/gm, '');

// Substituições sempre via função: como texto, `$&` e `$$` seriam
// interpretados como padrões — e o app.js usa `$` e `$$` como helpers.
const inject = (haystack, needle, content) => haystack.replace(needle, () => content);

html = inject(html, '<!-- iOS: ',
  `<link rel="icon" href="${svgIcon}" type="image/svg+xml">\n` +
  `<link rel="apple-touch-icon" href="${touchIcon}">\n\n<!-- iOS: `);

html = inject(html, '<link rel="stylesheet" href="css/style.css">',
  `<style>\n${css}\n</style>`);

// `</script>` dentro do JS encerraria a tag antes da hora.
html = inject(html, '<script src="js/app.js"></script>',
  `<script>\n${js.replace(/<\/script>/g, () => '<\\/script>')}\n</script>`);

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'index.html');
fs.writeFileSync(outFile, html);

// Sanidade: nenhuma referência a arquivo local pode ter sobrado.
const leftovers = [...html.matchAll(/(?:href|src)="(?!data:|#|https?:)([^"]+)"/g)].map(m => m[1]);
if (leftovers.length) {
  console.error('AVISO — referências externas não embutidas:', leftovers);
  process.exitCode = 1;
}

console.log(`dist/index.html — ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB, sem dependências`);
