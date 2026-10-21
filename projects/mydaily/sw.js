const CACHE_NAME = 'mydaily-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './calendar.html',
  './styles.css',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.destination === 'document') {
    e.respondWith(
      fetch(request).then(res => {
        const clone = res.clone();
        putInCache(request, clone);
        return res;
      }).catch(() => caches.match(request).then(r => r || caches.match('./index.html')))
    );
  } else {
    e.respondWith(
      caches.match(request).then(r => r || fetch(request).then(res => {
        const clone = res.clone();
        putInCache(request, clone);
        return res;
      }))
    );
  }
});

// 缓存写入失败（如跨域/不完整响应/配额超限）不应中断页面，必须吞掉
function putInCache(request, response) {
  caches.open(CACHE_NAME).then(c => c.put(request, response)).catch(() => {});
}

