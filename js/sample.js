// 動作確認用のサンプルデータ（約 3 か月分）
// 体重は緩やかに減少、筋トレの重量とジョギングの距離・ペースは少しずつ伸びるので、
// 途中で自己ベスト更新が何度も起きるデータになる。
import { addDays } from './calc.js';
import { DEFAULT_EXERCISES, defaultData, newId } from './storage.js';

/** 再現性のある乱数（mulberry32） */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (v) => Math.round(v * 10) / 10;
const half = (v) => Math.round(v * 2) / 2; // 0.5kg 刻み
const p5 = (v) => Math.round(v / 2.5) * 2.5; // 2.5kg 刻み

export function generateSample(today, days = 90) {
  const rand = rng(20261104);
  const data = defaultData();
  data.settings.targetWeightKg = 66;
  const start = addDays(today, -(days - 1));

  // 種目ごとの開始重量と 3 か月での伸び
  const plan = {
    ベンチプレス: { from: 50, gain: 12.5, reps: [8, 10] },
    スクワット: { from: 60, gain: 20, reps: [8, 10] },
    デッドリフト: { from: 70, gain: 20, reps: [5, 6] },
    ラットプルダウン: { from: 40, gain: 10, reps: [10, 12] },
    ショルダープレス: { from: 25, gain: 7.5, reps: [8, 10] },
  };
  // 週の予定: 月=筋トレ(上半身) 水=ジョギング 金=筋トレ(下半身) 土=ジョギング（ときどき休み）
  const upper = ['ベンチプレス', 'ラットプルダウン', 'ショルダープレス'];
  const lower = ['スクワット', 'デッドリフト'];

  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const progress = i / (days - 1);
    const dow = new Date(date + 'T00:00:00').getDay();

    // 体重: 72.0kg → 約 68.5kg、日々の揺れ ±0.4kg、ときどき記録を忘れる
    if (rand() < 0.85) {
      const base = 72 - 3.5 * progress + Math.sin(i / 5) * 0.2;
      const weightKg = r1(base + (rand() - 0.5) * 0.8);
      const bodyFatPct = rand() < 0.7 ? r1(25 - 2.5 * progress + (rand() - 0.5) * 0.8) : null;
      data.weights.push({ id: newId(), date, weightKg, bodyFatPct, memo: '' });
    }

    const skip = rand() < 0.12;
    if (!skip && (dow === 1 || dow === 5)) {
      for (const ex of dow === 1 ? upper : lower) {
        const p = plan[ex];
        const weightKg = p5(p.from + p.gain * progress + (rand() < 0.2 ? -2.5 : 0));
        const reps = p.reps[Math.floor(rand() * p.reps.length)];
        data.strength.push({ id: newId(), date, exercise: ex, weightKg, reps, sets: 3, memo: '' });
      }
    }
    if (!skip && (dow === 3 || dow === 6)) {
      const distanceKm = half(3 + 3 * progress + (rand() - 0.3) * 1.5);
      const paceSec = 7 * 60 - 45 * progress + (rand() - 0.5) * 20; // 7:00/km → 約 6:15/km
      data.jogs.push({ id: newId(), date, distanceKm, durationSec: Math.round(paceSec * distanceKm), memo: dow === 6 ? '週末ラン' : '' });
    }
  }
  data.exercises = [...DEFAULT_EXERCISES];
  return data;
}
