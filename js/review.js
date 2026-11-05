// 先週のふりかえり（v2.6.0）。ホームに月〜水曜だけ表示する。端末の中だけで使うので体重の値も含める
import { addDays, exerciseDays, round, weekStart } from './calc.js';
import { evaluateBadges } from './badges.js';
import { pbEventsBetween } from './share.js';

export const REVIEW_SHOW_DAYS = 3; // 月・火・水曜に表示

/**
 * 先週（月曜〜日曜）のまとめ（純粋関数）
 * @returns {{weekStart, weekEnd, goal, days, prevDays, achieved, strengthDays, jogKm, weightAvg, weightDiff, pbs, badges, hasData}}
 */
export function lastWeekReview(data, today) {
  const ws = addDays(weekStart(today), -7);
  const we = addDays(ws, 6);
  const pws = addDays(ws, -7);
  const pwe = addDays(ws, -1);
  const inRange = (r, a, b) => r.date >= a && r.date <= b;
  const ex = [...exerciseDays(data)];
  const days = ex.filter((d) => d >= ws && d <= we).length;
  const prevDays = ex.filter((d) => d >= pws && d <= pwe).length;
  const goal = data.settings.weeklyGoalDays || 3;
  const avgWeight = (a, b) => {
    const w = data.weights.filter((r) => inRange(r, a, b));
    return w.length ? w.reduce((s, r) => s + r.weightKg, 0) / w.length : null;
  };
  const weightAvg = avgWeight(ws, we);
  const prevAvg = avgWeight(pws, pwe);
  const hasData = days > 0
    || data.weights.some((r) => inRange(r, ws, we))
    || (data.daily || []).some((r) => inRange(r, ws, we));
  return {
    weekStart: ws,
    weekEnd: we,
    goal,
    days,
    prevDays,
    achieved: days >= goal,
    strengthDays: new Set(data.strength.filter((r) => inRange(r, ws, we)).map((r) => r.date)).size,
    jogKm: round(data.jogs.filter((r) => inRange(r, ws, we)).reduce((s, j) => s + j.distanceKm, 0), 1),
    weightAvg: weightAvg == null ? null : round(weightAvg, 1),
    weightDiff: weightAvg != null && prevAvg != null ? round(weightAvg - prevAvg, 1) : null,
    pbs: pbEventsBetween(data, ws, we, { weight: true }),
    badges: evaluateBadges(data).filter((b) => b.earned && b.earned >= ws && b.earned <= we),
    hasData,
  };
}

/** ホームに表示するか（月〜水曜で、先週の記録があり、閉じていない） */
export function shouldShowReview(data, today, review) {
  if (!review.hasData) return false;
  if (today >= addDays(weekStart(today), REVIEW_SHOW_DAYS)) return false;
  return data.settings.reviewDismissed !== review.weekStart;
}
