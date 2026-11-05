import { test, eq } from './harness.js';
import { pbEventsBetween, pbReportText, shareSettings, shareablePb, weeklySummary } from '../js/share.js';
import { defaultData, normalize } from '../js/storage.js';

const W = (id, date, kg) => ({ id, date, weightKg: kg, bodyFatPct: null, memo: '' });
const S = (id, date, ex, kg, reps) => ({ id, date, exercise: ex, weightKg: kg, reps, sets: 3, memo: '' });
const J = (id, date, km, sec) => ({ id, date, distanceKm: km, durationSec: sec, memo: '' });
function data(patch, share) {
  const d = normalize({ ...defaultData(), ...patch });
  d.settings.weeklyGoalDays = 3;
  d.settings.share = { enabled: true, name: 'パパ', weekly: true, pb: true, weight: false, ...(share || {}) };
  return d;
}

test('報告: 設定の既定値（オフ・体重は送らない）', () => {
  const s = shareSettings(normalize({ ...defaultData() }));
  eq([s.enabled, s.weekly, s.pb, s.weight], [false, true, true, false]);
});
test('報告: 既存の設定（v2.3 以前のデータ）を読み込んでも報告はオフ', () => {
  const d = normalize({ settings: { heightCm: 165 }, weights: [], strength: [], jogs: [] });
  eq(d.settings.share.enabled, false);
});
test('報告: 初記録・目標達成は送らない。体重の自己ベストは体重を共有するときだけ', () => {
  eq(shareablePb('strength', { type: 'first', text: 'x' }, { weight: false }), false);
  eq(shareablePb('weight', { type: 'goal', text: 'x' }, { weight: true }), false);
  eq(shareablePb('weight', { type: 'pb', text: 'x' }, { weight: false }), false);
  eq(shareablePb('weight', { type: 'pb', text: 'x' }, { weight: true }), true);
  eq(shareablePb('jog', { type: 'pb', text: 'x' }, { weight: false }), true);
});
test('報告: 期間内の自己ベストを日付順に再現して数える（期間外・初記録は数えない）', () => {
  const d = data({
    strength: [
      S('a', '2026-10-26', 'ベンチプレス', 60, 10), // 初記録（数えない）
      S('b', '2026-11-03', 'ベンチプレス', 62.5, 10), // 期間内：最大重量・1RM の更新
      S('c', '2026-11-04', 'ベンチプレス', 60, 8), // 更新なし
    ],
    jogs: [J('j1', '2026-10-28', 5, 1800), J('j2', '2026-11-05', 6, 2100)], // 期間内：最長距離・最速ペース
  });
  const ev = pbEventsBetween(d, '2026-11-02', '2026-11-08');
  eq(ev.length, 4);
  eq(ev.map((e) => e.date), ['2026-11-03', '2026-11-03', '2026-11-05', '2026-11-05']);
});
test('ふりかえり: 運動日数と目標の達成、自己ベストの件数（体重は含めない設定）', () => {
  const d = data({
    weights: [W('w1', '2026-11-02', 76.0), W('w2', '2026-11-05', 75.4)],
    strength: [S('a', '2026-10-26', 'ベンチプレス', 60, 10), S('b', '2026-11-03', 'ベンチプレス', 62.5, 10)],
    jogs: [J('j1', '2026-11-02', 5, 1800), J('j2', '2026-11-05', 3, 1100)],
  });
  const w = weeklySummary(d, '2026-11-05');
  eq(w.weekStart, '2026-11-02');
  eq(w.text.split('\n'), [
    '【STRIDE 今週のふりかえり】11/2〜11/8',
    'パパ',
    '・運動 3 日（目標 3 日 達成🎉）',
    '・自己ベスト 2 件（最新：ベンチプレス 推定1RM 自己ベスト 80kg → 83.3kg）',
  ]);
  eq(w.text.includes('76') || w.text.includes('75.4'), false, '体重の値は含まれない');
});
test('ふりかえり: 体重を共有する設定なら増減だけを入れる（体重そのものは入れない）', () => {
  const d = data({ weights: [W('w1', '2026-11-02', 76.0), W('w2', '2026-11-05', 75.4)] }, { weight: true, pb: false });
  const w = weeklySummary(d, '2026-11-05');
  eq(w.text.includes('・体重 −0.6kg（週のはじめと比べて）'), true);
  eq(w.text.includes('76') || w.text.includes('75.4'), false, '体重の値は含まれない');
});
test('ふりかえり: 体重の記録が 1 件以下の週は増減を書かない', () => {
  const d = data({ weights: [W('w1', '2026-11-05', 75.4)] }, { weight: true });
  eq(weeklySummary(d, '2026-11-05').text.includes('体重'), false);
});
test('報告: 自己ベストの報告文', () => {
  eq(pbReportText(data({}), 'ベンチプレス 自己ベスト更新！ 60kg → 62.5kg'), '🎉 パパ：ベンチプレス 自己ベスト更新！ 60kg → 62.5kg');
});
