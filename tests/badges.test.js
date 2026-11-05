import { test, eq } from './harness.js';
import { addDays } from '../js/calc.js';
import { evaluateBadges, milestoneState } from '../js/badges.js';
import { lastWeekReview, shouldShowReview } from '../js/review.js';
import { newAchievements } from '../js/hooks.js';
import { tasksByDue } from '../js/views/home-tasks.js';
import { defaultData, normalize } from '../js/storage.js';

const W = (id, date, kg) => ({ id, date, weightKg: kg, bodyFatPct: null, memo: '' });
const S = (id, date, kg = 50, reps = 10, sets = 3) => ({ id, date, exercise: 'ベンチプレス', weightKg: kg, reps, sets, memo: '' });
const J = (id, date, km, sec) => ({ id, date, distanceKm: km, durationSec: sec, memo: '' });
function data(patch, settings) {
  const d = normalize({ ...defaultData(), ...patch });
  Object.assign(d.settings, { weeklyGoalDays: 2, ...(settings || {}) });
  return d;
}
const badge = (d, id) => evaluateBadges(d).find((b) => b.id === id);

test('バッジ: 何もない状態ではすべて未獲得', () => eq(evaluateBadges(data({})).filter((b) => b.earned).length, 0));
test('バッジ: はじめの一歩は最初に運動した日に獲得', () => {
  const d = data({ jogs: [J('b', '2026-11-03', 2, 900)], strength: [S('a', '2026-11-01')] });
  eq(badge(d, 'ex1').earned, '2026-11-01');
});
test('バッジ: 累計距離は足し上げて、届いた日が獲得日。未獲得は残りを出す', () => {
  const d = data({ jogs: [J('a', '2026-11-01', 4, 1500), J('b', '2026-11-03', 4, 1500), J('c', '2026-11-05', 4, 1500)] });
  eq(badge(d, 'km10').earned, '2026-11-05');
  eq([badge(d, 'km50').earned, badge(d, 'km50').remain, Math.round(badge(d, 'km50').progress * 100)], [null, 'あと 38km', 24]);
});
test('バッジ: キロ 6 分切りは 3km 以上だけが対象（速いほど良い）', () => {
  eq(badge(data({ jogs: [J('a', '2026-11-01', 2, 600)] }), 'pace6').earned, null); // 2km は対象外
  eq(badge(data({ jogs: [J('a', '2026-11-01', 5, 1790)] }), 'pace6').earned, '2026-11-01');
  eq(badge(data({ jogs: [J('a', '2026-11-01', 5, 1900)] }), 'pace6').remain, '今のベスト 6:20/km');
});
test('バッジ: 週の目標の連続達成（途中で途切れたら数え直す）', () => {
  // 週の目標 2 日。11/2 の週・11/9 の週は達成、11/16 の週は 1 日、11/23 の週から 2 週達成
  const days = ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-10', '2026-11-17', '2026-11-23', '2026-11-24', '2026-11-30', '2026-12-01'];
  const d = data({ strength: days.map((x, i) => S(`s${i}`, x)) });
  const st = evaluateBadges(d).find((b) => b.id === 'streak4');
  eq([st.earned, st.value], [null, 2]);
  const more = data({ strength: [...days, '2026-12-07', '2026-12-08', '2026-12-14', '2026-12-15'].map((x, i) => S(`s${i}`, x)) });
  eq(badge(more, 'streak4').earned, '2026-12-15'); // 11/23・11/30・12/7・12/14 の週で 4 週連続
});
test('バッジ: 体重の変化は 7 日平均で判定（1 日だけ軽くても獲得しない）', () => {
  const d = data({ weights: [W('a', '2026-11-01', 70), W('b', '2026-11-02', 70), W('c', '2026-11-03', 68.9)] });
  eq(badge(d, 'wc1').earned, null);
  const d2 = data({ weights: [W('a', '2026-11-01', 70), W('b', '2026-11-10', 68.9)] });
  eq(badge(d2, 'wc1').earned, '2026-11-10');
  eq(badge(d2, 'wc1').name, '開始時から −1kg');
});
test('バッジ: 増量が目標なら名前も +kg', () => {
  eq(badge(data({ weights: [W('a', '2026-11-01', 55)] }, { targetWeightKg: 60 }), 'wc1').name, '開始時から +1kg');
});
test('節目: 1kg ごと（開始時と目標は含めない）、7 日平均で判定', () => {
  const d = data({ weights: [W('a', '2026-11-01', 71.6), W('b', '2026-11-20', 69.8)] }, { targetWeightKg: 66 });
  const m = milestoneState(d);
  eq([m.steps, m.reached, m.next, m.remain], [[71, 70, 69, 68, 67], [71, 70], 69, 0.8]);
});
test('節目: 目標がない・同じなら出さない', () => {
  eq(milestoneState(data({ weights: [W('a', '2026-11-01', 70)] })), null);
});
test('お祝い: 初めての保存では、それまでに届いていた節目・バッジはお祝いしない', () => {
  const before = [W('a', '2026-11-01', 71.6), W('b', '2026-11-20', 69.8)];
  const d = data({ weights: [...before, W('c', '2026-11-21', 69.8)], strength: [S('s', '2026-11-01')] }, { targetWeightKg: 66 });
  const r = newAchievements(d, 'weight', 'c');
  eq(r.messages, []);
  eq([r.celebrated.milestones, r.changed], [[71, 70], true]);
  eq(r.celebrated.badges.includes('ex1'), true);
});
test('お祝い: 新しく届いた節目とバッジだけを伝える', () => {
  const d = data({ weights: [W('a', '2026-11-01', 71.6), W('b', '2026-11-20', 68.9)], strength: [S('s', '2026-11-01')] },
    { targetWeightKg: 66, celebrated: { milestones: [71, 70], badges: ['ex1'] } });
  const r = newAchievements(d, 'weight', 'b');
  eq(r.messages.map((m) => m.type), ['milestone', 'badge']);
  eq(r.messages[0].text.includes('69kg'), true);
  eq(r.messages[1].text, '📉 バッジ獲得：開始時から −1kg');
  eq(r.celebrated.milestones, [71, 70, 69]);
});
test('お祝い: 済みのものしかなければ何も伝えず、設定も書き換えない', () => {
  const d = data({ strength: [S('s', '2026-11-01'), S('t', '2026-11-02')] }, { celebrated: { milestones: [], badges: ['ex1'] } });
  const r = newAchievements(d, 'strength', 't');
  eq([r.messages.length, r.changed], [0, false]);
});
test('ふりかえり: 先週の運動日数・前の週との比較・体重の週平均の差', () => {
  const d = data({
    strength: [S('a', '2026-10-27'), S('b', '2026-11-02'), S('c', '2026-11-04')],
    jogs: [J('j', '2026-11-06', 5, 1800)],
    weights: [W('w1', '2026-10-28', 70.4), W('w2', '2026-11-03', 70.0), W('w3', '2026-11-07', 69.6)],
  });
  const r = lastWeekReview(d, '2026-11-10');
  eq([r.weekStart, r.weekEnd, r.days, r.prevDays, r.achieved, r.strengthDays, r.jogKm, r.weightAvg, r.weightDiff],
    ['2026-11-02', '2026-11-08', 3, 1, true, 2, 5, 69.8, -0.6]);
});
test('ふりかえり: 月〜水曜だけ、記録がある週だけ、閉じた週は出さない', () => {
  const d = data({ strength: [S('a', '2026-11-04')] });
  eq(shouldShowReview(d, '2026-11-11', lastWeekReview(d, '2026-11-11')), true); // 水曜
  eq(shouldShowReview(d, '2026-11-12', lastWeekReview(d, '2026-11-12')), false); // 木曜
  eq(shouldShowReview(data({}), '2026-11-10', lastWeekReview(data({}), '2026-11-10')), false);
  const closed = data({ strength: [S('a', '2026-11-04')] }, { reviewDismissed: '2026-11-02' });
  eq(shouldShowReview(closed, '2026-11-10', lastWeekReview(closed, '2026-11-10')), false);
});
test('カレンダー: タスクを期限の日付ごとに分け、未完了・優先度の高い順に並べる', () => {
  const m = tasksByDue([
    { id: '1', title: 'A', due: '2026-11-10', status: 'done', priority: 'high' },
    { id: '2', title: 'B', due: '2026-11-10', status: 'todo', priority: 'low' },
    { id: '3', title: 'C', due: '2026-11-10', status: 'doing', priority: 'high' },
    { id: '4', title: 'D', due: '2026-11-11', status: 'todo', priority: 'medium' },
    { id: '5', title: 'E', due: '', status: 'todo' },
    null,
  ]);
  eq([...m.keys()], ['2026-11-10', '2026-11-11']);
  eq(m.get('2026-11-10').map((t) => t.title), ['C', 'B', 'A']);
});
test('設定: お祝い済み・ふりかえりを閉じた週を検証して残す', () => {
  const d = normalize({ ...defaultData(), settings: { celebrated: { milestones: ['70', -1], badges: ['ex1', ''] }, reviewDismissed: '2026-11-02' } });
  eq([d.settings.celebrated, d.settings.reviewDismissed], [{ milestones: [70], badges: ['ex1'] }, '2026-11-02']);
  eq(normalize({ ...defaultData(), settings: { reviewDismissed: 'x' } }).settings.reviewDismissed, null);
  eq(addDays('2026-11-02', 0), '2026-11-02');
});
