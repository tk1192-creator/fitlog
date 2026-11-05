// LINE で家族に報告する文章を作る（v2.4.0）
// - 送るのは GitHub Actions（tools/notify/）。アプリは文章を作って保存先に置くだけ
// - 体重そのものは送らない（設定でオンにしたときだけ「増減」を送る）
import { addDays, exerciseDays, fmtNum, sortByDate, todayStr, weekStart } from './calc.js';
import { evaluateSave } from './pb.js';

const OUTBOX_KEY = 'stride.outbox'; // 送れていない自己ベストの報告（端末に一時保存）

/** 報告の設定（未設定なら既定値） */
export function shareSettings(data) {
  return { enabled: false, name: '', weekly: true, pb: true, weight: false, ...(data.settings.share || {}) };
}

/** 報告に使う名前（未入力なら「家族のだれか」にしない。名前の入力を必須にする） */
function nameOf(s) {
  return s.name || 'STRIDE';
}

/** 自己ベストのメッセージを家族向けに使ってよいか（体重の自己ベストは、体重を共有する設定のときだけ） */
export function shareablePb(kind, msg, s) {
  if (msg.type !== 'pb') return false; // 初記録・目標達成は送らない
  if (kind === 'weight' && !s.weight) return false;
  return true;
}

/**
 * 期間内に出た自己ベストを、日付順に再現して数える（純粋関数）
 * @returns {{date: string, kind: string, text: string}[]}
 */
export function pbEventsBetween(data, from, to, s = { weight: false }) {
  const events = [];
  const kinds = [['weight', 'weights'], ['strength', 'strength'], ['jog', 'jogs']];
  for (const [kind, key] of kinds) {
    const sorted = sortByDate(data[key] || []);
    for (let i = 0; i < sorted.length; i++) {
      const rec = sorted[i];
      if (rec.date < from || rec.date > to) continue;
      // その記録より前（同じ日なら並び順で前）の記録だけと比べる
      const prior = { ...data, [key]: sorted.slice(0, i + 1) };
      for (const msg of evaluateSave(kind, rec, prior)) {
        if (shareablePb(kind, msg, s)) events.push({ date: rec.date, kind, text: msg.text });
      }
    }
  }
  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const md = (str) => { const [, m, d] = str.split('-').map(Number); return `${m}/${d}`; };

/**
 * 今週（月曜〜日曜）のふりかえりの文章（純粋関数）
 * @returns {{weekStart: string, name: string, text: string}}
 */
export function weeklySummary(data, today = todayStr()) {
  const s = shareSettings(data);
  const ws = weekStart(today);
  const we = addDays(ws, 6);
  const goal = data.settings.weeklyGoalDays || 3;
  const days = [...exerciseDays(data)].filter((d) => d >= ws && d <= we).length;
  const lines = [`【STRIDE 今週のふりかえり】${md(ws)}〜${md(we)}`, nameOf(s)];
  lines.push(`・運動 ${days} 日（目標 ${goal} 日${days >= goal ? ' 達成🎉' : ''}）`);
  if (s.weight) {
    const ws_ = sortByDate((data.weights || []).filter((w) => w.date >= ws && w.date <= we));
    if (ws_.length >= 2) {
      const diff = ws_[ws_.length - 1].weightKg - ws_[0].weightKg;
      const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
      lines.push(`・体重 ${sign}${fmtNum(Math.abs(diff))}kg（週のはじめと比べて）`);
    }
  }
  if (s.pb) {
    const ev = pbEventsBetween(data, ws, we, s);
    if (ev.length) {
      const head = ev[ev.length - 1].text.replace(/ 自己ベスト更新！ ?/, ' 自己ベスト ');
      lines.push(`・自己ベスト ${ev.length} 件（最新：${head}）`);
    }
  }
  return { weekStart: ws, name: nameOf(s), text: lines.join('\n') };
}

/** 自己ベストの報告の文章 */
export function pbReportText(data, msgText) {
  return `🎉 ${nameOf(shareSettings(data))}：${msgText}`;
}

/* ---------- 送れていない報告の一時保存（端末） ---------- */

export function queueReport(text) {
  const q = readQueue();
  q.push({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, text });
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.slice(-20))); } catch (_) { /* 何もしない */ }
}

export function readQueue() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (_) { return []; }
}

export function removeFromQueue(id) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(readQueue().filter((x) => x.id !== id))); } catch (_) { /* 何もしない */ }
}
