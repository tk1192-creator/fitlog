// バッジ（実績）と体重の節目（v2.6.0）
// どちらも記録全体から計算する（保存するのは「もうお祝いしたもの」の一覧だけ）。
// そのため、v2.6.0 より前の記録で達成していたバッジも、最初から獲得済みとして表示される。
import { exerciseDays, fmtNum, movingAverage, paceSecPerKm, round, sortByDate, weeklyCounts, addDays } from './calc.js';
import { PACE_MIN_KM, computeBests, goalDirection } from './pb.js';
import { pbEventsBetween } from './share.js';

/* ---------- 指標の推移（日付ごとの値。バッジの獲得日を求めるのに使う） ---------- */

/** 日付順の記録を足し上げる（同じ日は 1 点にまとめる） */
function cumulative(items, valueOf) {
  const out = [];
  let sum = 0;
  for (const it of items) {
    sum += valueOf(it);
    if (out.length && out[out.length - 1].date === it.date) out[out.length - 1].value = sum;
    else out.push({ date: it.date, value: sum });
  }
  return out;
}

/** その日までの最大（lower なら最小） */
function runningBest(points, lower = false) {
  const out = [];
  let best = null;
  for (const p of points) {
    if (best == null || (lower ? p.value < best : p.value > best)) best = p.value;
    out.push({ date: p.date, value: best });
  }
  return out;
}

const count = (dates) => dates.map((date, i) => ({ date, value: i + 1 }));

/** 週の目標を何週続けて達成したか（その時点までの最長） */
function streakTimeline(data) {
  const days = exerciseDays(data);
  if (!days.size) return [];
  const goal = data.settings.weeklyGoalDays || 3;
  const counts = weeklyCounts(days);
  const sorted = [...days].sort();
  const weeks = [...counts.keys()].sort();
  const out = [];
  let run = 0;
  let best = 0;
  for (let wk = weeks[0]; wk <= weeks[weeks.length - 1]; wk = addDays(wk, 7)) {
    const n = counts.get(wk) || 0;
    if (n >= goal) {
      run++;
      best = Math.max(best, run);
      const inWeek = sorted.filter((d) => d >= wk && d <= addDays(wk, 6));
      out.push({ date: inWeek[goal - 1], value: best }); // 目標の日数に届いた日
    } else {
      run = 0;
    }
  }
  return out;
}

/** 開始時からの体重の変化（目標の向き。7 日平均で判定して、日々の揺れで出たり消えたりしないようにする） */
function weightChangeTimeline(data) {
  const ws = sortByDate(data.weights);
  if (!ws.length) return [];
  const dir = goalDirection(ws, data.settings.targetWeightKg) || 'loss';
  const start = ws[0].weightKg;
  const ma = movingAverage(ws.map((w) => ({ date: w.date, value: w.weightKg })), 7);
  return runningBest(ma.map((p) => ({ date: p.date, value: round(dir === 'loss' ? start - p.value : p.value - start, 2) })));
}

function metrics(data) {
  const strength = sortByDate(data.strength);
  const jogs = sortByDate(data.jogs);
  const stepGoal = data.settings.stepGoal || 8000;
  const goal = computeBests(data).weight.goalAchieved;
  return {
    exDays: count([...exerciseDays(data)].sort()),
    streak: streakTimeline(data),
    weightDays: count(sortByDate(data.weights).map((w) => w.date)),
    weightChange: weightChangeTimeline(data),
    goal: goal ? [{ date: goal.date, value: 1 }] : [],
    strengthDays: count([...new Set(strength.map((r) => r.date))].sort()),
    volume: cumulative(strength, (r) => (r.weightKg * r.reps * r.sets) / 1000),
    pbCount: count(pbEventsBetween(data, '0000-01-01', '9999-12-31', { weight: false }).map((e) => e.date)),
    jogKm: cumulative(jogs, (j) => j.distanceKm),
    longestJog: runningBest(jogs.map((j) => ({ date: j.date, value: j.distanceKm }))),
    fastPace: runningBest(jogs.filter((j) => j.distanceKm >= PACE_MIN_KM).map((j) => ({ date: j.date, value: paceSecPerKm(j.durationSec, j.distanceKm) })), true),
    intakeDays: count(sortByDate((data.daily || []).filter((d) => d.intakeKcal > 0)).map((d) => d.date)),
    stepDays: count(sortByDate((data.daily || []).filter((d) => d.steps != null && d.steps >= stepGoal)).map((d) => d.date)),
  };
}

