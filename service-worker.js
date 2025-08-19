// SW simples para cache offline básico
const CACHE = 'ponto-v3';
const CORE = [
  './',
  './login.html',
  './index.html',
  './admin.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './favicon.ico',
  './google.svg'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=> k===CACHE ? null : caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e)=>{
  const { request } = e;
  if (request.method !== 'GET') return;
  e.respondWith(
    caches.match(request).then(r =>
      r || fetch(request).then(res=>{
        const resClone=res.clone();
        caches.open(CACHE).then(c=>c.put(request, resClone)).catch(()=>{});
        return res;
      }).catch(()=> r)
    )
  );
});
