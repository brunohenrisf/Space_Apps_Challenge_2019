/*
 * Gera os ícones e as splash screens da PWA a partir de icons/icon.svg.
 *
 *   npm i -D playwright
 *   node tools/gen-assets.mjs
 *
 * Só precisa ser executado de novo se icon.svg ou as cores do tema mudarem.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = path.join(ROOT, 'icons');
const SPLASH = path.join(ROOT, 'icons', 'splash');

const BG = '#101c2e';
const CARD = '#16243a';
const svg = fs.readFileSync(path.join(ICONS, 'icon.svg'), 'utf8');

// Larguras x alturas em pixels físicos, com o device-pixel-ratio do aparelho.
// Cobrem os iPhones em uso desde o SE (2ª geração).
const SPLASHES = [
  { w: 750,  h: 1334, dpr: 2, label: 'iphone-8-se2' },
  { w: 1125, h: 2436, dpr: 3, label: 'iphone-x-11pro-13mini' },
  { w: 1170, h: 2532, dpr: 3, label: 'iphone-12-13-14' },
  { w: 1179, h: 2556, dpr: 3, label: 'iphone-14pro-15-16' },
  { w: 1284, h: 2778, dpr: 3, label: 'iphone-12-14-promax' },
  { w: 1290, h: 2796, dpr: 3, label: 'iphone-15-16-promax' },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function shot(file, cssW, cssH, dpr, html) {
  const page = await browser.newPage({
    viewport: { width: cssW, height: cssH },
    deviceScaleFactor: dpr,
  });
  await page.setContent(`<style>html,body{margin:0;padding:0;background:${BG}}</style>${html}`);
  await page.screenshot({ path: file });
  await page.close();
  console.log('  ' + path.relative(ROOT, file));
}

console.log('Ícones:');
for (const size of [180, 192, 512]) {
  await shot(path.join(ICONS, `icon-${size}.png`), size, size, 1,
    `<style>svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
}

// Maskable: o recorte do sistema pode cortar até 20% de cada borda.
await shot(path.join(ICONS, 'icon-512-maskable.png'), 512, 512, 1,
  `<style>.box{width:512px;height:512px;display:grid;place-items:center;background:${CARD}}
   svg{display:block;width:369px;height:369px}</style><div class="box">${svg}</div>`);

console.log('Splash screens:');
fs.mkdirSync(SPLASH, { recursive: true });
for (const { w, h, dpr, label } of SPLASHES) {
  const logo = Math.round(w / dpr / 3.4);
  await shot(path.join(SPLASH, `splash-${w}x${h}.png`), w / dpr, h / dpr, dpr,
    `<style>
       .wrap{width:100%;height:100%;display:flex;flex-direction:column;
             align-items:center;justify-content:center;gap:22px;background:${BG}}
       svg{display:block;width:${logo}px;height:${logo}px;border-radius:${Math.round(logo / 4.5)}px}
       p{margin:0;font:600 ${Math.round(logo / 7)}px/1.3 -apple-system,"Segoe UI",Roboto,sans-serif;
         color:#94a8c4;letter-spacing:.4px}
     </style>
     <div class="wrap">${svg}<p>Painel ESP32</p></div>`);
  console.log(`    ↳ ${label}`);
}

await browser.close();
console.log('\nPronto. Lembre-se de reenviar a pasta data/ para o LittleFS.');