/* ---------- バッジの一覧 ---------- */

const kg = (dir, n) => `${dir === 'gain' ? '+' : '−'}${n}kg`;

export const BADGE_GROUPS = ['継続', '体重', '筋トレ', 'ジョギング', '食事・歩数'];

export const BADGES = [
  { id: 'ex1', group: '継続', icon: '👟', name: 'はじめの一歩', desc: '初めて運動を記録', metric: 'exDays', target: 1, unit: '日' },
  { id: 'ex10', group: '継続', icon: '🌱', name: '運動 10 日', desc: '運動した日が合計 10 日', metric: 'exDays', target: 10, unit: '日' },
  { id: 'ex50', group: '継続', icon: '🌿', name: '運動 50 日', desc: '運動した日が合計 50 日', metric: 'exDays', target: 50, unit: '日' },
  { id: 'ex100', group: '継続', icon: '🌳', name: '運動 100 日', desc: '運動した日が合計 100 日', metric: 'exDays', target: 100, unit: '日' },
  { id: 'streak4', group: '継続', icon: '🔥', name: '4 週連続達成', desc: '週の目標を 4 週続けて達成', metric: 'streak', target: 4, unit: '週' },
  { id: 'streak12', group: '継続', icon: '☄️', name: '12 週連続達成', desc: '週の目標を 12 週続けて達成', metric: 'streak', target: 12, unit: '週' },
  { id: 'wlog30', group: '体重', icon: '📒', name: '体重 30 日記録', desc: '体重を合計 30 日記録', metric: 'weightDays', target: 30, unit: '日' },
  { id: 'wc1', group: '体重', icon: '📉', name: (d) => `開始時から ${kg(d, 1)}`, desc: '7 日平均で判定', metric: 'weightChange', target: 1, unit: 'kg' },
  { id: 'wc3', group: '体重', icon: '📉', name: (d) => `開始時から ${kg(d, 3)}`, desc: '7 日平均で判定', metric: 'weightChange', target: 3, unit: 'kg' },
  { id: 'wc5', group: '体重', icon: '🥈', name: (d) => `開始時から ${kg(d, 5)}`, desc: '7 日平均で判定', metric: 'weightChange', target: 5, unit: 'kg' },
  { id: 'wc10', group: '体重', icon: '🥇', name: (d) => `開始時から ${kg(d, 10)}`, desc: '7 日平均で判定', metric: 'weightChange', target: 10, unit: 'kg' },
  { id: 'goal', group: '体重', icon: '🏆', name: '目標体重 達成', desc: '目標体重に届いた', metric: 'goal', target: 1, unit: '' },
  { id: 'st10', group: '筋トレ', icon: '🏋️', name: '筋トレ 10 日', desc: '筋トレした日が合計 10 日', metric: 'strengthDays', target: 10, unit: '日' },
  { id: 'st50', group: '筋トレ', icon: '💪', name: '筋トレ 50 日', desc: '筋トレした日が合計 50 日', metric: 'strengthDays', target: 50, unit: '日' },
  { id: 'vol10', group: '筋トレ', icon: '🧱', name: '累計 10 トン', desc: '重量×回数×セットの合計', metric: 'volume', target: 10, unit: 't' },
  { id: 'vol100', group: '筋トレ', icon: '🏗️', name: '累計 100 トン', desc: '重量×回数×セットの合計', metric: 'volume', target: 100, unit: 't' },
  { id: 'pb10', group: '筋トレ', icon: '⭐', name: '自己ベスト 10 回', desc: '筋トレ・ジョギングの自己ベスト更新が合計 10 回', metric: 'pbCount', target: 10, unit: '回' },
  { id: 'pb50', group: '筋トレ', icon: '🌟', name: '自己ベスト 50 回', desc: '筋トレ・ジョギングの自己ベスト更新が合計 50 回', metric: 'pbCount', target: 50, unit: '回' },
  { id: 'km10', group: 'ジョギング', icon: '🏃', name: '累計 10km', desc: 'ジョギングの合計距離', metric: 'jogKm', target: 10, unit: 'km' },
  { id: 'km50', group: 'ジョギング', icon: '🏃', name: '累計 50km', desc: 'ジョギングの合計距離', metric: 'jogKm', target: 50, unit: 'km' },
  { id: 'km100', group: 'ジョギング', icon: '🗾', name: '累計 100km', desc: 'ジョギングの合計距離', metric: 'jogKm', target: 100, unit: 'km' },
  { id: 'km300', group: 'ジョギング', icon: '🌏', name: '累計 300km', desc: 'ジョギングの合計距離', metric: 'jogKm', target: 300, unit: 'km' },
  { id: 'run5', group: 'ジョギング', icon: '🎽', name: '5km 完走', desc: '1 回で 5km 以上', metric: 'longestJog', target: 5, unit: 'km' },
  { id: 'run10', group: 'ジョギング', icon: '🏅', name: '10km 完走', desc: '1 回で 10km 以上', metric: 'longestJog', target: 10, unit: 'km' },
  { id: 'pace6', group: 'ジョギング', icon: '⚡', name: 'キロ 6 分切り', desc: `${PACE_MIN_KM}km 以上をキロ 6:00 より速く`, metric: 'fastPace', target: 360, lower: true, unit: '' },
  { id: 'meal14', group: '食事・歩数', icon: '🍱', name: '食事 14 日記録', desc: '摂取カロリーを合計 14 日記録', metric: 'intakeDays', target: 14, unit: '日' },
  { id: 'step7', group: '食事・歩数', icon: '🚶', name: '歩数目標 7 日', desc: '歩数の目標を合計 7 日達成', metric: 'stepDays', target: 7, unit: '日' },
  { id: 'step30', group: '食事・歩数', icon: '🗺️', name: '歩数目標 30 日', desc: '歩数の目標を合計 30 日達成', metric: 'stepDays', target: 30, unit: '日' },
];

