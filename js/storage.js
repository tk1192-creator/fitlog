// データの保存・読み込み（localStorage）と、JSON / CSV の入出力
import { formatDuration, formatPace, paceSecPerKm, todayStr } from './calc.js';

const KEY = 'fitlog.v1';
export const SCHEMA_VERSION = 2; // 2: 食事・歩数（daily）と性別・活動レベル・歩数目標を追加

export const DEFAULT_EXERCISES = ['ベンチプレス', 'スクワット', 'デッドリフト', 'ラットプルダウン', 'ショルダープレス'];

export function defaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      heightCm: null, // 初回に設定画面で入力してもらう（v2.2.0 で初期値 165cm・52 歳を廃止）
      age: null,
      targetWeightKg: null,
      targetDate: null,
      weeklyGoalDays: 3,
      sex: null, // 'male' | 'female'（基礎代謝の計算に使う）
      activityLevel: 'normal', // 'low' | 'normal' | 'high'
      stepGoal: 8000,
      lastExportAt: null,
      // LINE で家族に報告（v2.4.0）。既定はオフ。体重は増減だけを送る
      share: { enabled: false, name: '', weekly: true, pb: true, weight: false },
      // お祝い済みの節目（kg）とバッジ（v2.6.0）。null は「まだ調べていない」（最初の保存時に、それまでの分はお祝いせずに記録する）
      celebrated: null,
      reviewDismissed: null, // 先週のふりかえりを閉じた週（その週の月曜日）
      // 休みのお知らせ（v2.7.0）：days 日続けて休んだら知らせる。scope は 'strength'（筋トレだけ）か 'all'（運動すべて）
      restAlert: { enabled: true, days: 3, scope: 'strength' },
      // よく使うリンク（v2.9.3）。ホームに表示する。{title, url}（https のみ、6 件まで）
      links: [],
    },
    exercises: [...DEFAULT_EXERCISES],
    weights: [],
    strength: [],
    jogs: [],
    daily: [], // 食事・歩数（1 日 1 件）
    plans: [], // 運動の予定（v2.7.0）{id, date, time('HH:MM' か ''), kind('strength'|'jog'|'other'), title, memo}
    habits: [], // 習慣の項目（v2.7.0）{id, name}
    habitLogs: [], // 習慣のチェック（v2.7.0）{id, date, habitId}。1 日 1 項目 1 件
  };
}

/** 読み込み。壊れていた場合は初期データを返し、元データは退避する */
export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    console.warn('localStorage を読めません', e);
    return defaultData();
  }
  if (!raw) return defaultData();
  try {
    return normalize(JSON.parse(raw));
  } catch (e) {
    console.error('保存データを読めませんでした。退避して初期化します', e);
    try {
      localStorage.setItem(`${KEY}.broken.${Date.now()}`, raw);
    } catch (_) { /* 退避できなくても続行 */ }
    return defaultData();
  }
}

/** 保存。失敗したら false */
export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('保存に失敗しました', e);
    return false;
  }
}

export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => (v === '' || v == null ? null : Number(v));
const str = (v) => (v == null ? '' : String(v));

/**
 * 読み込んだ JSON を検証・整形する。不正な形式なら例外を投げる。
 * 個々の不正な記録は捨てる。
 */
