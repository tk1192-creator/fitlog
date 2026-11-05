// ホーム画面の「目標」と「今週の運動」カード
import { addDays, daysBetween, energyPlan, exerciseDays, fmtInt, fmtNum, startWeight, streakWeeks, todayStr, weekStart, weeklyChangeNeeded } from '../calc.js';
import { goalDirection, meetsGoal } from '../pb.js';
import { INTAKE_MIN_DAYS, estimatedExpenditure, forecastGoal, weightTrend } from '../trend.js';
import { evaluateBadges, milestoneState } from '../badges.js';
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
  return [goalCard(app, latest), energyCard(app, latest), weekCard(app)];
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
    stats.push(stat('目標達成日まで', days > 0 ? `残り ${days}日` : days === 0 ? '今日' : '期日超過', fmtDateLong(targetDate)));
    if (!reached && need != null) {
      const perWeek = Math.abs(need);
      stats.push(stat('1週間あたりの目安', `${need > 0 ? '-' : '+'}${fmtNum(perWeek, 2)}kg`, paceNote(perWeek, latest.weightKg)));
    }
  }

  // 今のペースと達成見込み（直近 4 週の体重の傾向）
  const trend = weightTrend(app.data.weights, today);
  if (trend) {
    stats.push(stat('今のペース', `${signed(trend.perWeek, 2)}kg/週`, '直近 4 週の傾向'));
    if (!reached) stats.push(forecastStat(forecastGoal(trend, target, today), direction, targetDate, today));
  }

  card.append(h('div', { class: 'stats' }, stats));
  if (!trend) card.append(h('p', { class: 'card-note', text: '体重を 2 週間以上（5 回以上）記録すると、今のペースと目標の達成見込みを表示します。' }));
  if (progress != null) {
    card.append(
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': '目標への進捗', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progress) },
        h('div', { class: 'progress-bar', style: `width:${progress}%` }),
      ),
      h('p', { class: 'card-note', text: `開始時（${fmtNum(start.weightKg)}kg）から目標までの ${progress}% を達成` }),
    );
  }
  // 次の節目（目標までを 1kg ごとに区切ったもの。7 日平均で判定）
  const ms = reached ? null : milestoneState(app.data);
  if (ms && ms.next != null) {
    card.append(h('p', { class: 'milestone-note' },
      '🎯 次の節目 ', h('strong', { text: `${fmtNum(ms.next)}kg` }), ' まで あと ', h('strong', { text: `${fmtNum(ms.remain, 1)}kg` }),
      h('span', { class: 'milestone-sub', text: `（7 日平均 ${fmtNum(ms.current, 1)}kg・節目 ${ms.reached.length}/${ms.steps.length} 達成）` }),
    ));
  }
  return card;
}

/** 達成見込み（今のペースが続いた場合に目標体重に届く日） */
function forecastStat(f, direction, targetDate, today) {
  if (f.status === 'ok') {
    const [y, m, d] = f.date.split('-').map(Number);
    let sub = 'このペースが続いた場合';
    if (targetDate && targetDate >= today) {
      const gap = daysBetween(f.date, targetDate); // 正なら目標日より早い
      sub = gap > 0 ? `目標日より ${gap} 日早い見込み` : gap < 0 ? `⚠ 目標日より ${-gap} 日遅れる見込み` : '目標日ちょうどの見込み';
    }
    return stat('達成見込み', `${y}/${m}/${d}`, sub);
  }
  const text = {
    reached: ['もうすぐ', '傾向では目標に届いています'],
    flat: ['横ばい', '体重がほとんど変わっていません'],
    away: ['逆向き', direction === 'gain' ? '体重が減る傾向です' : '体重が増える傾向です'],
    far: ['2 年以上先', '今のペースでは時間がかかります'],
  }[f.status];
  return stat('達成見込み', text[0], text[1]);
}

/** 1 週間あたりの変化量が大きすぎないかの目安（体重の 1%/週 を超えたら注意） */
function paceNote(perWeek, weightKg) {
  return perWeek > weightKg * 0.01 ? '⚠ 急なペースです。期日の見直しも検討を' : '無理のないペースです';
}

/* ---------- 今日のカロリー・歩数 ---------- */

