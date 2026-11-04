// Service Worker: アプリ一式をキャッシュして、オフラインでも起動・記録できるようにする。
// キャッシュ名にバージョンを付け、js/version.js の APP_VERSION を上げると新しいキャッシュに切り替わる。
importScripts('./js/version.js');

const CACHE = `fitlog-v${self.APP_VERSION}`;

// 事前にキャッシュするファイル（すべて相対パス）
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/version.js',
  './js/app.js',
  './js/calc.js',
  './js/storage.js',
  './js/ui.js',
  './js/pb.js',
  './js/hooks.js',
  './js/celebrate.js',
  './js/sample.js',
  './js/sw-register.js',
  './js/views/home.js',
  './js/views/home-goal.js',
  './js/views/records.js',
  './js/views/charts.js',
  './js/views/bests.js',
  './js/views/calendar.js',
  './js/views/settings.js',
  './lib/chart.umd.min.js',
  './lib/confetti.browser.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // HTTP キャッシュを使わず最新を取得する（GitHub Pages は 10 分程度キャッシュされるため）
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
  // ここでは skipWaiting しない。画面の「更新があります」ボタンで切り替える。
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('fitlog-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// キャッシュ優先。なければネットワークから取得してキャッシュに追加する。
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 画面遷移（アドレスバーやホーム画面からの起動）は index.html を返す
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(req)),
    );
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return new Response('オフラインのため取得できませんでした', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
