// 自己ベストの判定（画面に依存しない純粋関数）
import { epley1RM, fmtNum, formatPace, paceSecPerKm, sortByDate } from './calc.js';

export const PACE_MIN_KM = 3; // 最速ペースの対象は 3km 以上

/** 目標の方向: 開始時体重 > 目標 なら減量、< なら増量 */
export function goalDirection(weights, targetKg) {
  if (!(targetKg > 0) || !weights.length) return null;
  const start = sortByDate(weights)[0].weightKg;
  if (start > targetKg) return 'loss';
  if (start < targetKg) return 'gain';
  return null;
}

export function meetsGoal(weightKg, targetKg, direction) {
  if (direction === 'loss') return weightKg <= targetKg;
  if (direction === 'gain') return weightKg >= targetKg;
  return false;
}

/** 記録全体から自己ベストを計算する（一覧表示用） */
export function computeBests(data) {
  const strength = {};
  for (const r of sortByDate(data.strength)) {
    const b = strength[r.exercise] || (strength[r.exercise] = { maxWeight: null, max1RM: null, count: 0 });
    b.count++;
    if (!b.maxWeight || r.weightKg > b.maxWeight.value) b.maxWeight = { value: r.weightKg, date: r.date, reps: r.reps };
    const orm = epley1RM(r.weightKg, r.reps);
    if (!b.max1RM || orm > b.max1RM.value) b.max1RM = { value: orm, date: r.date, weightKg: r.weightKg, reps: r.reps };
  }

  let longest = null;
  let fastest = null;
  for (const j of sortByDate(data.jogs)) {
    if (!longest || j.distanceKm > longest.value) longest = { value: j.distanceKm, date: j.date };
    if (j.distanceKm >= PACE_MIN_KM) {
      const p = paceSecPerKm(j.durationSec, j.distanceKm);
      if (!fastest || p < fastest.value) fastest = { value: p, date: j.date, distanceKm: j.distanceKm };
    }
  }

  let lowest = null;
  for (const w of sortByDate(data.weights)) {
    if (!lowest || w.weightKg < lowest.value) lowest = { value: w.weightKg, date: w.date };
  }
  const target = data.settings.targetWeightKg;
  const direction = goalDirection(data.weights, target);
  const achieved = sortByDate(data.weights).find((w) => meetsGoal(w.weightKg, target, direction));

  return {
    strength,
    jog: { longest, fastest, count: data.jogs.length },
    weight: { lowest, goalAchieved: achieved ? { date: achieved.date, value: achieved.weightKg } : null, direction, target },
  };
}

/**
 * 保存した記録 rec を、それ以外の記録と比べて自己ベストかを判定する。
 * data には rec がすでに含まれている前提。
 * @returns {{type: 'pb'|'first'|'goal', text: string}[]}
 */
export function evaluateSave(kind, rec, data) {
  if (kind === 'strength') return evalStrength(rec, data.strength.filter((x) => x.id !== rec.id && x.exercise === rec.exercise));
  if (kind === 'jog') return evalJog(rec, data.jogs.filter((x) => x.id !== rec.id));
  if (kind === 'weight') return evalWeight(rec, data);
  return [];
}

function evalStrength(rec, others) {
  const ex = rec.exercise;
  const orm = epley1RM(rec.weightKg, rec.reps);
  if (!others.length) {
    return [{ type: 'first', text: `${ex} 初記録！ ${fmtNum(rec.weightKg)}kg × ${rec.reps}回` }];
  }
  const out = [];
  const prevMax = Math.max(...others.map((x) => x.weightKg));
  if (rec.weightKg > prevMax) {
    out.push({ type: 'pb', text: `${ex} 自己ベスト更新！ ${fmtNum(prevMax)}kg → ${fmtNum(rec.weightKg)}kg` });
  }
  const prev1RM = Math.max(...others.map((x) => epley1RM(x.weightKg, x.reps)));
  if (orm > prev1RM) {
    out.push({ type: 'pb', text: `${ex} 推定1RM 自己ベスト更新！ ${fmtNum(prev1RM)}kg → ${fmtNum(orm)}kg` });
  }
  return out;
}

function evalJog(rec, others) {
  if (!others.length) {
    return [{ type: 'first', text: `ジョギング 初記録！ ${fmtNum(rec.distanceKm, 2)}km` }];
  }
  const out = [];
  const prevLongest = Math.max(...others.map((x) => x.distanceKm));
  if (rec.distanceKm > prevLongest) {
    out.push({ type: 'pb', text: `最長距離 自己ベスト更新！ ${fmtNum(prevLongest, 2)}km → ${fmtNum(rec.distanceKm, 2)}km` });
  }
  if (rec.distanceKm >= PACE_MIN_KM) {
    const pace = paceSecPerKm(rec.durationSec, rec.distanceKm);
    const eligible = others.filter((x) => x.distanceKm >= PACE_MIN_KM);
    if (!eligible.length) {
      out.push({ type: 'first', text: `${PACE_MIN_KM}km 以上のペース 初記録！ ${formatPace(pace)}/km` });
    } else {
      const prevBest = Math.min(...eligible.map((x) => paceSecPerKm(x.durationSec, x.distanceKm)));
      // 表示上同じ秒数なら更新扱いにしない
      if (Math.round(pace) < Math.round(prevBest)) {
        out.push({ type: 'pb', text: `最速ペース 自己ベスト更新！ ${formatPace(prevBest)}/km → ${formatPace(pace)}/km` });
      }
    }
  }
  return out;
}

function evalWeight(rec, data) {
  const others = data.weights.filter((x) => x.id !== rec.id);
  if (!others.length) {
    return [{ type: 'first', text: `体重 初記録！ ${fmtNum(rec.weightKg)}kg` }];
  }
  const out = [];
  const target = data.settings.targetWeightKg;
  const direction = goalDirection(data.weights, target);

  if (direction !== 'gain') {
    const prevLow = Math.min(...others.map((x) => x.weightKg));
    if (rec.weightKg < prevLow) {
      out.push({ type: 'pb', text: `最低体重 更新！ ${fmtNum(prevLow)}kg → ${fmtNum(rec.weightKg)}kg` });
    }
  }
  if (meetsGoal(rec.weightKg, target, direction) && !others.some((x) => meetsGoal(x.weightKg, target, direction))) {
    out.unshift({ type: 'goal', text: `目標体重 ${fmtNum(target)}kg 達成！ おめでとうございます！` });
  }
  return out;
}
