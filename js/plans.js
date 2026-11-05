// 運動の予定・休みのお知らせ・習慣チェック（v2.7.0）
// 予定と習慣は記録と同じく ID 付きの一覧（plans / habits / habitLogs）にして、暗号化した記録の一部として同期する。
import { addDays, daysBetween, todayStr } from './calc.js';

export const PLAN_KINDS = [['strength', '筋トレ'], ['jog', 'ジョギング'], ['other', 'その他の運動']];
export const PLAN_KIND_LABEL = Object.fromEntries(PLAN_KINDS);
export const REST_SCOPES = [['strength', '筋トレだけ'], ['all', '運動すべて']];
export const DEFAULT_REST_ALERT = { enabled: true, days: 3, scope: 'strength' };
const NOTIFY_PLAN_DAYS = 30; // 通知用に置く予定は今日から 30 日先まで

const lastDate = (list) => (list || []).reduce((m, r) => (!m || r.date > m ? r.date : m), null);
const maxDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/** 予定の表示名（名前がなければ種類） */
export function planTitle(p) {
  return p.title || PLAN_KIND_LABEL[p.kind] || '運動';
}

/** 予定どおりにできたか（その日に、予定の種類の記録があるか。「その他」は筋トレかジョギングのどちらか） */
export function planDone(p, data) {
  const has = (list) => (list || []).some((r) => r.date === p.date);
  if (p.kind === 'strength') return has(data.strength);
  if (p.kind === 'jog') return has(data.jogs);
  return has(data.strength) || has(data.jogs);
}

/** その日の予定（時刻順。時刻なしは後ろ） */
export function plansOn(data, date) {
  return (data.plans || []).filter((p) => p.date === date)
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

/** 休みのお知らせの設定（未設定なら既定値） */
export function restAlertSettings(data) {
  return { ...DEFAULT_REST_ALERT, ...(data.settings.restAlert || {}) };
}

/**
 * 何日続けて休んでいるか。最後の記録の翌日から今日までの日数（今日記録していれば 0）。記録が一度もなければ null。
 * @returns {null | {days, last, scope}}
 */
export function restDays(data, today = todayStr()) {
  const s = restAlertSettings(data);
  const last = s.scope === 'all' ? maxDate(lastDate(data.strength), lastDate(data.jogs)) : lastDate(data.strength);
  if (!last) return null;
  return { days: Math.max(0, daysBetween(last, today)), last, scope: s.scope };
}

/** 休みのお知らせを出すか（設定がオンで、N 日以上続けて休んでいる） */
export function restAlertDue(data, today = todayStr()) {
  const s = restAlertSettings(data);
  const r = restDays(data, today);
  return s.enabled && r != null && r.days >= s.days ? r : null;
}

/** 休みのお知らせの文（アプリ・通知で共通） */
export function restMessage(r) {
  return r.scope === 'all'
    ? `運動を ${r.days} 日続けて休んでいます。明日は体を動かしましょう！`
    : `ジム（筋トレ）に ${r.days} 日行っていません。明日は行きましょう！`;
}

/**
 * 通知のために保存先へ置く情報（暗号化しない）。記録の値（体重・重量など）は含めない。
 * 予定は日付・時刻・種類・名前だけ（メモは含めない）。
 */
export function notifyStatusOf(data, today = todayStr()) {
  const lastStrengthDate = lastDate(data.strength);
  const lastJogDate = lastDate(data.jogs);
  const until = addDays(today, NOTIFY_PLAN_DAYS);
  return {
    lastWeightDate: lastDate(data.weights),
    lastStrengthDate,
    lastJogDate,
    lastExerciseDate: maxDate(lastStrengthDate, lastJogDate),
    plans: (data.plans || []).filter((p) => p.date >= today && p.date <= until)
      .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')))
      .map((p) => ({ date: p.date, time: p.time || '', kind: p.kind, title: planTitle(p) })),
    restAlert: restAlertSettings(data),
  };
}

/* ---------- 習慣チェック ---------- */

/** その日にチェックした習慣の ID */
export function habitsDoneOn(data, date) {
  return new Set((data.habitLogs || []).filter((l) => l.date === date).map((l) => l.habitId));
}

/** 習慣の連続日数（今日できていれば今日まで、まだなら昨日までで数える） */
export function habitStreak(data, habitId, today = todayStr()) {
  const days = new Set((data.habitLogs || []).filter((l) => l.habitId === habitId).map((l) => l.date));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
