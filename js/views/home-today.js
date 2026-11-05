// ホーム画面の「今日の予定・習慣」カード（v2.7.0）
// 今日の運動の予定（できたか）、休みが続いているときのお知らせ、今日の習慣チェックをまとめて表示する。
import { todayStr } from '../calc.js';
import { habitStreak, habitsDoneOn, planDone, planTitle, plansOn, restAlertDue, restMessage } from '../plans.js';
import { h } from '../ui.js';
import { toggleHabit } from './calendar.js';

export function todayCard(app) {
  const today = todayStr();
  const plans = plansOn(app.data, today);
  const rest = restAlertDue(app.data, today);
  const habits = app.data.habits || [];
  if (!plans.length && !rest && !habits.length) return null;

  const card = h('section', { class: 'card today-card' }, h('h2', { class: 'card-title', text: '今日の予定・習慣' }));

  if (rest) card.append(h('p', { class: 'notice notice-warn rest-alert', text: `💤 ${restMessage(rest)}` }));

  if (plans.length) {
    card.append(h('ul', { class: 'day-list' }, plans.map((p) => {
      const done = planDone(p, app.data);
      return h('li', {},
        h('button', {
          type: 'button', class: `day-item day-plan${done ? ' done' : ''}`,
          onclick: () => app.navigate('records', { type: p.kind === 'jog' ? 'jog' : 'strength' }),
          'aria-label': `${planTitle(p)}（${done ? 'できた' : 'これから'}）。記録する`,
        },
        h('span', { class: 'day-kind', text: `${p.time ? `${p.time}　` : ''}${planTitle(p)}` }),
        h('span', { class: 'day-detail', text: done ? '✔ できた！' : 'これから（終わったらタップして記録）' }),
        ));
    })));
  }

  if (habits.length) {
    const done = habitsDoneOn(app.data, today);
    card.append(
      h('h3', { class: 'day-sub', text: `今日の習慣（${done.size} / ${habits.length}）` }),
      h('div', { class: 'habit-chips' }, habits.map((x) => {
        const streak = habitStreak(app.data, x.id, today);
        return h('button', {
          type: 'button', class: `habit-chip${done.has(x.id) ? ' on' : ''}`, 'aria-pressed': String(done.has(x.id)),
          text: `${done.has(x.id) ? '✔ ' : ''}${x.name}${streak >= 2 ? `　🔥${streak}` : ''}`,
          onclick: () => toggleHabit(app, x.id, today),
        });
      })),
    );
  }

  card.append(h('button', { type: 'button', class: 'btn btn-block', text: '予定を入れる・見る（カレンダー）', onclick: () => app.navigate('calendar', { date: today }) }));
  return card;
}
