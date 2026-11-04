// Service Worker の登録と「更新があります」バナー
import { h } from './ui.js';

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  let reloading = false;
  // 新しい Service Worker に切り替わったら 1 回だけ再読み込みする
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    let reg;
    try {
      reg = await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('Service Worker を登録できませんでした', e);
      return;
    }

    // すでに新しい版が待機中なら（前回起動時にダウンロード済み）すぐに知らせる
    if (reg.waiting && navigator.serviceWorker.controller) showBanner(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // controller がある = 以前の版で動いている → 更新として知らせる（初回インストール時は出さない）
        if (sw.state === 'installed' && navigator.serviceWorker.controller) showBanner(sw);
      });
    });

    // アプリに戻ってきたとき（ホーム画面から再表示したときなど）に更新を確認する
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  });
}

function showBanner(worker) {
  if (document.querySelector('.update-banner')) return;
  const banner = h('div', { class: 'update-banner', role: 'status' },
    h('span', { text: '更新があります' }),
    h('button', {
      type: 'button', class: 'btn btn-primary btn-sm', text: '再読み込み',
      onclick: (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = '更新中…';
        worker.postMessage({ type: 'SKIP_WAITING' });
      },
    }),
    h('button', { type: 'button', class: 'update-close', 'aria-label': 'あとで', text: '×', onclick: () => banner.remove() }),
  );
  document.body.append(banner);
}
