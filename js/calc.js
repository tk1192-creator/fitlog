// 計算処理（画面に依存しない純粋関数）
// 日付はすべて端末ローカルの "YYYY-MM-DD" 文字列で扱う。

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date → "YYYY-MM-DD"（ローカル日付） */
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" → Date（ローカルの 0 時） */
export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr() {
  return toDateStr(new Date());
}

/** 日付に n 日足す */
export function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** a から b までの日数（b − a） */
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** グラフの x 軸用の通し日数（1970-01-01 起点、ローカル日付ベース） */
export function dayIndex(str) {
  const [y, m, d] = str.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function dayIndexToStr(idx) {
  const d = new Date(idx * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** その日を含む週の月曜日 */
export function weekStart(str) {
  const d = parseDate(str);
  const dow = (d.getDay() + 6) % 7; // 月=0 … 日=6
  d.setDate(d.getDate() - dow);
  return toDateStr(d);
}

/** BMI（小数 1 桁）。入力不備は null */
export function bmi(weightKg, heightCm) {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const m = heightCm / 100;
  return round(weightKg / (m * m), 1);
}

/** BMI の判定（日本肥満学会の区分） */
export function bmiCategory(v) {
  if (v == null) return '';
  if (v < 18.5) return '低体重';
  if (v < 25) return '普通体重';
  if (v < 30) return '肥満(1度)';
  if (v < 35) return '肥満(2度)';
  if (v < 40) return '肥満(3度)';
  return '肥満(4度)';
}

/** ペース（秒/km）。入力不備は null */
export function paceSecPerKm(durationSec, distanceKm) {
  if (!(durationSec > 0) || !(distanceKm > 0)) return null;
  return durationSec / distanceKm;
}

/** 秒 → "m:ss" */
export function formatPace(sec) {
  if (sec == null || !isFinite(sec)) return '-';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 秒 → "m:ss" または "h:mm:ss" */
export function formatDuration(sec) {
  if (sec == null || !isFinite(sec)) return '-';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "mm:ss" / "h:mm:ss" / "mm" → 秒。解釈できなければ null */
export function parseDuration(text) {
  if (text == null) return null;
  const t = String(text).trim().replace(/：/g, ':');
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  let sec;
  if (parts.length === 1) sec = parts[0] * 60;
  else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  else sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  return sec > 0 ? sec : null;
}

/** 推定 1RM（Epley 式）。回数 1 は重量そのもの */
export function epley1RM(weightKg, reps) {
  if (!(weightKg > 0) || !(reps > 0)) return null;
  if (reps === 1) return weightKg;
  return round(weightKg * (1 + reps / 30), 1);
}

/** 小数を指定桁で四捨五入 */
export function round(v, digits = 1) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** 表示用の数値（末尾の 0 を省く）: 60 → "60", 62.5 → "62.5" */
export function fmtNum(v, digits = 1) {
  if (v == null || !isFinite(v)) return '-';
  return String(round(v, digits));
}

/** 日付順（昇順）に並べたコピー */
export function sortByDate(items) {
  return [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 7 日移動平均。points は {date, value}。
 * 各点について、その日を含む直近 days 暦日内の値の平均を返す。
 */
export function movingAverage(points, days = 7) {
  const sorted = sortByDate(points);
  return sorted.map((p, i) => {
    const from = addDays(p.date, -(days - 1));
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && sorted[j].date >= from; j--) {
      sum += sorted[j].value;
      n++;
    }
    return { date: p.date, value: round(sum / n, 2) };
  });
}

/** 期間で絞り込む。period: '1m' | '3m' | '1y' | 'all' */
export function periodStart(period, today) {
  const d = parseDate(today);
  if (period === '1m') d.setMonth(d.getMonth() - 1);
  else if (period === '3m') d.setMonth(d.getMonth() - 3);
  else if (period === '1y') d.setFullYear(d.getFullYear() - 1);
  else return null;
  return toDateStr(d);
}

export function filterByPeriod(items, period, today) {
  const from = periodStart(period, today);
  if (!from) return items;
  return items.filter((x) => x.date >= from && x.date <= today);
}

/** 体重: 最も古い記録（開始時）と最新の記録 */
export function startWeight(weights) {
  if (!weights.length) return null;
  return sortByDate(weights)[0];
}

export function latestWeight(weights) {
  if (!weights.length) return null;
  const s = sortByDate(weights);
  return s[s.length - 1];
}

/**
 * 目標達成日までの週あたり必要変化量（kg/週、減量なら正の値）。
 * 目標日がない・過ぎている・達成済みなら null。
 */
export function weeklyChangeNeeded(currentKg, targetKg, today, targetDate) {
  if (!(currentKg > 0) || !(targetKg > 0) || !targetDate) return null;
  const days = daysBetween(today, targetDate);
  if (days <= 0) return null;
  const diff = currentKg - targetKg;
  if (diff === 0) return null;
  return round(diff / (days / 7), 2);
}

/** 運動した日の集合（筋トレ・ジョギングのどちらか） */
export function exerciseDays(data) {
  const set = new Set();
  for (const r of data.strength) set.add(r.date);
  for (const r of data.jogs) set.add(r.date);
  return set;
}

/** 週（月曜日）→ 運動日数 */
export function weeklyCounts(daysSet) {
  const map = new Map();
  for (const d of daysSet) {
    const w = weekStart(d);
    map.set(w, (map.get(w) || 0) + 1);
  }
  return map;
}

/**
 * ストリーク（目標を達成した週の連続数）。
 * 今週は達成済みなら数に含める。未達でも途切れ扱いにせず、先週から数える。
 */
export function streakWeeks(daysSet, goalDays, today) {
  if (!(goalDays > 0)) return 0;
  const counts = weeklyCounts(daysSet);
  let w = weekStart(today);
  let streak = 0;
  if ((counts.get(w) || 0) >= goalDays) streak++;
  w = addDays(w, -7);
  while ((counts.get(w) || 0) >= goalDays) {
    streak++;
    w = addDays(w, -7);
  }
  return streak;
}

/** ジョギングの月別集計: [{month:"YYYY-MM", distanceKm, durationSec, paceSec}] */
export function monthlyJogStats(jogs) {
  const map = new Map();
  for (const j of jogs) {
    const m = j.date.slice(0, 7);
    const cur = map.get(m) || { month: m, distanceKm: 0, durationSec: 0 };
    cur.distanceKm += j.distanceKm;
    cur.durationSec += j.durationSec;
    map.set(m, cur);
  }
  return [...map.values()]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((x) => ({ ...x, distanceKm: round(x.distanceKm, 2), paceSec: paceSecPerKm(x.durationSec, x.distanceKm) }));
}

/** 筋トレの日別集計（種目指定）: [{date, maxWeight, max1RM}] */
export function dailyStrengthStats(strength, exercise) {
  const map = new Map();
  for (const r of strength) {
    if (r.exercise !== exercise) continue;
    const orm = epley1RM(r.weightKg, r.reps);
    const cur = map.get(r.date) || { date: r.date, maxWeight: 0, max1RM: 0 };
    cur.maxWeight = Math.max(cur.maxWeight, r.weightKg);
    cur.max1RM = Math.max(cur.max1RM, orm || 0);
    map.set(r.date, cur);
  }
  return sortByDate([...map.values()]);
}
