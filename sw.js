/* Service worker — cache shell statique (pas jeux.json ni API). */
'use strict';

const CACHE = 'hugotaslot-shell-20260608-0307';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './assets/logo-hugotaslot.jpg',
  './assets/virtual-token.svg',
];

function isCacheableAsset(pathname) {
  if (pathname.endsWith('.css') || pathname.endsWith('.js')) return true;
  if (pathname.startsWith('/assets/') || pathname.startsWith('./assets/')) return true;
  return /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/i.test(pathname);
}

function shouldBypassCache(url) {
  const p = url.pathname;
  if (p.includes('jeux.json') || p.includes('jeux-embed.js')) return true;
  if (p.includes('/client-api/') || p.includes('supabase')) return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (shouldBypassCache(url)) return;

  event.respondWith(
    (async () => {
      const networkFirst = url.pathname.endsWith('/app.js') || url.pathname.endsWith('/index.html');
      if (networkFirst) {
        try {
          const res = await fetch(event.request);
          if (res && res.status === 200 && res.type !== 'opaque') {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return res;
        } catch (_) {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          throw _;
        }
      }
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const res = await fetch(event.request);
      if (!res || res.status !== 200 || res.type === 'opaque') return res;
      if (!isCacheableAsset(url.pathname) && url.pathname !== '/' && !url.pathname.endsWith('.html')) {
        return res;
      }
      const clone = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, clone)).catch(() => {});
      return res;
    })()
  );
});
