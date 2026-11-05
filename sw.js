// Service Worker: アプリ一式をキャッシュして、オフラインでも起動・記録できるようにする。
// キャッシュ名にバージョンを付け、js/version.js の APP_VERSION を上げると新しいキャッシュに切り替わる。
//
// 【重要】公開するときは、下の SW_VERSION を js/version.js の APP_VERSION と同じ値に上げる。
// 端末（とくに iPhone）は sw.js そのものの中身が変わったときだけ更新に気づくため、
// version.js だけを変えると「更新があります」が出ない（v2.9.0・v2.9.1 で発生）。
// 2 つの値がそろっているかは単体テスト（tests/sw.test.js）で確認する。
const SW_VERSION = '2.9.3';

const CACHE = `fitlog-v${SW_VERSION}`;

// 事前にキャッシュするファイル（すべて相対パス）
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/version.js',
  './js/lock.js',
  './js/cloud.js',
  './js/share.js',
  './js/trend.js',
  './js/badges.js',
  './js/review.js',
  './js/plans.js',
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
  './js/views/home-review.js',
  './js/views/home-today.js',
  './js/views/track.js',
  './fonts/barlow-condensed-latin-600-normal.woff2',
  './fonts/barlow-condensed-latin-700-normal.woff2',
  './fonts/barlow-condensed-latin-700-italic.woff2',
  './js/views/records.js',
  './js/views/charts.js',
  './js/views/bests.js',
  './js/views/calendar.js',
  './js/views/settings.js',
  './js/views/home-tasks.js',
  './lib/chart.umd.min.js',
  './lib/confetti.browser.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  // Task Board（タスク画面）。マニュアルの画像は開いたときにキャッシュする
  './tasks/',
  './tasks/index.html',
  './tasks/style.css',
  './tasks/app.js',
  './tasks/cloud-sync.js',
  './tasks/stride-bridge.js',
  './tasks/stride-bridge.css',
  './tasks/manual.html',
  // はじめての手引き
  './guide/',
  './guide/index.html',
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

  // 画面遷移（アドレスバーやホーム画面からの起動、タスク画面への移動）は、そのページのキャッシュを返す。
  // キャッシュになく、オフラインで取得もできないときは STRIDE のホーム（index.html）を返す。
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch (err) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
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

/* ---------- 入力忘れのお知らせ（Web プッシュ） ---------- */

// 通知を受け取ったら表示する（iPhone では、受け取ったら必ず表示する必要がある）
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'STRIDE', {
    body: data.body || '今日の記録を確認しましょう',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag || 'stride-remind',
    data: { url: data.url || './' },
  }));
});

// 通知をタップしたら STRIDE を開く（開いていれば前面に出す）
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope) && 'focus' in w) return w.focus();
    }
    return self.clients.openWindow(url);
  })());
});
