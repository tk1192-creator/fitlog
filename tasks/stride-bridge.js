// STRIDE との連携（GitHub Pages・ローカルサーバーで開いたときだけ動く）
// - ヘッダーに「‹ STRIDE」の戻るボタンと、「データはこの端末の中だけ」の表示を追加する
// - Service Worker を登録し、オフラインでも開けるようにする
// claude.ai 版（cloud-sync.js が同期を行う版）では何もしない。Task Board 本体（app.js）は変更しない。
(function () {
  'use strict';
  if (window.claude || window.TaskBoardHost) return;

  document.documentElement.classList.add('in-stride');

  // 戻るボタンはロゴの左に置く
  const brand = document.querySelector('.brand');
  if (brand) {
    const back = document.createElement('a');
    back.className = 'stride-back';
    back.href = '../';
    back.setAttribute('aria-label', 'STRIDE のホームに戻る');
    back.textContent = '‹ STRIDE';
    brand.prepend(back);
  }

  // 保存場所の表示はサマリー（未完了・作業中…）のすぐ下に置く
  // （ヘッダーの下端はサマリーが重なるため、そこに置くと隠れてしまう）
  const summary = document.querySelector('.summary');
  if (summary) {
    const note = document.createElement('p');
    note.className = 'stride-local-note container';
    note.textContent = '🔒 データはこの端末の中だけに保存されます（同期なし・サーバーには送信しません）';
    summary.after(note);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('../sw.js').catch(() => {});
  }
})();
