// ホーム画面（ダッシュボード）
import { bmi, bmiCategory, fmtNum, latestWeight, startWeight } from '../calc.js';
import { fmtDateShort, h } from '../ui.js';
import { goalCards, signed } from './home-goal.js';
import { tasksCard } from './home-tasks.js';

export function render(root, app) {
  const { weights } = app.data;
  const { heightCm } = app.data.settings;
  const latest = latestWeight(weights);
  const start = startWeight(weights);

  if (!latest) {
    root.append(
      h('section', { class: 'hero-card' },
        h('p', { class: 'hero-eyebrow', text: 'WELCOME' }),
        h('h2', { class: 'hero-headline', text: '今日から記録を始めよう' }),
        h('p', { class: 'hero-text', text: '下のボタンから体重を記録すると、ここに現在の体重や BMI が表示されます。' }),
      ),
      quickAdd(app),
      tasksCard(),
      h('p', { class: 'card-note center', text: '動作を試すときは、設定画面の「危険な操作」からサンプルデータを生成できます。' }),
    );
    return;
  }

  const b = bmi(latest.weightKg, heightCm);
  const diff = start && start.id !== latest.id ? latest.weightKg - start.weightKg : null;
  root.append(h('section', { class: 'hero-card' },
    h('div', { class: 'hero-top' },
      h('p', { class: 'hero-eyebrow', text: 'CURRENT WEIGHT' }),
      h('span', { class: 'hero-date', text: `${fmtDateShort(latest.date)} の記録` }),
    ),
    h('div', { class: 'hero' },
      h('span', { class: 'hero-value', text: fmtNum(latest.weightKg) }),
      h('span', { class: 'hero-unit', text: 'kg' }),
    ),
    h('div', { class: 'hero-stats' },
      heroStat('BMI', b ? String(b) : '-', bmiCategory(b)),
      heroStat('開始時から', diff == null ? '-' : `${signed(diff)}kg`, start ? `${fmtDateShort(start.date)} ${fmtNum(start.weightKg)}kg` : ''),
      latest.bodyFatPct != null ? heroStat('体脂肪率', `${fmtNum(latest.bodyFatPct)}%`, '') : null,
    ),
  ));

  root.append(quickAdd(app));
  root.append(tasksCard());
  root.append(...goalCards(app, latest));
}

function heroStat(label, value, sub) {
  return h('div', { class: 'hero-stat' },
    h('span', { class: 'hero-stat-label', text: label }),
    h('span', { class: 'hero-stat-value', text: value }),
    sub ? h('span', { class: 'hero-stat-sub', text: sub }) : null,
  );
}

function quickAdd(app) {
  return h('section', { class: 'quick-add', 'aria-label': '記録を入力' },
    quickButton('体重', 'weight', app),
    quickButton('筋トレ', 'strength', app),
    quickButton('ジョギング', 'jog', app),
  );
}

function quickButton(label, type, app) {
  return h('button', {
    type: 'button', class: `quick-btn quick-${type}`,
    onclick: () => app.navigate('records', { type }),
  },
  h('span', { class: 'quick-plus', 'aria-hidden': 'true', text: '＋' }),
  h('span', { class: 'quick-label', text: label }),
  h('small', { text: 'を記録' }));
}
