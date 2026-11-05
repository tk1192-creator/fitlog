// 体重の傾向と予測（v2.5.0）
// ・今のペース：直近 4 週の体重に直線を当てはめ（最小二乗法）、1 週間あたりの変化を求める
// ・達成見込み：そのペースが続いた場合に目標体重に届く日
// ・実際の消費：食事の記録（平均摂取）と体重の変化から、1 日に実際に使っているカロリーを逆算する
//   実際の消費 ≒ 平均摂取 − 体重の変化（kg/日）× 7,200kcal
import { KCAL_PER_KG_FAT, addDays, dayIndex, daysBetween, round, sortByDate } from './calc.js';

export const TREND_WINDOW_DAYS = 28; // 直近 4 週で見る
export const TREND_MIN_POINTS = 5; // 体重の記録が 5 回以上
export const TREND_MIN_SPAN = 13; // 最初と最後の記録が 13 日以上離れている（2 週間分）
export const INTAKE_MIN_DAYS = 14; // 食事の記録が 14 日以上
const FORECAST_MAX_DAYS = 730; // 2 年より先は「見込みが立たない」扱い
const FLAT_PER_WEEK = 0.05; // 週 0.05kg 未満の変化は「横ばい」

/**
 * 直近 windowDays 日の体重の傾向。記録が足りなければ null。
 * @returns {null | {slopePerDay, perWeek, current, from, to, n}}
 *   current: 今日の時点の傾向線の値（日々の揺れをならした「今の体重」）
 */
export function weightTrend(weights, today, windowDays = TREND_WINDOW_DAYS) {
  const from = addDays(today, -(windowDays - 1));
  const pts = sortByDate(weights).filter((w) => w.date >= from && w.date <= today && w.weightKg > 0);
  if (pts.length < TREND_MIN_POINTS) return null;
  if (daysBetween(pts[0].date, pts[pts.length - 1].date) < TREND_MIN_SPAN) return null;
  const x0 = dayIndex(today);
  const xs = pts.map((p) => dayIndex(p.date) - x0); // 今日を 0 にする（今日の値 = 切片）
  const ys = pts.map((p) => p.weightKg);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return {
    slopePerDay: slope,
    perWeek: round(slope * 7, 2),
    current: round(my - slope * mx, 2),
    from: pts[0].date,
    to: pts[pts.length - 1].date,
    n,
  };
}

/**
 * 今のペースが続いた場合に目標体重に届く日。
 * @returns {null | {status: 'ok', date, days} | {status: 'reached' | 'flat' | 'away' | 'far'}}
 *   reached: 傾向線の上ではもう届いている / flat: ほぼ横ばい / away: 目標と逆向き / far: 2 年より先
 */
export function forecastGoal(trend, targetKg, today) {
  if (!trend || !(targetKg > 0)) return null;
  const diff = targetKg - trend.current; // 減量なら負
  if (Math.abs(diff) < 0.05) return { status: 'reached' };
  if (Math.abs(trend.perWeek) < FLAT_PER_WEEK) return { status: 'flat' };
  if (Math.sign(diff) !== Math.sign(trend.slopePerDay)) return { status: 'away' };
  const days = Math.ceil(diff / trend.slopePerDay - 1e-9); // 計算誤差で 1 日ずれないように
  if (days > FORECAST_MAX_DAYS) return { status: 'far' };
  return { status: 'ok', date: addDays(today, days), days };
}

/**
 * 記録から見た実際の消費カロリー（kcal/日）。
 * 食事は今日を除く直近 4 週（今日はまだ食べ終わっていないため）で、記録した日だけ平均する。
 * @returns {null | {status: 'short', have, need} | {status: 'ok', tdee, avgIntake, days, perWeek} | {status: 'odd'}}
 *   null: 体重の記録が足りない / short: 食事の記録が足りない / odd: 結果が人の範囲を外れる（記録漏れなど）
 */
export function estimatedExpenditure(data, today, windowDays = TREND_WINDOW_DAYS) {
  const trend = weightTrend(data.weights, today, windowDays);
  if (!trend) return null;
  const from = addDays(today, -windowDays);
  const to = addDays(today, -1);
  const days = (data.daily || []).filter((d) => d.date >= from && d.date <= to && d.intakeKcal > 0);
  if (days.length < INTAKE_MIN_DAYS) return { status: 'short', have: days.length, need: INTAKE_MIN_DAYS };
  const avgIntake = days.reduce((a, d) => a + d.intakeKcal, 0) / days.length;
  const tdee = Math.round(avgIntake - trend.slopePerDay * KCAL_PER_KG_FAT);
  if (tdee < 1000 || tdee > 5000) return { status: 'odd' };
  return { status: 'ok', tdee, avgIntake: Math.round(avgIntake), days: days.length, perWeek: trend.perWeek };
}