export function normalize(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('データの形式が正しくありません');
  if (!Array.isArray(obj.weights) || !Array.isArray(obj.strength) || !Array.isArray(obj.jogs)) {
    throw new Error('STRIDE（旧 fitlog）のデータではありません（weights / strength / jogs がありません）');
  }
  const base = defaultData();
  const s = { ...base.settings, ...(obj.settings || {}) };
  const settings = {
    heightCm: num(s.heightCm) > 0 ? num(s.heightCm) : base.settings.heightCm,
    age: num(s.age) > 0 ? num(s.age) : base.settings.age,
    targetWeightKg: num(s.targetWeightKg) > 0 ? num(s.targetWeightKg) : null,
    targetDate: DATE_RE.test(str(s.targetDate)) ? s.targetDate : null,
    weeklyGoalDays: Math.min(7, Math.max(1, Math.round(num(s.weeklyGoalDays) || 3))),
    sex: s.sex === 'male' || s.sex === 'female' ? s.sex : null,
    activityLevel: ['low', 'normal', 'high'].includes(s.activityLevel) ? s.activityLevel : 'normal',
    stepGoal: num(s.stepGoal) > 0 ? Math.round(num(s.stepGoal)) : base.settings.stepGoal,
    lastExportAt: s.lastExportAt || null,
    share: {
      enabled: Boolean(s.share && s.share.enabled),
      name: str(s.share && s.share.name).trim().slice(0, 20),
      weekly: s.share && s.share.weekly === false ? false : true,
      pb: s.share && s.share.pb === false ? false : true,
      weight: Boolean(s.share && s.share.weight),
    },
    celebrated: s.celebrated && typeof s.celebrated === 'object'
      ? {
        milestones: (Array.isArray(s.celebrated.milestones) ? s.celebrated.milestones : []).map(Number).filter((v) => v > 0),
        badges: (Array.isArray(s.celebrated.badges) ? s.celebrated.badges : []).map(str).filter(Boolean),
      }
      : null,
    reviewDismissed: DATE_RE.test(str(s.reviewDismissed)) ? s.reviewDismissed : null,
    restAlert: {
      enabled: !(s.restAlert && s.restAlert.enabled === false),
      days: Math.min(14, Math.max(1, Math.round(num(s.restAlert && s.restAlert.days) || 3))),
      scope: s.restAlert && s.restAlert.scope === 'all' ? 'all' : 'strength',
    },
    links: normalizeLinks(s.links),
  };

  const exercises = Array.isArray(obj.exercises)
    ? [...new Set(obj.exercises.map(str).map((x) => x.trim()).filter(Boolean))]
    : base.exercises;

  const weights = [];
  const seenDates = new Set();
  for (const w of obj.weights) {
    if (!w || !DATE_RE.test(str(w.date)) || !(num(w.weightKg) > 0)) continue;
    if (seenDates.has(w.date)) continue; // 1 日 1 件
    seenDates.add(w.date);
    const bf = num(w.bodyFatPct);
    weights.push({ id: str(w.id) || newId(), date: w.date, weightKg: num(w.weightKg), bodyFatPct: bf > 0 ? bf : null, memo: str(w.memo) });
  }

  const strength = [];
  for (const r of obj.strength) {
    if (!r || !DATE_RE.test(str(r.date)) || !str(r.exercise).trim()) continue;
    if (!(num(r.weightKg) > 0) || !(num(r.reps) > 0) || !(num(r.sets) > 0)) continue;
    strength.push({
      id: str(r.id) || newId(), date: r.date, exercise: str(r.exercise).trim(),
      weightKg: num(r.weightKg), reps: Math.round(num(r.reps)), sets: Math.round(num(r.sets)), memo: str(r.memo),
    });
    if (!exercises.includes(r.exercise.trim())) exercises.push(r.exercise.trim());
  }

  const jogs = [];
  for (const j of obj.jogs) {
    if (!j || !DATE_RE.test(str(j.date)) || !(num(j.distanceKm) > 0) || !(num(j.durationSec) > 0)) continue;
    jogs.push({ id: str(j.id) || newId(), date: j.date, distanceKm: num(j.distanceKm), durationSec: Math.round(num(j.durationSec)), memo: str(j.memo) });
  }

  // 食事・歩数（schemaVersion 1 のデータには無いので空として扱う）
  const daily = [];
  const seenDaily = new Set();
  for (const r of Array.isArray(obj.daily) ? obj.daily : []) {
    if (!r || !DATE_RE.test(str(r.date)) || seenDaily.has(r.date)) continue;
    const kcal = num(r.intakeKcal);
    const steps = num(r.steps);
    const k = kcal > 0 ? Math.round(kcal) : null;
    const st = steps >= 0 && steps != null ? Math.round(steps) : null;
    if (k == null && st == null) continue;
    seenDaily.add(r.date);
    daily.push({ id: str(r.id) || newId(), date: r.date, intakeKcal: k, steps: st, memo: str(r.memo) });
  }

  // 運動の予定・習慣（v2.7.0。v2.6.0 以前のデータには無いので空として扱う）
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const plans = [];
  for (const r of Array.isArray(obj.plans) ? obj.plans : []) {
    if (!r || !DATE_RE.test(str(r.date))) continue;
    plans.push({
      id: str(r.id) || newId(), date: r.date, time: TIME_RE.test(str(r.time)) ? r.time : '',
      kind: ['strength', 'jog', 'other'].includes(r.kind) ? r.kind : 'other',
      title: str(r.title).trim().slice(0, 30), memo: str(r.memo).slice(0, 200),
    });
  }
  const habits = [];
  for (const r of Array.isArray(obj.habits) ? obj.habits : []) {
    const name = str(r && r.name).trim().slice(0, 20);
    if (name) habits.push({ id: str(r.id) || newId(), name });
  }
  const habitIds = new Set(habits.map((x) => x.id));
  const habitLogs = [];
  const seenLogs = new Set();
  for (const r of Array.isArray(obj.habitLogs) ? obj.habitLogs : []) {
    if (!r || !DATE_RE.test(str(r.date)) || !habitIds.has(str(r.habitId))) continue; // 消した項目のチェックは捨てる
    const k = `${r.date}|${r.habitId}`;
    if (seenLogs.has(k)) continue;
    seenLogs.add(k);
    habitLogs.push({ id: str(r.id) || newId(), date: r.date, habitId: str(r.habitId) });
  }

  // この版が知らない項目（新しい版で増えたもの）は、中身に手を付けずに残す（v2.6.0）。
  // 古い版の端末で読み書き・同期しても、新しい版の記録や設定が消えないようにするため。
  const extra = {};
  for (const [k, v] of Object.entries(obj)) if (!KNOWN_KEYS.includes(k)) extra[k] = v;
  const extraSettings = {};
  for (const [k, v] of Object.entries(obj.settings || {})) if (!(k in base.settings)) extraSettings[k] = v;

  return { ...extra, schemaVersion: SCHEMA_VERSION, settings: { ...extraSettings, ...settings }, exercises, weights, strength, jogs, daily, plans, habits, habitLogs };
}

