import { test, eq } from './harness.js';
import * as c from '../js/calc.js';
import { buildCSV, defaultData, normalize } from '../js/storage.js';

test('BMI: 65kg / 165cm = 23.9', () => eq(c.bmi(65, 165), 23.9));
test('BMI: 入力不備は null', () => eq(c.bmi(0, 165), null));
test('BMI 区分', () => { eq(c.bmiCategory(18.4), '低体重'); eq(c.bmiCategory(24.9), '普通体重'); eq(c.bmiCategory(25), '肥満(1度)'); });
test('ペース: 30分 / 5km = 6:00', () => eq(c.formatPace(c.paceSecPerKm(1800, 5)), '6:00'));
test('ペース: 25:30 / 4.2km = 6:04', () => eq(c.formatPace(c.paceSecPerKm(1530, 4.2)), '6:04'));
test('時間の書式', () => { eq(c.formatDuration(1830), '30:30'); eq(c.formatDuration(3725), '1:02:05'); });
test('時間の解釈', () => { eq(c.parseDuration('30:30'), 1830); eq(c.parseDuration('1:02:05'), 3725); eq(c.parseDuration('25'), 1500); eq(c.parseDuration('3:75'), null); eq(c.parseDuration('abc'), null); });
test('Epley 1RM: 60kg×10回 = 80kg', () => eq(c.epley1RM(60, 10), 80));
test('Epley 1RM: 1回は重量そのもの', () => eq(c.epley1RM(100, 1), 100));
test('数値表示: 末尾の 0 を省く', () => { eq(c.fmtNum(60), '60'); eq(c.fmtNum(62.5), '62.5'); eq(c.fmtNum(70.04), '70'); });
test('日付の加算（月またぎ）', () => eq(c.addDays('2026-10-30', 3), '2026-11-02'));
test('日数の差', () => eq(c.daysBetween('2026-11-04', '2026-12-04'), 30));
test('週の開始は月曜', () => { eq(c.weekStart('2026-11-04'), '2026-11-02'); eq(c.weekStart('2026-11-08'), '2026-11-02'); eq(c.weekStart('2026-11-09'), '2026-11-09'); });
test('通し日数の往復', () => eq(c.dayIndexToStr(c.dayIndex('2026-11-04')), '2026-11-04'));
test('7日移動平均: 7 暦日以内だけ平均する', () => {
  const pts = [
    { date: '2026-11-01', value: 70 }, { date: '2026-11-03', value: 72 },
    { date: '2026-11-07', value: 74 }, { date: '2026-11-08', value: 76 },
  ];
  const ma = c.movingAverage(pts, 7);
  eq(ma.map((p) => p.value), [70, 71, 72, 74]); // 11/8 は 11/2〜11/8 の 72,74,76
});
test('期間の絞り込み: 1か月', () => {
  const items = [{ date: '2026-09-30' }, { date: '2026-10-04' }, { date: '2026-11-04' }];
  eq(c.filterByPeriod(items, '1m', '2026-11-04').map((x) => x.date), ['2026-10-04', '2026-11-04']);
  eq(c.filterByPeriod(items, 'all', '2026-11-04').length, 3);
});
test('週あたり必要減量: 70→66kg を 28 日で 1kg/週', () => eq(c.weeklyChangeNeeded(70, 66, '2026-11-04', '2026-12-02'), 1));
test('週あたり必要減量: 期日を過ぎたら null', () => eq(c.weeklyChangeNeeded(70, 66, '2026-11-04', '2026-11-04'), null));
test('ストリーク: 今週未達でも先週まで数える', () => {
  // 目標 2 日。10/19週=2日, 10/26週=2日, 11/2週=1日（今週・未達）
  const days = new Set(['2026-10-19', '2026-10-21', '2026-10-27', '2026-10-30', '2026-11-03']);
  eq(c.streakWeeks(days, 2, '2026-11-04'), 2);
});
test('ストリーク: 今週達成なら含める', () => {
  const days = new Set(['2026-10-27', '2026-10-30', '2026-11-02', '2026-11-03']);
  eq(c.streakWeeks(days, 2, '2026-11-04'), 2);
});
test('ストリーク: 途中で途切れる', () => {
  const days = new Set(['2026-10-12', '2026-10-13', '2026-10-27', '2026-10-28']);
  eq(c.streakWeeks(days, 2, '2026-11-04'), 1);
});
test('ジョギング月別集計', () => {
  const m = c.monthlyJogStats([
    { date: '2026-10-05', distanceKm: 5, durationSec: 1800 },
    { date: '2026-10-20', distanceKm: 3, durationSec: 1200 },
    { date: '2026-11-01', distanceKm: 4, durationSec: 1440 },
  ]);
  eq(m.map((x) => [x.month, x.distanceKm, Math.round(x.paceSec)]), [['2026-10', 8, 375], ['2026-11', 4, 360]]);
});
test('筋トレ日別集計: 同じ日は最大値', () => {
  const s = c.dailyStrengthStats([
    { date: '2026-11-01', exercise: 'ベンチプレス', weightKg: 60, reps: 10 },
    { date: '2026-11-01', exercise: 'ベンチプレス', weightKg: 65, reps: 5 },
    { date: '2026-11-01', exercise: 'スクワット', weightKg: 100, reps: 5 },
  ], 'ベンチプレス');
  eq(s, [{ date: '2026-11-01', maxWeight: 65, max1RM: 80 }]);
});
test('インポート検証: 不正な記録を捨て、1 日 1 件に揃える', () => {
  const d = normalize({
    weights: [{ date: '2026-11-01', weightKg: 70 }, { date: '2026-11-01', weightKg: 71 }, { date: 'x', weightKg: 70 }],
    strength: [{ date: '2026-11-01', exercise: 'レッグプレス', weightKg: 100, reps: 10, sets: 3 }, { date: '2026-11-01', exercise: '', weightKg: 1, reps: 1, sets: 1 }],
    jogs: [{ date: '2026-11-01', distanceKm: 5, durationSec: 1800 }, { date: '2026-11-01', distanceKm: 0, durationSec: 1 }],
  });
  eq([d.weights.length, d.strength.length, d.jogs.length], [1, 1, 1]);
  eq(d.exercises.includes('レッグプレス'), true);
  eq(d.settings.heightCm, 165);
});
test('インポート検証: fitlog 以外のデータは例外', () => {
  let threw = false;
  try { normalize({ foo: 1 }); } catch (_) { threw = true; }
  eq(threw, true);
});
test('CSV: BOM 付き・カンマを含むメモをエスケープ', () => {
  const d = defaultData();
  d.weights.push({ id: '1', date: '2026-11-01', weightKg: 70, bodyFatPct: null, memo: 'a,"b"' });
  const csv = buildCSV(d);
  eq(csv.charCodeAt(0), 0xfeff);
  eq(csv.split('\r\n')[1], '体重,2026-11-01,70,,,,,,,,,"a,""b"""');
});
