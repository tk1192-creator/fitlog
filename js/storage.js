// データの保存・読み込み（localStorage）と、JSON / CSV の入出力
import { formatDuration, formatPace, paceSecPerKm, todayStr } from './calc.js';

const KEY = 'fitlog.v1';
export const SCHEMA_VERSION = 1;

export const DEFAULT_EXERCISES = ['ベンチプレス', 'スクワット', 'デッドリフト', 'ラットプルダウン', 'ショルダープレス'];

export function defaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      heightCm: 165,
      age: 52,
      targetWeightKg: null,
      targetDate: null,
      weeklyGoalDays: 3,
      lastExportAt: null,
    },
    exercises: [...DEFAULT_EXERCISES],
    weights: [],
    strength: [],
    jogs: [],
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
    throw new Error('fitlog のデータではありません（weights / strength / jogs がありません）');
  }
  const base = defaultData();
  const s = { ...base.settings, ...(obj.settings || {}) };
  const settings = {
    heightCm: num(s.heightCm) > 0 ? num(s.heightCm) : base.settings.heightCm,
    age: num(s.age) > 0 ? num(s.age) : base.settings.age,
    targetWeightKg: num(s.targetWeightKg) > 0 ? num(s.targetWeightKg) : null,
    targetDate: DATE_RE.test(str(s.targetDate)) ? s.targetDate : null,
    weeklyGoalDays: Math.min(7, Math.max(1, Math.round(num(s.weeklyGoalDays) || 3))),
    lastExportAt: s.lastExportAt || null,
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

  return { schemaVersion: SCHEMA_VERSION, settings, exercises, weights, strength, jogs };
}

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
  download(`fitlog-backup-${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

/** CSV の 1 セルをエスケープ */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 全記録を 1 つの CSV にまとめる（Excel で開けるよう BOM 付き UTF-8） */
export function buildCSV(data) {
  const header = ['種別', '日付', '体重(kg)', '体脂肪率(%)', '種目', '重量(kg)', '回数', 'セット数', '距離(km)', '時間', 'ペース(分/km)', 'メモ'];
  const rows = [];
  for (const w of data.weights) rows.push(['体重', w.date, w.weightKg, w.bodyFatPct ?? '', '', '', '', '', '', '', '', w.memo]);
  for (const r of data.strength) rows.push(['筋トレ', r.date, '', '', r.exercise, r.weightKg, r.reps, r.sets, '', '', '', r.memo]);
  for (const j of data.jogs) {
    rows.push(['ジョギング', j.date, '', '', '', '', '', '', j.distanceKm, formatDuration(j.durationSec), formatPace(paceSecPerKm(j.durationSec, j.distanceKm)), j.memo]);
  }
  rows.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function exportCSV(data) {
  download(`fitlog-${todayStr()}.csv`, buildCSV(data), 'text/csv');
}

