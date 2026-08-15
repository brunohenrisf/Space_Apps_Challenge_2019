/* Service worker do Painel ESP32.
 *
 * Estratégia:
 *   - App shell (HTML/CSS/JS/ícones): cache-first, para o painel abrir
 *     instantaneamente e continuar abrindo mesmo se o ESP32 estiver fora do ar.
 *   - /api/*: nunca cacheado. Estado de porta obsoleto é pior que erro visível.
 *
 * Só é registrado em contexto seguro (HTTPS ou localhost) — ver js/app.js.
 * Servido por HTTP puro pelo ESP32, o Safari ignora o registro e o painel
 * continua funcionando normalmente, apenas sem cache offline.
 */

const VERSION = 'esp32-panel-v1';

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      // addAll é atômico: um 404 invalidaria a instalação inteira.
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Comandos e leituras do ESP32 sempre vão à rede.
  if (url.pathname.startsWith('/api/')) return;

  // Chamadas para outra origem (o ESP32, quando a página é hospedada fora dele).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // Revalida em segundo plano para a próxima abertura.
        event.waitUntil(
          fetch(request)
            .then(res => res.ok && caches.open(VERSION).then(c => c.put(request, res.clone())))
            .catch(() => {})
        );
        return cached;
      }

      return fetch(request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(caches.open(VERSION).then(c => c.put(request, copy)));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

// Permite que a página force a ativação de uma versão nova.
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
