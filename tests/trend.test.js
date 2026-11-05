import { test, eq } from './harness.js';
import { addDays } from '../js/calc.js';
import { estimatedExpenditure, forecastGoal, weightTrend } from '../js/trend.js';

const TODAY = '2026-11-28';
/** 今日から遡って days 日分、1 日あたり perDay kg ずつ変わる体重（step 日おき） */
function series(endKg, perDay, days = 28, step = 1) {
  const out = [];
  for (let i = 0; i < days; i += step) out.push({ id: `w${i}`, date: addDays(TODAY, -i), weightKg: endKg - perDay * i });
  return out;
}

test('傾向: 記録が 5 回未満なら出さない', () => eq(weightTrend(series(70, -0.05, 28, 7), TODAY), null));
test('傾向: 期間が 2 週間未満なら出さない', () => eq(weightTrend(series(70, -0.05, 10), TODAY), null));
test('傾向: 4 週より前の記録は使わない', () => {
  const old = [{ id: 'o', date: addDays(TODAY, -40), weightKg: 90 }];
  eq(weightTrend([...old, ...series(70, -0.05)], TODAY).perWeek, -0.35);
});
test('傾向: 直線なら傾きと今日の値がそのまま出る', () => {
  const t = weightTrend(series(70, -0.05), TODAY);
  eq([t.perWeek, t.current, t.n], [-0.35, 70, 28]);
});
test('傾向: 日々の揺れはならされる', () => {
  const w = series(70, -0.05).map((x, i) => ({ ...x, weightKg: x.weightKg + (i % 2 ? 0.4 : -0.4) }));
  const t = weightTrend(w, TODAY);
  eq(Math.abs(t.perWeek + 0.35) < 0.05, true, `傾き ${t.perWeek}`);
  eq(Math.abs(t.current - 70) < 0.3, true, `今日の値 ${t.current}`);
});
test('達成見込み: 70kg から週 −0.35kg で 66kg まで 80 日', () => {
  const f = forecastGoal(weightTrend(series(70, -0.05), TODAY), 66, TODAY);
  eq([f.status, f.days, f.date], ['ok', 80, addDays(TODAY, 80)]);
});
test('達成見込み: 増量の目標も同じように出る', () => {
  const f = forecastGoal(weightTrend(series(60, 0.05), TODAY), 61, TODAY);
  eq([f.status, f.days], ['ok', 20]);
});
test('達成見込み: 目標と逆向き・横ばい・遠すぎ・到達済み', () => {
  eq(forecastGoal(weightTrend(series(70, 0.05), TODAY), 66, TODAY).status, 'away');
  eq(forecastGoal(weightTrend(series(70, 0.001), TODAY), 66, TODAY).status, 'flat');
  eq(forecastGoal(weightTrend(series(100, -0.01), TODAY), 60, TODAY).status, 'far');
  eq(forecastGoal(weightTrend(series(66, -0.05), TODAY), 66, TODAY).status, 'reached');
  eq(forecastGoal(null, 66, TODAY), null);
});
test('実際の消費: 平均 2000kcal で週 −0.35kg なら 2000 + 0.05×7200 = 2360', () => {
  const daily = Array.from({ length: 20 }, (_, i) => ({ date: addDays(TODAY, -(i + 1)), intakeKcal: i % 2 ? 1900 : 2100, steps: null }));
  const e = estimatedExpenditure({ weights: series(70, -0.05), daily }, TODAY);
  eq([e.status, e.tdee, e.avgIntake, e.days], ['ok', 2360, 2000, 20]);
});
test('実際の消費: 今日の食事・歩数だけの日・期間外は数えず、14 日未満なら足りない日数を返す', () => {
  const daily = [
    { date: TODAY, intakeKcal: 500 },
    { date: addDays(TODAY, -2), intakeKcal: null, steps: 8000 },
    { date: addDays(TODAY, -40), intakeKcal: 2000 },
    ...Array.from({ length: 10 }, (_, i) => ({ date: addDays(TODAY, -(i + 3)), intakeKcal: 2000 })),
  ];
  eq(estimatedExpenditure({ weights: series(70, -0.05), daily }, TODAY), { status: 'short', have: 10, need: 14 });
});
test('実際の消費: 体重の記録が足りなければ null、あり得ない値は odd', () => {
  eq(estimatedExpenditure({ weights: [], daily: [] }, TODAY), null);
  const daily = Array.from({ length: 20 }, (_, i) => ({ date: addDays(TODAY, -(i + 1)), intakeKcal: 300 }));
  eq(estimatedExpenditure({ weights: series(70, -0.05), daily }, TODAY).status, 'odd');
});
