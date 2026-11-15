import { test, eq } from './harness.js';
import { computeBests, evaluateSave, goalDirection } from '../js/pb.js';
import { defaultData } from '../js/storage.js';

function data(patch = {}) {
  const d = defaultData();
  return Object.assign(d, patch);
}
const types = (msgs) => msgs.map((m) => m.type);

test('筋トレ: 種目の初回は「初記録」', () => {
  const rec = { id: 'n', date: '2026-11-04', exercise: 'ベンチプレス', weightKg: 60, reps: 10, sets: 3 };
  const d = data({ strength: [rec, { id: 'x', date: '2026-11-01', exercise: 'スクワット', weightKg: 100, reps: 5, sets: 3 }] });
  const m = evaluateSave('strength', rec, d);
  eq(types(m), ['first']);
  eq(m[0].text, 'ベンチプレス 初記録！ 60kg × 10回');
});
test('筋トレ: 最大重量と 1RM の更新（メッセージ例どおり）', () => {
  const old = { id: 'o', date: '2026-11-01', exercise: 'ベンチプレス', weightKg: 60, reps: 10, sets: 3 };
  const rec = { id: 'n', date: '2026-11-04', exercise: 'ベンチプレス', weightKg: 62.5, reps: 10, sets: 3 };
  const m = evaluateSave('strength', rec, data({ strength: [old, rec] }));
  eq(m.map((x) => x.text), ['ベンチプレス 自己ベスト更新！ 60kg → 62.5kg', 'ベンチプレス 推定1RM 自己ベスト更新！ 80kg → 83.3kg']);
});
test('筋トレ: 同じ重量は更新扱いにしない', () => {
  const old = { id: 'o', date: '2026-11-01', exercise: 'ベンチプレス', weightKg: 60, reps: 10, sets: 3 };
  const rec = { id: 'n', date: '2026-11-04', exercise: 'ベンチプレス', weightKg: 60, reps: 8, sets: 3 };
  eq(evaluateSave('strength', rec, data({ strength: [old, rec] })), []);
});
test('筋トレ: 重量は同じでも回数が増えれば 1RM だけ更新', () => {
  const old = { id: 'o', date: '2026-11-01', exercise: 'ベンチプレス', weightKg: 60, reps: 8, sets: 3 };
  const rec = { id: 'n', date: '2026-11-04', exercise: 'ベンチプレス', weightKg: 60, reps: 10, sets: 3 };
  const m = evaluateSave('strength', rec, data({ strength: [old, rec] }));
  eq(m.length, 1);
  eq(m[0].text.includes('推定1RM'), true);
});
test('ジョギング: 初回は「初記録」', () => {
  const rec = { id: 'n', date: '2026-11-04', distanceKm: 5, durationSec: 1800 };
  eq(types(evaluateSave('jog', rec, data({ jogs: [rec] }))), ['first']);
});
test('ジョギング: 最長距離と最速ペースの更新', () => {
  const old = { id: 'o', date: '2026-11-01', distanceKm: 5, durationSec: 1800 }; // 6:00
  const rec = { id: 'n', date: '2026-11-04', distanceKm: 6, durationSec: 2100 }; // 5:50
  const m = evaluateSave('jog', rec, data({ jogs: [old, rec] }));
  eq(m.map((x) => x.text), ['最長距離 自己ベスト更新！ 5km → 6km', '最速ペース 自己ベスト更新！ 6:00/km → 5:50/km']);
});
test('ジョギング: 3km 未満はペースの対象外', () => {
  const old = { id: 'o', date: '2026-11-01', distanceKm: 5, durationSec: 1800 };
  const rec = { id: 'n', date: '2026-11-04', distanceKm: 2, durationSec: 500 }; // 4:10 でも対象外
  eq(evaluateSave('jog', rec, data({ jogs: [old, rec] })), []);
});
test('ジョギング: 3km 以上の初回はペース「初記録」', () => {
  const old = { id: 'o', date: '2026-11-01', distanceKm: 2, durationSec: 720 };
  const rec = { id: 'n', date: '2026-11-04', distanceKm: 3, durationSec: 1080 };
  eq(types(evaluateSave('jog', rec, data({ jogs: [old, rec] }))), ['pb', 'first']);
});
test('体重: 初回は「初記録」', () => {
  const rec = { id: 'n', date: '2026-11-04', weightKg: 70 };
  eq(types(evaluateSave('weight', rec, data({ weights: [rec] }))), ['first']);
});
test('体重: 最低体重の更新', () => {
  const old = { id: 'o', date: '2026-11-01', weightKg: 70 };
  const rec = { id: 'n', date: '2026-11-04', weightKg: 69.6 };
  const m = evaluateSave('weight', rec, data({ weights: [old, rec] }));
  eq(m.map((x) => x.text), ['最低体重 更新！ 70kg → 69.6kg']);
});
test('体重: 目標達成は特別メッセージ（先頭）', () => {
  const d = data({ weights: [] });
  d.settings.targetWeightKg = 68;
  const old = { id: 'o', date: '2026-11-01', weightKg: 70 };
  const rec = { id: 'n', date: '2026-11-04', weightKg: 67.9 };
  d.weights = [old, rec];
  eq(types(evaluateSave('weight', rec, d)), ['goal', 'pb']);
});
test('体重: 2 回目の目標到達は特別演出なし', () => {
  const d = data();
  d.settings.targetWeightKg = 68;
  d.weights = [{ id: 'a', date: '2026-10-01', weightKg: 70 }, { id: 'b', date: '2026-10-20', weightKg: 67.5 }, { id: 'n', date: '2026-11-04', weightKg: 67.8 }];
  eq(evaluateSave('weight', d.weights[2], d), []);
});
test('体重: 増量目標の判定方向', () => {
  eq(goalDirection([{ date: '2026-10-01', weightKg: 55 }], 60), 'gain');
  const d = data();
  d.settings.targetWeightKg = 60;
  d.weights = [{ id: 'a', date: '2026-10-01', weightKg: 55 }, { id: 'n', date: '2026-11-04', weightKg: 60.2 }];
  eq(types(evaluateSave('weight', d.weights[1], d)), ['goal']);
});
test('自己ベスト一覧の計算', () => {
  const d = data();
  d.strength = [
    { id: '1', date: '2026-10-01', exercise: 'ベンチプレス', weightKg: 60, reps: 10, sets: 3 },
    { id: '2', date: '2026-10-08', exercise: 'ベンチプレス', weightKg: 65, reps: 3, sets: 3 },
  ];
  d.jogs = [{ id: 'j', date: '2026-10-02', distanceKm: 2, durationSec: 480 }, { id: 'k', date: '2026-10-05', distanceKm: 5, durationSec: 1800 }];
  d.weights = [{ id: 'w', date: '2026-10-01', weightKg: 70 }, { id: 'v', date: '2026-10-09', weightKg: 69 }];
  const b = computeBests(d);
  eq(b.strength['ベンチプレス'].maxWeight, { value: 65, date: '2026-10-08', reps: 3 });
  eq(b.strength['ベンチプレス'].max1RM.value, 80); // 60×10 の 1RM(80) が 65×3 の 71.5 より大きい
  eq(b.jog.longest.value, 5);
  eq(b.jog.fastest.date, '2026-10-05'); // 2km の記録は対象外
  eq(b.weight.lowest.value, 69);
});

