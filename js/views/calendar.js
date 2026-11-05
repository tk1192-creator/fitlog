// 運動カレンダー: 月表示・週ごとの運動日数・ストリーク・日付ごとの記録
import {
  addDays, epley1RM, exerciseDays, fmtInt, fmtNum, formatDuration, formatPace, paceSecPerKm,
  streakWeeks, todayStr, weekStart, weeklyCounts,
} from '../calc.js';
import { field, fmtDateLong, h, toast } from '../ui.js';
import { newId } from '../storage.js';
import { PLAN_KINDS, PLAN_KIND_LABEL, habitsDoneOn, planDone, planTitle, plansOn } from '../plans.js';
import { TASK_STATUS_LABEL, loadTasks, tasksByDue } from './home-tasks.js';

const WD = ['月', '火', '水', '木', '金', '土', '日'];

// 画面をまたいで保持する状態（表示中の月 "YYYY-MM" と選択中の日付）
const state = { month: null, selected: null };

export function render(root, app, params = {}) {
  const today = todayStr();
  // ホームなどから日付を指定して開かれたとき（1 回だけ使う）
  if (params.date) {
    state.selected = params.date;
    state.month = params.date.slice(0, 7);
    delete params.date;
  }
  if (!state.month) state.month = today.slice(0, 7);
  if (!state.selected) state.selected = today;

  const goal = app.data.settings.weeklyGoalDays;
  const days = exerciseDays(app.data);
  const counts = weeklyCounts(days);
  const strengthDays = new Set(app.data.strength.map((r) => r.date));
  const jogDays = new Set(app.data.jogs.map((r) => r.date));
  const streak = streakWeeks(days, goal, today);
  // タスクの期限（Task Board のデータを読むだけ。この端末の中だけで表示する）
  const taskMap = tasksByDue(loadTasks() || []);
  const openTasksOn = (d) => (taskMap.get(d) || []).filter((t) => t.status !== 'done');

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
  const monthTasks = [...taskMap.entries()].filter(([d]) => d.startsWith(state.month)).reduce((n, [d]) => n + openTasksOn(d).length, 0);

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
      taskMap.size ? h('span', {}, h('i', { class: 'mark mark-task' }), ' タスク期限 ', h('strong', { text: String(monthTasks) }), ' 件') : null,
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
      const tk = openTasksOn(d);
      const pl = plansOn(app.data, d);
      const plOpen = pl.filter((p) => !planDone(p, app.data)); // まだ記録していない予定
      const late = tk.length > 0 && d < today; // 期限切れ
      const what = ([s ? '筋トレ' : null, j ? 'ジョギング' : null].filter(Boolean).join('と') || '運動なし')
        + (pl.length ? `、運動の予定 ${pl.length} 件` : '')
        + (tk.length ? `、タスクの期限 ${tk.length} 件${late ? '（期限切れ）' : ''}` : '');
      row.append(h('button', {
        type: 'button', class: cls.join(' '), role: 'gridcell',
        'aria-label': `${fmtDateLong(d)} ${what}`, 'aria-selected': String(d === state.selected),
        onclick: () => { state.selected = d; app.render(); },
      },
      h('span', { class: 'cal-num', text: String(Number(d.slice(8))) }),
      h('span', { class: 'marks' },
        s ? h('i', { class: 'mark mark-strength' }) : null,
        j ? h('i', { class: 'mark mark-jog' }) : null,
        plOpen.length ? h('i', { class: `mark mark-plan${d < today ? ' missed' : ''}` }) : null,
        tk.length ? h('i', { class: `mark mark-task${late ? ' late' : ''}` }) : null,
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
    h('span', {}, h('i', { class: 'mark mark-plan' }), ' 運動の予定'),
    taskMap.size ? h('span', {}, h('i', { class: 'mark mark-task' }), ' タスクの期限') : null,
    h('span', {}, h('span', { class: 'wk-badge small', text: 'n' }), ` 週の目標（${goal} 日）達成`),
  ));
  root.append(card);

  root.append(dayDetail(app, state.selected, today, taskMap.get(state.selected) || []));
}

/** 選択した日の記録 */
function dayDetail(app, date, today, tasks) {
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

  card.append(planSection(app, date, today));
  const habits = habitSection(app, date, today);
  if (habits) card.append(habits);

  // この日が期限のタスク（タップでタスク画面へ）
  if (tasks.length) {
    card.append(h('h3', { class: 'day-sub', text: `この日が期限のタスク（${tasks.length} 件）` }),
      h('ul', { class: 'day-list' }, tasks.map((t) => {
        const done = t.status === 'done';
        const late = !done && date < today;
        const status = `${TASK_STATUS_LABEL[t.status] || ''}${late ? '・期限切れ' : ''}`;
        return h('li', {},
          h('button', { type: 'button', class: `day-item day-task${done ? ' done' : ''}${late ? ' late' : ''}`, onclick: () => { location.href = './tasks/'; }, 'aria-label': `タスク ${t.title || '（無題）'}（${status}）をタスク画面で開く` },
            h('span', { class: 'day-kind', text: t.title || '（無題）' }),
            h('span', { class: 'day-detail', text: [status, t.assignee ? `担当 ${t.assignee}` : null].filter(Boolean).join('　') }),
          ));
      })));
  }

  if (date <= today) {
    card.append(h('div', { class: 'day-add' },
      h('span', { class: 'card-note', text: 'この日の記録を追加:' }),
      ...[['weight', '体重'], ['strength', '筋トレ'], ['jog', 'ジョギング'], ['daily', '食事・歩数']].map(([type, label]) =>
        h('button', { type: 'button', class: 'btn btn-sm', text: `＋${label}`, onclick: () => app.navigate('records', { type, date }) })),
    ));
  }
  return card;
}

/** 運動の予定（その日の一覧と、今日以降なら追加の欄） */
function planSection(app, date, today) {
  const list = plansOn(app.data, date);
  const box = h('div', { class: 'plan-box' }, h('h3', { class: 'day-sub', text: '運動の予定' }));
  if (list.length) {
    box.append(h('ul', { class: 'day-list' }, list.map((p) => {
      const done = planDone(p, app.data);
      const label = done ? '✔ できた' : date < today ? 'できなかった' : date === today ? 'これから' : '予定';
      return h('li', { class: 'plan-row' },
        h('div', { class: `day-item day-plan${done ? ' done' : ''}` },
          h('span', { class: 'day-kind', text: `${p.time ? `${p.time}　` : ''}${planTitle(p)}` }),
          h('span', { class: 'day-detail', text: `${PLAN_KIND_LABEL[p.kind]}・${label}${p.memo ? `　${p.memo}` : ''}` }),
        ),
        h('button', {
          type: 'button', class: 'plan-del', 'aria-label': `予定「${planTitle(p)}」を消す`, text: '×',
          onclick: () => { app.update((d) => { d.plans = d.plans.filter((x) => x.id !== p.id); }); toast('予定を消しました'); },
        }));
    })));
  } else if (date < today) {
    box.append(h('p', { class: 'card-note', text: 'この日の予定はありませんでした。' }));
  }
  if (date >= today) {
    const time = h('input', { type: 'time', name: 'time', step: '300' });
    const kind = h('select', { name: 'kind' }, PLAN_KINDS.map(([v, l]) => h('option', { value: v, text: l })));
    const title = h('input', { type: 'text', name: 'title', maxlength: '30', placeholder: '例：ジム、朝ラン（空欄なら種類）' });
    const form = h('form', { class: 'plan-form' },
      h('div', { class: 'row-2' }, field('時刻（任意）', time), field('種類', kind)),
      field('名前（任意）', title),
      h('button', { type: 'submit', class: 'btn btn-primary btn-block', text: '＋ この日に予定を入れる' }),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const rec = { id: newId(), date, time: time.value || '', kind: kind.value, title: title.value.trim().slice(0, 30), memo: '' };
      app.update((d) => { d.plans.push(rec); });
      toast(`予定を入れました${rec.time ? `（${rec.time}）` : ''}`);
    });
    box.append(form);
  }
  return box;
}

/** 習慣チェック（項目があるときだけ。今日以前ならチェックを付け外しできる） */
function habitSection(app, date, today) {
  const habits = app.data.habits || [];
  if (!habits.length) return null;
  const done = habitsDoneOn(app.data, date);
  return h('div', {},
    h('h3', { class: 'day-sub', text: `習慣（${done.size} / ${habits.length}）` }),
    h('div', { class: 'habit-chips' }, habits.map((x) => h('button', {
      type: 'button', class: `habit-chip${done.has(x.id) ? ' on' : ''}`, disabled: date > today,
      'aria-pressed': String(done.has(x.id)), text: `${done.has(x.id) ? '✔ ' : ''}${x.name}`,
      onclick: () => toggleHabit(app, x.id, date),
    }))),
  );
}

/** 習慣のチェックを付ける・外す（ホームからも使う） */
export function toggleHabit(app, habitId, date) {
  app.update((d) => {
    const i = d.habitLogs.findIndex((l) => l.habitId === habitId && l.date === date);
    if (i >= 0) d.habitLogs.splice(i, 1);
    else d.habitLogs.push({ id: newId(), date, habitId });
  });
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
