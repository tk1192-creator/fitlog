// アプリ本体: データの保持・タブ切替・画面の再描画
import { load, save } from './storage.js';
import * as home from './views/home.js';
import * as records from './views/records.js';
import * as charts from './views/charts.js';
import * as calendar from './views/calendar.js';
import * as settings from './views/settings.js';
import { toast } from './ui.js';

const VIEWS = { home, records, charts, calendar, settings };
const TITLES = { home: 'ホーム', records: '記録', charts: 'グラフ', calendar: 'カレンダー', settings: '設定' };

const app = {
  data: load(),
  current: 'home',
  params: {},

  /** データを変更して保存し、画面を描き直す。fn はデータを直接書き換える */
  update(fn) {
    fn(this.data);
    if (!save(this.data)) toast('保存に失敗しました。空き容量を確認してください');
    this.render();
  },

  /** データ全体を置き換える（インポート・サンプル生成・全削除） */
  replaceData(next) {
    this.data = next;
    if (!save(this.data)) toast('保存に失敗しました。空き容量を確認してください');
    this.render();
  },

  /** タブを切り替える。params はその画面に渡す指定（例: {type: 'jog'}） */
  navigate(tab, params = {}) {
    this.current = tab;
    this.params = params;
    document.querySelectorAll('.tab').forEach((b) => {
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
    const root = document.getElementById('view');
    const view = VIEWS[this.current];
    if (view.unmount) view.unmount();
    root.replaceChildren();
    view.render(root, this, this.params);
    this.params = {};
  },
};

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => app.navigate(b.dataset.tab)));

// OS のダーク / ライト切替時にグラフの色を描き直す
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => app.render());

app.navigate('home');

// デバッグ用（ブラウザのコンソールから参照できるように）
window.fitlog = app;
