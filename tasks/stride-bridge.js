// STRIDE との連携（GitHub Pages・ローカルサーバーで開いたときだけ動く）
// - STRIDE と同じ上部バー（ロゴ・画面名・日付と時刻）と、共通の下部タブを表示する
// - 「データはこの端末の中だけ」の表示を追加する
// - Service Worker を登録し、オフラインでも開けるようにする
// claude.ai 版（cloud-sync.js が同期を行う版）では何もしない。Task Board 本体（app.js）は変更しない。
(function () {
  'use strict';
  if (window.claude || window.TaskBoardHost) {
    document.documentElement.classList.remove('in-stride');
    return;
  }
  document.documentElement.classList.add('in-stride');

  // 上部バー（STRIDE の他の画面と同じ）：左に「STRIDE›」と「タスク」、右に日付と時刻（1 秒ごとに更新）
  const appbar = document.createElement('header');
  appbar.className = 's-appbar';
  appbar.innerHTML = [
    '<div class="s-appbar-inner">',
    '  <div class="s-appbar-left">',
    '    <span class="s-brand" aria-hidden="true">STRIDE<b>›</b></span>',
    '    <h1 class="s-title">タスク</h1>',
    '  </div>',
    '  <div class="s-clock" aria-label="現在の日時">',
    '    <span class="s-clock-date"></span>',
    '    <time class="s-clock-time"></time>',
    '  </div>',
    '</div>',
  ].join('');
  const skip = document.querySelector('.skip-link');
  if (skip) skip.after(appbar);
  else document.body.prepend(appbar);
  // 元の見出し（Task Board）は非表示にするので、見出しの役割は上部バーに移す
  const oldTitle = document.querySelector('.brand-title');
  if (oldTitle) oldTitle.setAttribute('aria-hidden', 'true');

  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const dateEl = appbar.querySelector('.s-clock-date');
  const timeEl = appbar.querySelector('.s-clock-time');
  const pad = (n) => String(n).padStart(2, '0');
  function tick() {
    const now = new Date();
    dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日(${WD[now.getDay()]})`;
    timeEl.dateTime = now.toISOString();
    timeEl.innerHTML = `${pad(now.getHours())}<span class="colon">:</span>${pad(now.getMinutes())}<small>${pad(now.getSeconds())}</small>`;
  }
  tick();
  setInterval(tick, 1000);

  // 保存場所の表示はサマリー（未完了・作業中…）のすぐ下に置く
  // （ヘッダーの下端はサマリーが重なるため、そこに置くと隠れてしまう）
  const summary = document.querySelector('.summary');
  if (summary) {
    const note = document.createElement('p');
    note.className = 'stride-local-note container';
    note.textContent = '🔒 データはこの端末の中だけに保存されます（同期なし・サーバーには送信しません）';
    summary.after(note);
  }

  // 下部タブ（STRIDE の index.html と同じ並び・アイコン）。STRIDE 側の画面は ../#<画面名> で開く
  const TABS = [
    ['../', 'ホーム', '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'],
    ['../#records', '記録', '<path d="M12 5v14M5 12h14"/>'],
    ['../#charts', 'グラフ', '<path d="M4 19h16M6 15l4-5 4 3 5-7"/>'],
    ['../#calendar', 'カレンダー', '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'],
    ['./', 'タスク', '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="m8 9 1.5 1.5L12 8M8 15l1.5 1.5L12 14M14.5 9.5H17M14.5 15.5H17"/>'],
    ['../#settings', '設定', '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'],
  ];
  const nav = document.createElement('nav');
  nav.className = 'stride-tabbar';
  nav.setAttribute('aria-label', '画面切替');
  for (const [href, label, svg] of TABS) {
    const a = document.createElement('a');
    a.className = 'stride-tab' + (label === 'タスク' ? ' active' : '');
    a.href = href;
    if (label === 'タスク') a.setAttribute('aria-current', 'page');
    // アイコンは上で定義した固定の SVG のみ（ユーザー入力は含まない）
    a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
    const span = document.createElement('span');
    span.textContent = label;
    a.append(span);
    nav.append(a);
  }
  document.body.append(nav);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('../sw.js').catch(() => {});
  }
})();
