// ホーム画面（ダッシュボード）
import { bmi, bmiCategory, fmtNum, latestWeight, startWeight } from '../calc.js';
import { fmtDateShort, h } from '../ui.js';
import { goalCards } from './home-goal.js';

export function render(root, app) {
  const { weights } = app.data;
  const { heightCm } = app.data.settings;
  const latest = latestWeight(weights);
  const start = startWeight(weights);

  // 入力ボタン（大きく配置）
  root.append(h('section', { class: 'quick-add', 'aria-label': '記録を入力' },
    quickButton('体重', 'を記録', 'weight', app),
    quickButton('筋トレ', 'を記録', 'strength', app),
    quickButton('ジョギング', 'を記録', 'jog', app),
  ));

  if (!latest) {
    root.append(h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'はじめに' }),
      h('p', { text: '上のボタンから体重を記録すると、ここに現在の体重や BMI が表示されます。' }),
      h('p', { class: 'card-note', text: '動作を試すときは、設定画面の「危険な操作」からサンプルデータを生成できます。' }),
    ));
    return;
  }

  const b = bmi(latest.weightKg, heightCm);
  const diff = start && start.id !== latest.id ? latest.weightKg - start.weightKg : null;
  root.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: '現在の体重' }),
    h('div', { class: 'hero' },
      h('span', { class: 'hero-value', text: fmtNum(latest.weightKg) }),
      h('span', { class: 'hero-unit', text: 'kg' }),
    ),
    h('p', { class: 'card-note', text: `${fmtDateShort(latest.date)} の記録` }),
    h('div', { class: 'stats' },
      stat('BMI', b ? String(b) : '-', bmiCategory(b)),
      stat('開始時からの増減', diff == null ? '-' : signed(diff) + 'kg', start ? `開始 ${fmtDateShort(start.date)} ${fmtNum(start.weightKg)}kg` : ''),
    ),
  ));

  root.append(...goalCards(app, latest));
}

function quickButton(label, suffix, type, app) {
  return h('button', {
    type: 'button', class: `quick-btn quick-${type}`,
    onclick: () => app.navigate('records', { type }),
  }, h('span', { class: 'quick-plus', 'aria-hidden': 'true', text: '＋' }), h('span', { text: label }), h('small', { text: suffix }));
}

export function stat(label, value, sub) {
  return h('div', { class: 'stat' },
    h('span', { class: 'stat-label', text: label }),
    h('span', { class: 'stat-value', text: value }),
    sub ? h('span', { class: 'stat-sub', text: sub }) : null,
  );
}

export function signed(v, digits = 1) {
  const n = Number(fmtNum(v, digits));
  if (n === 0) return '±0';
  return (n > 0 ? '+' : '') + fmtNum(v, digits);
}
