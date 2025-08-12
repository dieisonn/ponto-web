/* PWA shell cache – não intercepta Firestore/Google APIs */
const CACHE_NAME = 'ponto-shell-v1';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './app.js',
  './offline.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* instala e pré-cacheia o shell */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

/* limpa caches antigos */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

/* estratégia:
   - navegações (HTML): network-first -> cache -> offline.html
   - arquivos estáticos do mesmo domínio: cache-first -> rede (e atualiza cache)
   - requests para outros domínios (Firebase/Google): deixam passar (sem cache) */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // só GET
  if (req.method !== 'GET') return;

  // navegação (HTML)
  const isNav =
    req.mode === 'navigate' ||
    (req.destination === 'document') ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNav) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          // atualiza cache do index/admin para voltar rápido depois
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('./offline.html')))
    );
    return;
  }

  // só cacheia arquivos do MESMO ORIGEM (evita APIs externas)
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const fromNet = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => hit);
        // cache first
        return hit || fromNet;
      })
    );
  }
  // demais (Firebase etc.) seguem sem interceptar
});