/* ---------- 自重（重量なし）の筋トレ（v2.11.1） ---------- */
test('自重: 重量が空欄でも保存でき、重量ありの記録とは別に回数で比べる', async () => {
  const { normalize, defaultData } = await import('../js/storage.js');
  const { evaluateSave, computeBests } = await import('../js/pb.js');
  const S = (id, date, kg, reps) => ({ id, date, exercise: '腕立て伏せ', weightKg: kg, reps, sets: 3, memo: '' });
  const d = normalize({ ...defaultData(), strength: [S('a', '2026-11-01', null, 20), S('b', '2026-11-02', '', 25), S('c', '2026-11-03', 10, 8)] });
  eq(d.strength.map((r) => r.weightKg), [null, null, 10]);
  eq(evaluateSave('strength', d.strength[1], d).map((m) => m.text), ['腕立て伏せ（自重）最多回数 更新！ 20回 → 25回']);
  eq(evaluateSave('strength', d.strength[2], d).map((m) => m.type), ['first'], '重量ありの初記録は自重とは別');
  const b = computeBests(d).strength['腕立て伏せ'];
  eq([b.maxWeight.value, b.maxReps.value], [10, 25]);
});

/* ---------- 「ジム」（重量・回数・セットなし。v2.11.2） ---------- */
test('ジム: 回数・セットなしで保存でき、運動した日に数え、自己ベストの対象外', async () => {
  const { normalize, defaultData } = await import('../js/storage.js');
  const { exerciseDays } = await import('../js/calc.js');
  const d = normalize({ ...defaultData(), strength: [
    { id: 'g', date: '2026-11-14', exercise: 'ジム', weightKg: 50, reps: null, sets: null, memo: '' },
    { id: 'x', date: '2026-11-15', exercise: 'ベンチプレス', weightKg: 40, reps: null, sets: 3, memo: '' },
  ] });
  eq(d.strength.map((r) => [r.exercise, r.weightKg, r.reps, r.sets]), [['ジム', null, null, null]], '回数だけ空欄の記録は捨てる');
  eq([...exerciseDays(d)], ['2026-11-14']);
  eq(evaluateSave('strength', d.strength[0], d), []);
  eq(computeBests(d).strength['ジム'], undefined);
});
