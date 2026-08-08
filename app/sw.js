/* Service worker do Nexo.
 *
 * Só é registrado em contexto seguro (https:// ou localhost). Sobre
 * http://nexo.local o iOS recusa o registro e o app roda sem cache —
 * as saídas estão em docs/ios-pwa.md.
 *
 * Estratégia: a casca do app vem do cache primeiro (o ESP32 é lento e
 * já está ocupado falando com o hub); /api e /ws nunca são cacheados,
 * porque estado de dispositivo velho é pior que nenhum estado.
 */

const CACHE = 'nexo-v1';
const CASCA = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CASCA))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;

  e.respondWith(
    caches.match(req).then(hit => {
      // Revalida em segundo plano: o painel pode ter recebido um firmware novo.
      const rede = fetch(req).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
        }
        return res;
      }).catch(() => hit);

      return hit || rede;
    })
  );
});