/**
 * すべてのバッジの状態。
 * @returns {{id, group, icon, name, desc, earned: string|null, value: number|null, progress: number, remain: string}[]}
 *   earned: 獲得した日（未獲得なら null）、progress: 0〜1、remain: 「あと 12km」などの残り
 */
export function evaluateBadges(data) {
  const m = metrics(data);
  const dir = goalDirection(data.weights, data.settings.targetWeightKg) || 'loss';
  return BADGES.map((b) => {
    const tl = m[b.metric] || [];
    const hit = tl.find((p) => (b.lower ? p.value <= b.target : p.value >= b.target));
    const value = tl.length ? tl[tl.length - 1].value : null;
    let progress = 0;
    if (hit) progress = 1;
    else if (value != null) progress = b.lower ? Math.min(1, b.target / value) : Math.max(0, Math.min(1, value / b.target));
    let remain = '';
    if (!hit) {
      if (b.lower) remain = value != null ? `今のベスト ${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}/km` : 'まだ記録がありません';
      else if (b.metric === 'goal') remain = '目標体重を設定して達成';
      else remain = `あと ${fmtNum(Math.max(0, b.target - (value || 0)), 1)}${b.unit}`;
    }
    return {
      id: b.id, group: b.group, icon: b.icon, desc: b.desc,
      name: typeof b.name === 'function' ? b.name(dir) : b.name,
      earned: hit ? hit.date : null, value, progress, remain,
    };
  });
}

export function earnedBadgeIds(data) {
  return evaluateBadges(data).filter((b) => b.earned).map((b) => b.id);
}

/* ---------- 体重の節目（目標までを 1kg ごとに区切る） ---------- */

/**
 * @returns {null | {dir, steps: number[], reached: number[], next: number|null, remain: number|null, current: number}}
 *   current: 最新の 7 日平均。節目は 7 日平均で判定する（1 日だけ軽かった日で達成にしない）
 */
export function milestoneState(data) {
  const target = data.settings.targetWeightKg;
  const ws = sortByDate(data.weights);
  const dir = goalDirection(ws, target);
  if (!dir) return null;
  const start = ws[0].weightKg;
  const ma = movingAverage(ws.map((w) => ({ date: w.date, value: w.weightKg })), 7);
  const current = ma[ma.length - 1].value;
  const steps = [];
  if (dir === 'loss') for (let v = Math.ceil(start) - 1; v > target; v--) steps.push(v);
  else for (let v = Math.floor(start) + 1; v < target; v++) steps.push(v);
  const reached = steps.filter((v) => (dir === 'loss' ? current <= v : current >= v));
  const next = steps.find((v) => !reached.includes(v)) ?? null;
  return { dir, steps, reached, next, remain: next == null ? null : round(Math.abs(current - next), 2), current };
}
