// 運動カレンダー: 月表示・週ごとの運動日数・ストリーク・日付ごとの記録
import {
  addDays, epley1RM, exerciseDays, fmtInt, fmtNum, formatDuration, formatPace, paceSecPerKm,
  streakWeeks, todayStr, weekStart, weeklyCounts,
} from '../calc.js';
import { fmtDateLong, h } from '../ui.js';

const WD = ['月', '火', '水', '木', '金', '土', '日'];

// 画面をまたいで保持する状態（表示中の月 "YYYY-MM" と選択中の日付）
const state = { month: null, selected: null };

export function render(root, app) {
  const today = todayStr();
  if (!state.month) state.month = today.slice(0, 7);
  if (!state.selected) state.selected = today;

  const goal = app.data.settings.weeklyGoalDays;
  const days = exerciseDays(app.data);
  const counts = weeklyCounts(days);
  const strengthDays = new Set(app.data.strength.map((r) => r.date));
  const jogDays = new Set(app.data.jogs.map((r) => r.date));
  const streak = streakWeeks(days, goal, today);

  // ストリーク
  root.append(h('section', { class: 'streak-card' },
    h('div', { class: 'streak-flame', 'aria-hidden': 'true', text: '🔥' }),
    h('div', {},
      h('p', { class: 'streak-label', text: '連続達成' }),
      h('p', { class: 'streak-value' }, h('strong', { text: String(streak) }), ' 週'),
    ),
    h('p', { class: 'streak-goal', text: `目標: 週 ${goal} 日` }),
  ));

  // 月の見出しと移動ボタン
  const [y, m] = state.month.split('-').map(Number);
  const move = (delta) => {
    const d = new Date(y, m - 1 + delta, 1);
    state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    app.render();
  };
  const isCurrentMonth = state.month === today.slice(0, 7);

  // 月の集計
  const inMonth = (r) => r.date.startsWith(state.month);
  const monthDays = [...days].filter((d) => d.startsWith(state.month)).length;
  const monthStrength = new Set(app.data.strength.filter(inMonth).map((r) => r.date)).size;
  const monthJogKm = app.data.jogs.filter(inMonth).reduce((s, j) => s + j.distanceKm, 0);

  const card = h('section', { class: 'card cal-card' },
    h('div', { class: 'cal-head' },
      h('button', { type: 'button', class: 'cal-nav', 'aria-label': '前の月', text: '‹', onclick: () => move(-1) }),
      h('h2', { class: 'cal-title', text: `${y}年${m}月` }),
      h('button', { type: 'button', class: 'cal-nav', 'aria-label': '次の月', text: '›', onclick: () => move(1) }),
    ),
    isCurrentMonth ? null : h('button', {
      type: 'button', class: 'cal-today', text: '今月に戻る',
      onclick: () => { state.month = today.slice(0, 7); state.selected = today; app.render(); },
    }),
    h('div', { class: 'cal-summary' },
      h('span', {}, '運動 ', h('strong', { text: String(monthDays) }), ' 日'),
      h('span', {}, h('i', { class: 'mark mark-strength' }), ' 筋トレ ', h('strong', { text: String(monthStrength) }), ' 日'),
      h('span', {}, h('i', { class: 'mark mark-jog' }), ' ジョギング ', h('strong', { text: fmtNum(monthJogKm, 1) }), ' km'),
    ),
  );

  // カレンダー本体（月曜始まり、右端に週の運動日数）
  const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': `${y}年${m}月の運動カレンダー` });
  grid.append(h('div', { class: 'cal-row cal-weekdays', role: 'row' },
    WD.map((w, i) => h('span', { class: `cal-wd${i === 5 ? ' sat' : i === 6 ? ' sun' : ''}`, role: 'columnheader', text: w })),
    h('span', { class: 'cal-wd cal-wk', role: 'columnheader', text: '日数' }),
  ));

  const first = `${state.month}-01`;
  let wk = weekStart(first);
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${state.month}-${String(lastDay).padStart(2, '0')}`;
  while (wk <= last) {
    const count = counts.get(wk) || 0;
    const achieved = count >= goal;
    const row = h('div', { class: `cal-row${achieved ? ' achieved' : ''}`, role: 'row' });
    for (let i = 0; i < 7; i++) {
      const d = addDays(wk, i);
      const s = strengthDays.has(d);
      const j = jogDays.has(d);
      const cls = ['cal-day'];
      if (!d.startsWith(state.month)) cls.push('other');
      if (d === today) cls.push('today');
      if (d === state.selected) cls.push('selected');
      if (d > today) cls.push('future');
      if (i === 5) cls.push('sat');
      if (i === 6) cls.push('sun');
      const what = [s ? '筋トレ' : null, j ? 'ジョギング' : null].filter(Boolean).join('と') || '運動なし';
      row.append(h('button', {
        type: 'button', class: cls.join(' '), role: 'gridcell',
        'aria-label': `${fmtDateLong(d)} ${what}`, 'aria-selected': String(d === state.selected),
        onclick: () => { state.selected = d; app.render(); },
      },
      h('span', { class: 'cal-num', text: String(Number(d.slice(8))) }),
      h('span', { class: 'marks' },
        s ? h('i', { class: 'mark mark-strength' }) : null,
        j ? h('i', { class: 'mark mark-jog' }) : null,
      )));
    }
    const futureWeek = wk > today; // まだ来ていない週は日数を出さない
    row.append(h('span', {
      class: 'cal-wk', role: 'gridcell',
      'aria-label': futureWeek ? 'これからの週' : `この週の運動 ${count} 日${achieved ? '（目標達成）' : ''}`,
    }, futureWeek ? null : achieved ? h('span', { class: 'wk-badge', text: `${count}` }) : h('span', { class: 'wk-count', text: `${count}` })));
    grid.append(row);
    wk = addDays(wk, 7);
  }
  card.append(grid);
  card.append(h('p', { class: 'cal-legend' },
    h('span', {}, h('i', { class: 'mark mark-strength' }), ' 筋トレ'),
    h('span', {}, h('i', { class: 'mark mark-jog' }), ' ジョギング'),
    h('span', {}, h('span', { class: 'wk-badge small', text: 'n' }), ` 週の目標（${goal} 日）達成`),
  ));
  root.append(card);

  root.append(dayDetail(app, state.selected, today));
}

/** 選択した日の記録 */
function dayDetail(app, date, today) {
  const weights = app.data.weights.filter((x) => x.date === date);
  const strength = app.data.strength.filter((x) => x.date === date);
  const jogs = app.data.jogs.filter((x) => x.date === date);
  const daily = app.data.daily.filter((x) => x.date === date);
  const edit = (type, id) => app.navigate('records', { type, editId: id });

  const items = [
    ...weights.map((w) => item('weight', '体重', `${fmtNum(w.weightKg)}kg${w.bodyFatPct != null ? `　体脂肪 ${fmtNum(w.bodyFatPct)}%` : ''}`, w.memo, () => edit('weight', w.id))),
    ...strength.map((r) => item('strength', r.exercise, `${fmtNum(r.weightKg)}kg × ${r.reps}回 × ${r.sets}セット　1RM ${fmtNum(epley1RM(r.weightKg, r.reps))}kg`, r.memo, () => edit('strength', r.id))),
    ...daily.map((d) => item('daily', '食事・歩数', [d.intakeKcal != null ? `${fmtInt(d.intakeKcal)}kcal` : null, d.steps != null ? `${fmtInt(d.steps)}歩` : null].filter(Boolean).join('　'), d.memo, () => edit('daily', d.id))),
    ...jogs.map((j) => item('jog', 'ジョギング', `${fmtNum(j.distanceKm, 2)}km　${formatDuration(j.durationSec)}　${formatPace(paceSecPerKm(j.durationSec, j.distanceKm))}/km`, j.memo, () => edit('jog', j.id))),
  ];

  const card = h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: fmtDateLong(date) }),
  );
  if (items.length) card.append(h('ul', { class: 'day-list' }, items));
  else card.append(h('p', { class: 'empty', text: date > today ? 'まだ先の日付です。' : 'この日の記録はありません。' }));

  if (date <= today) {
    card.append(h('div', { class: 'day-add' },
      h('span', { class: 'card-note', text: 'この日の記録を追加:' }),
      ...[['weight', '体重'], ['strength', '筋トレ'], ['jog', 'ジョギング'], ['daily', '食事・歩数']].map(([type, label]) =>
        h('button', { type: 'button', class: 'btn btn-sm', text: `＋${label}`, onclick: () => app.navigate('records', { type, date }) })),
    ));
  }
  return card;
}

function item(kind, title, detail, memo, onclick) {
  return h('li', {},
    h('button', { type: 'button', class: `day-item day-${kind}`, onclick, 'aria-label': `${title} を編集` },
      h('span', { class: 'day-kind', text: title }),
      h('span', { class: 'day-detail', text: detail }),
      memo ? h('span', { class: 'record-memo', text: memo }) : null,
    ),
  );
}
