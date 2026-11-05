// ホーム画面の「今日のタスク」カード
// Task Board（tasks/）が同じサイトの localStorage に保存しているデータ（taskBoard.data）を読むだけで、書き込みはしない。
import { todayStr } from '../calc.js';
import { h } from '../ui.js';
import { stat } from './home-goal.js';

const TASK_KEY = 'taskBoard.data';
const MAX_LIST = 3;

/** Task Board のタスク一覧を読む。読めなければ null */
export function loadTasks() {
  try {
    const raw = localStorage.getItem(TASK_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data?.tasks) ? data.tasks : null;
  } catch (_) {
    return null;
  }
}

export const TASK_STATUS_LABEL = { todo: '未着手', doing: '作業中', review: '確認待ち', done: '完了' };

/** 期限の日付ごとのタスク（カレンダー用。v2.6.0）。完了も含め、日付の中は未完了 → 優先度の高い順 */
export function tasksByDue(tasks) {
  const rank = { high: 3, medium: 2, low: 1 };
  const map = new Map();
  for (const t of tasks || []) {
    if (!t || typeof t.due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) continue;
    if (!map.has(t.due)) map.set(t.due, []);
    map.get(t.due).push(t);
  }
  for (const list of map.values()) {
    list.sort((a, b) => ((a.status === 'done') - (b.status === 'done')) || ((rank[b.priority] || 0) - (rank[a.priority] || 0)));
  }
  return map;
}

/** 集計（期限切れ・今日が期限・作業中・今日やる）と、表示するタスク */
export function summarizeTasks(tasks, today) {
  const open = tasks.filter((t) => t && t.status !== 'done' && typeof t.due === 'string');
  const overdue = open.filter((t) => t.due < today);
  const dueToday = open.filter((t) => t.due === today);
  const doing = open.filter((t) => t.status === 'doing');
  const myDay = open.filter((t) => t.myDay === today);
  // 表示順: 期限切れ（古い順）→ 今日が期限 → 今日やる
  const seen = new Set();
  const list = [...overdue.sort((a, b) => (a.due < b.due ? -1 : 1)), ...dueToday, ...myDay]
    .filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
  return { overdue: overdue.length, dueToday: dueToday.length, doing: doing.length, myDay: myDay.length, list, openCount: open.length };
}

export function tasksCard() {
  const openTasks = () => { location.href = './tasks/'; };
  const card = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: '今日のタスク' }));
  const tasks = loadTasks();

  if (tasks === null) {
    card.append(h('p', { class: 'card-note', text: 'タスクのデータを読み取れませんでした。タスク画面で確認してください。' }));
  } else if (!tasks.length) {
    card.append(h('p', { class: 'card-note', text: 'タスク画面（Task Board）でタスクを登録すると、期限切れや今日が期限のタスクをここに表示します。' }));
  } else {
    const today = todayStr();
    const s = summarizeTasks(tasks, today);
    card.append(h('div', { class: 'stats stats-3' },
      stat('期限切れ', `${s.overdue}`, '件'),
      stat('今日が期限', `${s.dueToday}`, '件'),
      stat('作業中', `${s.doing}`, '件'),
    ));
    if (s.overdue) card.lastChild.firstChild.classList.add('stat-alert');
    if (s.list.length) {
      card.append(h('ul', { class: 'task-peek' }, s.list.slice(0, MAX_LIST).map((t) => {
        const kind = t.due < today ? 'overdue' : t.due === today ? 'today' : 'myday';
        const badge = kind === 'overdue' ? '期限切れ' : kind === 'today' ? '今日が期限' : '今日やる';
        return h('li', { class: `task-peek-item ${kind}` },
          h('span', { class: 'task-peek-badge', text: badge }),
          h('span', { class: 'task-peek-title', text: t.title || '（無題）' }),
          t.project ? h('span', { class: 'task-peek-project', text: t.project }) : null,
        );
      })));
      if (s.list.length > MAX_LIST) card.append(h('p', { class: 'card-note', text: `ほか ${s.list.length - MAX_LIST} 件` }));
    } else {
      card.append(h('p', { class: 'card-note', text: `期限切れ・今日が期限のタスクはありません（未完了 ${s.openCount} 件）。` }));
    }
  }
  card.append(h('button', { type: 'button', class: 'btn btn-block', text: 'タスク画面を開く', onclick: openTasks }));
  return card;
}

/**
 * タスクをすべて削除する（Task Board の設定・テンプレートは残す）。
 * @returns {boolean} 削除できたら true。データを読み取れない・保存できないときは false
 */
export function clearAllTasks() {
  try {
    const raw = localStorage.getItem(TASK_KEY);
    if (!raw) return true;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tasks)) return false;
    data.tasks = [];
    localStorage.setItem(TASK_KEY, JSON.stringify(data));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * タスクを JSON ファイルに書き出す（Task Board の「JSONをエクスポート」と同じ形式。元の Task Board・claude.ai 版でも読み込める）
 * @returns {number|null} 書き出した件数。データを読み取れないときは null
 */
export function exportTasksJSON() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(TASK_KEY) || 'null');
  } catch (_) {
    return null;
  }
  if (data && !Array.isArray(data.tasks)) return null;
  const payload = {
    app: 'task-board',
    version: data?.version ?? 3,
    exportedAt: new Date().toISOString(),
    tasks: data?.tasks ?? [],
    templates: data?.templates ?? [],
    settings: data?.settings ?? {},
  };
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `task-board-backup-${stamp}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payload.tasks.length;
}

/** 完了したタスクの件数（読み取れないときは null） */
export function countDoneTasks() {
  const tasks = loadTasks();
  return tasks === null ? null : tasks.filter((t) => t && t.status === 'done').length;
}

/**
 * 完了したタスクを削除する。削除したタスクを「先行タスク」にしていた参照も外す
 * @returns {number|null} 削除した件数。読み取り・保存に失敗したら null
 */
export function clearDoneTasks() {
  try {
    const data = JSON.parse(localStorage.getItem(TASK_KEY) || 'null');
    if (!data || !Array.isArray(data.tasks)) return null;
    const doneIds = new Set(data.tasks.filter((t) => t && t.status === 'done').map((t) => t.id));
    data.tasks = data.tasks
      .filter((t) => !doneIds.has(t.id))
      .map((t) => (t.dependsOn && doneIds.has(t.dependsOn) ? { ...t, dependsOn: '' } : t));
    localStorage.setItem(TASK_KEY, JSON.stringify(data));
    return doneIds.size;
  } catch (_) {
    return null;
  }
}
