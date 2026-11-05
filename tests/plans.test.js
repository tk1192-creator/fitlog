import { test, eq } from './harness.js';
import { habitStreak, notifyStatusOf, planDone, plansOn, restAlertDue, restDays, restMessage } from '../js/plans.js';
import { defaultData, normalize } from '../js/storage.js';

const S = (id, date) => ({ id, date, exercise: 'ベンチプレス', weightKg: 50, reps: 10, sets: 3, memo: '' });
const J = (id, date) => ({ id, date, distanceKm: 5, durationSec: 1800, memo: '秘密のメモ' });
const W = (id, date) => ({ id, date, weightKg: 70.5, bodyFatPct: null, memo: '' });
const P = (id, date, kind, time = '', title = '') => ({ id, date, kind, time, title, memo: 'メモ' });
function data(patch, settings) {
  const d = normalize({ ...defaultData(), ...patch });
  Object.assign(d.settings, settings || {});
  return d;
}

test('予定: 種類ごとに「できた」を判定（その他は筋トレかジョギング）', () => {
  const d = data({ strength: [S('s', '2026-11-10')], jogs: [J('j', '2026-11-11')] });
  eq(planDone(P('a', '2026-11-10', 'strength'), d), true);
  eq(planDone(P('b', '2026-11-10', 'jog'), d), false);
  eq(planDone(P('c', '2026-11-11', 'other'), d), true);
  eq(planDone(P('d', '2026-11-12', 'other'), d), false);
});
test('予定: その日の予定は時刻順（時刻なしは後ろ）', () => {
  const d = data({ plans: [P('a', '2026-11-10', 'jog'), P('b', '2026-11-10', 'strength', '19:00'), P('c', '2026-11-10', 'other', '07:30'), P('x', '2026-11-11', 'jog')] });
  eq(plansOn(d, '2026-11-10').map((p) => p.id), ['c', 'b', 'a']);
});
test('予定・習慣: 読み込みで検証する（不正な時刻・種類・消した習慣のチェック・重複）', () => {
  const d = normalize({
    ...defaultData(),
    plans: [{ id: 'a', date: '2026-11-10', time: '25:00', kind: 'yoga', title: 'x'.repeat(50) }, { id: 'b', date: 'bad' }],
    habits: [{ id: 'h1', name: ' ストレッチ ' }, { id: 'h2', name: '' }],
    habitLogs: [{ id: 'l1', date: '2026-11-10', habitId: 'h1' }, { id: 'l2', date: '2026-11-10', habitId: 'h1' }, { id: 'l3', date: '2026-11-10', habitId: 'gone' }],
  });
  eq([d.plans.length, d.plans[0].time, d.plans[0].kind, d.plans[0].title.length], [1, '', 'other', 30]);
  eq(d.habits, [{ id: 'h1', name: 'ストレッチ' }]);
  eq(d.habitLogs.map((l) => l.id), ['l1']);
});
test('予定・習慣: v2.6.0 以前のデータでは空、休みのお知らせは既定でオン（3 日・筋トレ）', () => {
  const d = normalize({ settings: {}, weights: [], strength: [], jogs: [] });
  eq([d.plans, d.habits, d.habitLogs], [[], [], []]);
  eq(d.settings.restAlert, { enabled: true, days: 3, scope: 'strength' });
});
test('休み: 最後の筋トレから何日たったか（今日やれば 0）', () => {
  const d = data({ strength: [S('a', '2026-11-05'), S('b', '2026-11-07')], jogs: [J('j', '2026-11-09')] });
  eq(restDays(d, '2026-11-10'), { days: 3, last: '2026-11-07', scope: 'strength' });
  eq(restDays(d, '2026-11-07').days, 0);
  eq(restDays(data({}), '2026-11-10'), null);
});
test('休み: 3 日でお知らせ。運動すべてならジョギングも数える。オフなら出さない', () => {
  const d = data({ strength: [S('a', '2026-11-07')], jogs: [J('j', '2026-11-09')] });
  eq(restAlertDue(d, '2026-11-09'), null); // 2 日
  eq(restAlertDue(d, '2026-11-10').days, 3);
  eq(restMessage(restAlertDue(d, '2026-11-10')), 'ジム（筋トレ）に 3 日行っていません。明日は行きましょう！');
  eq(restAlertDue(data({ strength: [S('a', '2026-11-07')], jogs: [J('j', '2026-11-09')] }, { restAlert: { enabled: true, days: 3, scope: 'all' } }), '2026-11-10'), null);
  eq(restAlertDue(data({ strength: [S('a', '2026-11-01')] }, { restAlert: { enabled: false, days: 3, scope: 'strength' } }), '2026-11-10'), null);
});
test('習慣: 連続日数（今日まだなら昨日まで）', () => {
  const logs = ['2026-11-07', '2026-11-08', '2026-11-09'].map((date, i) => ({ id: `l${i}`, date, habitId: 'h' }));
  const d = data({ habits: [{ id: 'h', name: '水' }], habitLogs: logs });
  eq(habitStreak(d, 'h', '2026-11-10'), 3);
  eq(habitStreak(d, 'h', '2026-11-09'), 3);
  eq(habitStreak(d, 'h', '2026-11-11'), 0);
});
test('通知用の情報: 最後の記録日・今日から 30 日の予定・設定だけ（値やメモは入れない）', () => {
  const d = data({
    weights: [W('w', '2026-11-09')], strength: [S('s', '2026-11-08')], jogs: [J('j', '2026-11-09')],
    plans: [P('old', '2026-11-09', 'jog'), P('a', '2026-11-12', 'strength', '19:00', 'ジム'), P('b', '2026-11-10', 'jog'), P('far', '2026-12-31', 'jog')],
  });
  const st = notifyStatusOf(d, '2026-11-10');
  eq([st.lastWeightDate, st.lastStrengthDate, st.lastJogDate, st.lastExerciseDate], ['2026-11-09', '2026-11-08', '2026-11-09', '2026-11-09']);
  eq(st.plans, [{ date: '2026-11-10', time: '', kind: 'jog', title: 'ジョギング' }, { date: '2026-11-12', time: '19:00', kind: 'strength', title: 'ジム' }]);
  const text = JSON.stringify(st);
  eq(['70.5', 'メモ', '秘密'].some((k) => text.includes(k)), false);
});
