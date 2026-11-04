// ホーム画面の「目標」と「今週の運動」カード
import { addDays, daysBetween, exerciseDays, fmtNum, startWeight, streakWeeks, todayStr, weekStart, weeklyChangeNeeded } from '../calc.js';
import { goalDirection, meetsGoal } from '../pb.js';
import { fmtDateLong, h } from '../ui.js';

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

export function goalCards(app, latest) {
  return [goalCard(app, latest), weekCard(app)];
}

/* ---------- 目標 ---------- */

function goalCard(app, latest) {
  const { targetWeightKg: target, targetDate } = app.data.settings;
  const card = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: '目標' }));
  if (!target) {
    card.append(
      h('p', { class: 'card-note', text: '目標体重を設定すると、残りの体重や 1 週間あたりの目安を表示します。' }),
      h('button', { type: 'button', class: 'btn btn-block', text: '目標を設定する', onclick: () => app.navigate('settings') }),
    );
    return card;
  }

  const today = todayStr();
  const start = startWeight(app.data.weights);
  const direction = goalDirection(app.data.weights, target);
  const remain = latest.weightKg - target; // 減量なら正
  const reached = meetsGoal(latest.weightKg, target, direction);

  // 進捗（開始時 → 目標 のうち、どこまで来たか）
  let progress = null;
  if (start && direction) {
    const total = Math.abs(start.weightKg - target);
    const done = direction === 'loss' ? start.weightKg - latest.weightKg : latest.weightKg - start.weightKg;
    progress = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }

  const stats = [
    stat('目標体重', `${fmtNum(target)}kg`),
    stat('目標まで', reached ? '達成！' : `あと ${fmtNum(Math.abs(remain))}kg`, reached ? '目標を達成しています' : direction === 'gain' ? '増量' : '減量'),
  ];

  if (targetDate) {
    const days = daysBetween(today, targetDate);
    const need = weeklyChangeNeeded(latest.weightKg, target, today, targetDate);
    stats.push(stat('目標達成日まで', days > 0 ? `残り ${days}日` : days === 0 ? '今日' : '期日を過ぎました', fmtDateLong(targetDate)));
    if (!reached && need != null) {
      const perWeek = Math.abs(need);
      stats.push(stat('1週間あたりの目安', `${need > 0 ? '-' : '+'}${fmtNum(perWeek, 2)}kg`, paceNote(perWeek, latest.weightKg)));
    }
  }

  card.append(h('div', { class: 'stats' }, stats));
  if (progress != null) {
    card.append(
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': '目標への進捗', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progress) },
        h('div', { class: 'progress-bar', style: `width:${progress}%` }),
      ),
      h('p', { class: 'card-note', text: `開始時（${fmtNum(start.weightKg)}kg）から目標までの ${progress}% を達成` }),
    );
  }
  return card;
}

/** 1 週間あたりの変化量が大きすぎないかの目安（体重の 1%/週 を超えたら注意） */
function paceNote(perWeek, weightKg) {
  return perWeek > weightKg * 0.01 ? '⚠ 急なペースです。期日の見直しも検討を' : '無理のないペースです';
}

/* ---------- 今週の運動 ---------- */

function weekCard(app) {
  const today = todayStr();
  const goal = app.data.settings.weeklyGoalDays;
  const days = exerciseDays(app.data);
  const monday = weekStart(today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const strengthDays = new Set(app.data.strength.map((r) => r.date));
  const jogDays = new Set(app.data.jogs.map((r) => r.date));
  const count = week.filter((d) => days.has(d)).length;
  const streak = streakWeeks(days, goal, today);
  const achieved = count >= goal;

  return h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: '今週の運動' }),
    h('div', { class: 'week-head' },
      h('span', { class: 'week-count' }, h('strong', { text: String(count) }), ` / ${goal} 日`),
      achieved ? h('span', { class: 'badge', text: '今週の目標達成！' }) : h('span', { class: 'card-note', text: `あと ${goal - count} 日` }),
    ),
    h('ol', { class: 'week-dots', 'aria-label': '今週の運動した日' },
      week.map((d, i) => {
        const s = strengthDays.has(d);
        const j = jogDays.has(d);
        const label = ['月', '火', '水', '木', '金', '土', '日'][i];
        const what = [s ? '筋トレ' : null, j ? 'ジョギング' : null].filter(Boolean).join('・') || (d > today ? '' : 'なし');
        return h('li', { class: `week-day${d === today ? ' today' : ''}`, 'aria-label': `${label}曜日 ${what}` },
          h('span', { class: 'wd', text: label }),
          h('span', { class: 'marks' },
            s ? h('i', { class: 'mark mark-strength' }) : null,
            j ? h('i', { class: 'mark mark-jog' }) : null,
            !s && !j ? h('i', { class: 'mark mark-none' }) : null,
          ),
        );
      }),
    ),
    h('p', { class: 'streak' }, '🔥 連続達成 ', h('strong', { text: `${streak} 週` }), streak ? '' : '（今週から始めましょう）'),
  );
}