/** よく使うリンクの検証（https の URL だけ。名前は 20 文字、6 件まで） */
export const LINK_MAX = 6;
export function normalizeLinks(list) {
  const out = [];
  for (const l of Array.isArray(list) ? list : []) {
    const url = str(l && l.url).trim();
    let ok = false;
    try { ok = new URL(url).protocol === 'https:'; } catch (_) { ok = false; }
    if (!ok) continue;
    out.push({ title: str(l.title).trim().slice(0, 20) || new URL(url).hostname, url });
    if (out.length >= LINK_MAX) break;
  }
  return out;
}

const KNOWN_KEYS = ['schemaVersion', 'settings', 'exercises', 'weights', 'strength', 'jogs', 'daily', 'plans', 'habits', 'habitLogs'];

/** ファイルとしてダウンロードさせる */
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJSON(data) {
  download(`stride-backup-${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

/** CSV の 1 セルをエスケープ */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 全記録を 1 つの CSV にまとめる（Excel で開けるよう BOM 付き UTF-8） */
export function buildCSV(data) {
  const header = ['種別', '日付', '体重(kg)', '体脂肪率(%)', '種目', '重量(kg)', '回数', 'セット数', '距離(km)', '時間', 'ペース(分/km)', '摂取(kcal)', '歩数', 'メモ'];
  const rows = [];
  for (const w of data.weights) rows.push(['体重', w.date, w.weightKg, w.bodyFatPct ?? '', '', '', '', '', '', '', '', '', '', w.memo]);
  for (const r of data.strength) rows.push(['筋トレ', r.date, '', '', r.exercise, r.weightKg, r.reps, r.sets, '', '', '', '', '', r.memo]);
  for (const j of data.jogs) {
    rows.push(['ジョギング', j.date, '', '', '', '', '', '', j.distanceKm, formatDuration(j.durationSec), formatPace(paceSecPerKm(j.durationSec, j.distanceKm)), '', '', j.memo]);
  }
  for (const d of data.daily || []) rows.push(['食事・歩数', d.date, '', '', '', '', '', '', '', '', '', d.intakeKcal ?? '', d.steps ?? '', d.memo]);
  rows.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function exportCSV(data) {
  download(`stride-${todayStr()}.csv`, buildCSV(data), 'text/csv');
}

