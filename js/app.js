// アプリ本体: データの保持・タブ切替・画面の再描画
import { load, save } from './storage.js';
import * as home from './views/home.js';
import * as records from './views/records.js';
import * as charts from './views/charts.js';
import * as calendar from './views/calendar.js';
import * as settings from './views/settings.js';
import { toast } from './ui.js';
import { registerSW } from './sw-register.js';
import * as cloud from './cloud.js';

const VIEWS = { home, records, charts, calendar, settings };
const TITLES = { home: 'ホーム', records: '記録', charts: 'グラフ', calendar: 'カレンダー', settings: '設定' };

/** 入力欄で入力中か（同期で画面を描き直すと、入力中の内容が消えるため） */
function isEditing() {
  const el = document.activeElement;
  return Boolean(el && el.closest && el.closest('#view') && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
}

const app = {
  data: load(),
  current: 'home',
  params: {},
  renderLater: false,

  /** データを変更して保存し、画面を描き直す。fn はデータを直接書き換える */
  update(fn) {
    fn(this.data);
    if (!save(this.data)) toast('保存に失敗しました。空き容量を確認してください');
    cloud.markLocalChange();
    this.render();
  },

  /** データ全体を置き換える（インポート・サンプル生成・全削除） */
  replaceData(next) {
    this.data = next;
    if (!save(this.data)) toast('保存に失敗しました。空き容量を確認してください');
    cloud.markLocalChange();
    this.render();
  },

  /** GitHub から読み込んだ記録を反映する（GitHub へ送り返す印は付けない） */
  applyRemote(next) {
    this.data = next;
    save(this.data);
    if (isEditing()) this.renderLater = true; // 入力が終わってから描き直す
    else this.render();
  },

  /** タブを切り替える。params はその画面に渡す指定（例: {type: 'jog'}） */
  navigate(tab, params = {}) {
    this.navCount = (this.navCount || 0) + 1; // 画面を切り替えた回数（カレンダーのシートを閉じる判定に使う）
    this.current = tab;
    this.params = params;
    document.querySelectorAll('.tab[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    document.getElementById('title').textContent = TITLES[tab];
    this.render();
    window.scrollTo(0, 0);
  },

  render() {
    this.renderLater = false;
    const root = document.getElementById('view');
    const view = VIEWS[this.current];
    if (view.unmount) view.unmount();
    document.body.classList.remove('sheet-open'); // シートを開いている画面が、開き直すときにまた付ける
    root.replaceChildren();
    view.render(root, this, this.params);
    this.params = {};
  },
};

// 入力が終わったら、同期で後回しにした描き直しを行う
document.addEventListener('focusout', () => {
  setTimeout(() => { if (app.renderLater && !isEditing()) app.render(); }, 0);
});

// data-tab を持つタブだけがアプリ内の画面切替。「タスク」タブは別ページ（tasks/）へのリンク
document.querySelectorAll('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => app.navigate(b.dataset.tab)));

// OS のダーク / ライト切替時にグラフの色を描き直す
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => app.render());

// 上部バーの日付・時刻（1 秒ごとに更新。日付が変わったら画面も描き直す）
const WD = ['日', '月', '火', '水', '木', '金', '土'];
let lastDate = null;
function tick() {
  const now = new Date();
  const date = `${now.getMonth() + 1}月${now.getDate()}日(${WD[now.getDay()]})`;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('clock-date').textContent = date;
  const t = document.getElementById('clock-time');
  t.dateTime = now.toISOString();
  t.innerHTML = `${hh}<span class="colon">:</span>${mm}<small>${ss}</small>`;
  // 日付が変わったら「今日」の表示を更新（入力中のフォームを消さないよう、ホームとカレンダーのみ）
  if (lastDate && lastDate !== date && (app.current === 'home' || app.current === 'calendar')) app.render();
  lastDate = date;
}
tick();
setInterval(tick, 1000);

// 上部バーの保存状態（GitHub への保存）
const syncEl = document.getElementById('sync-indicator');
if (syncEl) {
  cloud.onStatus((s) => {
    syncEl.hidden = false;
    syncEl.dataset.status = s.status;
    syncEl.title = s.status === 'off' ? 'GitHub への保存：未設定' : `GitHub への保存：${s.label}${s.lastError ? `（${s.lastError}）` : ''}`;
    syncEl.setAttribute('aria-label', syncEl.title);
  });
  syncEl.addEventListener('click', () => app.navigate('settings'));
}

// タスク画面の下部タブから ./#records などで来たときは、その画面を開く（URL の # は消す）
const initialTab = location.hash.slice(1);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
app.navigate(VIEWS[initialTab] ? initialTab : 'home');
registerSW();

// GitHub との同期（起動時・アプリに戻ったとき・電波が戻ったとき・記録を変えたとき）
cloud.attachApp(app);
cloud.startAutoSync();

// デバッグ用（ブラウザのコンソールから参照できるように）
window.fitlog = app;