function meter(label, value, unit, target, cls, sub) {
  const pct = target > 0 && value != null ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return h('div', { class: 'meter' },
    h('div', { class: 'meter-head' },
      h('span', { text: label }),
      h('span', {}, h('strong', { text: value == null ? '-' : fmtInt(value) }), ` / ${target ? fmtInt(target) : '-'} ${unit}`),
    ),
    h('div', { class: 'meter-track', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
      h('div', { class: `meter-fill ${cls}`, style: `width:${pct}%` }),
    ),
    sub ? h('p', { class: 'meter-sub', text: sub }) : null,
  );
}

function energyCard(app, latest) {
  const s = app.data.settings;
  const today = todayStr();
  const rec = app.data.daily.find((x) => x.date === today);
  const plan = energyPlan({ ...s, weightKg: latest.weightKg, today });
  const card = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: '今日のカロリー・歩数' }));

  if (!plan) {
    card.append(
      h('p', { class: 'card-note', text: '設定で性別を入力すると、基礎代謝と 1 日のカロリーの目安を表示します。' }),
      h('button', { type: 'button', class: 'btn btn-block', text: '性別を設定する', onclick: () => app.navigate('settings') }),
    );
  } else {
    card.append(h('div', { class: 'stats stats-3' },
      stat('基礎代謝', `${fmtInt(plan.bmr)}`, 'kcal/日'),
      stat('消費の目安', `${fmtInt(plan.tdee)}`, `kcal/日（×${plan.factor}）`),
      stat('摂取の目安', plan.intakeTarget != null ? `${fmtInt(plan.intakeTarget)}` : '-', plan.intakeTarget != null ? 'kcal/日' : '目標達成日の設定で表示'),
    ));
    card.append(expenditureNote(app, plan, today));
    if (plan.belowBmr) {
      card.append(h('p', { class: 'notice notice-warn', text: '⚠ 摂取の目安が基礎代謝を下回っています。無理な減量ペースなので、目標達成日を延ばすことを検討してください。' }));
    }
    const target = plan.intakeTarget ?? plan.tdee;
    const k = rec?.intakeKcal ?? null;
    const over = k != null && k > target;
    card.append(meter('摂取カロリー', k, 'kcal', target, over ? 'over' : 'kcal',
      k == null ? 'まだ記録がありません' : over ? `目安を ${fmtInt(k - target)}kcal 超えています` : `目安まであと ${fmtInt(target - k)}kcal`));
  }

  const st = rec?.steps ?? null;
  const done = st != null && st >= s.stepGoal;
  card.append(meter('歩数', st, '歩', s.stepGoal, done ? 'done' : '',
    st == null ? 'まだ記録がありません' : done ? '今日の目標達成！' : `目標まであと ${fmtInt(s.stepGoal - st)} 歩`));
  card.append(h('button', { type: 'button', class: 'btn btn-block', text: '＋ 食事・歩数を記録', onclick: () => app.navigate('records', { type: 'daily' }) }));
  card.append(h('p', { class: 'card-note', text: '基礎代謝は国立健康・栄養研究所の式による推定値、カロリーは脂肪 1kg ≒ 7,200kcal で計算した目安です。' }));
  return card;
}

/** 記録から見た実際の消費（食事の記録と体重の変化から逆算） */
function expenditureNote(app, plan, today) {
  const e = estimatedExpenditure(app.data, today);
  let text;
  if (!e) text = '体重を 2 週間以上・食事を 14 日以上記録すると、記録から見た「実際の消費」を推定します。';
  else if (e.status === 'short') text = `食事をあと ${INTAKE_MIN_DAYS - e.have} 日記録すると、記録から見た「実際の消費」を推定します（直近 4 週で ${e.have} 日）。`;
  else if (e.status === 'odd') text = '食事の記録と体重の変化が合わないため、実際の消費を推定できません（食事の記録漏れがないか確認してください）。';
  if (text) return h('p', { class: 'card-note', text });
  const diff = e.tdee - plan.tdee;
  return h('div', { class: 'estimate' },
    h('div', { class: 'estimate-head' },
      h('span', { text: '記録から見た実際の消費' }),
      h('span', {}, h('strong', { text: fmtInt(e.tdee) }), ' kcal/日'),
    ),
    h('p', { class: 'meter-sub', text: `直近 4 週：平均摂取 ${fmtInt(e.avgIntake)}kcal（${e.days} 日）・体重 ${signed(e.perWeek, 2)}kg/週。式の目安より ${diff >= 0 ? `${fmtInt(diff)}kcal 多い` : `${fmtInt(-diff)}kcal 少ない`}` }),
  );
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
    badgeLink(app),
    h('button', { type: 'button', class: 'btn btn-block week-plan-btn', text: '＋ 運動の予定を入れる', onclick: () => app.navigate('calendar', { date: todayStr() }) }),
  );
}

/** バッジの獲得数（タップでバッジの一覧へ） */
function badgeLink(app) {
  const all = evaluateBadges(app.data);
  const got = all.filter((b) => b.earned).length;
  return h('button', { type: 'button', class: 'week-badges', onclick: () => app.navigate('charts', { kind: 'bests' }) },
    h('span', {}, '🏅 バッジ ', h('strong', { text: `${got} / ${all.length}` })),
    h('span', { 'aria-hidden': 'true', text: '›' }));
}
