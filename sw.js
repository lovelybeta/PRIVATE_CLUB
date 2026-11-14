/* Service Worker: чтобы сайт выглядел и работал без интернета.
   - index.html: Network First (всегда свежая версия, при Ctrl+F5 тоже), без сети — копия из кэша.
   - Шрифты и стили Google Fonts: сохраняются целиком при установке и потом отдаются из кэша.
   - Запросы к базе Turso сюда не попадают: слова на случай офлайна хранятся в IndexedDB внутри index.html. */
const CACHE = 'cumshot-shell-v4';
const PAGE = './index.html';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600&display=swap';
const ASSETS = ['./manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon-48.png'];
const NET_TIMEOUT = 5000; // если сеть «висит» дольше — показываем копию из кэша

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1) сама страница
    try { await cache.add(new Request(PAGE, { cache: 'reload' })); } catch (e) {}
    try { await cache.add(new Request('./', { cache: 'reload' })); } catch (e) {}
    // 1б) манифест и иконки приложения
    await Promise.all(ASSETS.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    // 2) стили шрифтов и все файлы шрифтов, на которые они ссылаются
    try {
      const res = await fetch(FONTS_CSS);
      if (res.ok) {
        await cache.put(FONTS_CSS, res.clone());
        const css = await res.text();
        const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, ''));
        await Promise.all([...new Set(urls)].map(async (u) => {
          try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch (e) {}
        }));
      }
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirstPage(req) {
  const network = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(PAGE, copy));
    }
    return res;
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NET_TIMEOUT));
  return Promise.race([network, timeout]).catch(async () => {
    const hit = (await caches.match(PAGE)) || (await caches.match('./'));
    return hit || network; // если кэша ещё нет — ждём сеть
  });
}

function fontsCacheFirst(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req.url).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req.url, res.clone()); return res; }).catch(() => hit);
      return hit || net; // из кэша сразу, а в фоне обновляем
    })
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const isPage = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
    if (isPage) { event.respondWith(networkFirstPage(req)); return; }
    // манифест и иконки: из кэша сразу, в фоне обновляем
    if (/\/(manifest\.json|[^/]+\.png)$/.test(url.pathname)) {
      event.respondWith(caches.open(CACHE).then((cache) => cache.match(req.url, { ignoreSearch: true }).then((hit) => {
        const net = fetch(req).then((res) => { if (res.ok) cache.put(req.url, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })));
    }
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(fontsCacheFirst(req));
  }
  // всё остальное (в том числе Turso) идёт напрямую в сеть
});
