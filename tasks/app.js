/*
 * Task Board — タスク・案件の進捗管理ツール
 *
 * 構成
 *   1. 定数・設定
 *   2. ユーティリティ（日付・ID・DOM・アイコン）
 *   3. データ検証と保存（localStorage）
 *   4. 状態とデータ操作（登録・編集・状態変更・メモ・チェックリスト・削除）
 *   5. 絞り込み・並び替え
 *   6. 描画（サマリー・絞り込み欄・一覧・ボード）
 *   7. 詳細パネル
 *   8. ダイアログ（登録・編集・複製フォーム／確認）
 *   9. 通知・保存エラー表示
 *  10. バックアップ・書き出し（JSON / CSV / .ics）、報告文・共有（Outlook / Webex / Teams）、サンプルデータ
 *  11. 初期化・イベント設定
 *
 * 外部サービスとは通信しない。Outlook へは mailto: と .ics ファイル、Webex / Teams へはクリップボード経由で渡す。
 *
 * ユーザー入力は必ず textContent / setAttribute で扱い、HTML として解釈させない。
 * innerHTML を使うのは、このファイル内で定義した固定の SVG アイコンだけ。
 */
'use strict';

(function () {
  // ==========================================================
  // 1. 定数・設定
  // ==========================================================
  const APP_ID = 'task-board';
  // claude.ai 版（cloud-sync.js）で開いたときだけ存在する接続口。ローカル版では null
  const host = window.TaskBoardHost || null;
  // v2：チェックリストを追加／v3：開始日・タグ・繰り返し・今日やる・テンプレートを追加。
  // 古い版のデータは、読み込み時に足りない項目を補って最新版に変換する
  const DATA_VERSION = 3;
  const STORAGE_KEY = 'taskBoard.data';
  const PREFS_KEY = 'taskBoard.prefs'; // 表示切替など、この端末だけの表示設定
  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
  const SOON_DAYS = 3; // 期限まで N 日以内なら「あとN日」と表示する
  const WEEK_DAYS = 7; // 「今後7日間」の範囲
  // mailto: の URL が長すぎるとメールソフトに渡らないことがあるため、超える場合は本文をクリップボード経由にする（目安値）
  const MAILTO_MAX_LENGTH = 2000;
  const ICS_ALARM = '-PT15H'; // 予定表の通知：期限日の前日 9:00（終日予定の開始 0:00 の 15 時間前）
  const GANTT_DAYS = 35; // ガントチャートに表示する日数（5週間）
  const GANTT_LEAD_DAYS = 7; // ガントチャートで今日より前に表示する日数
  const MAX_TAGS = 10;
  const UNDO_MS = 8000; // 「元に戻す」を押せる時間

  const STATUSES = [
    { value: 'todo', label: '未着手' },
    { value: 'doing', label: '作業中' },
    { value: 'review', label: '確認待ち' },
    { value: 'done', label: '完了' },
  ];
  const PRIORITIES = [
    { value: 'high', label: '高', rank: 3 },
    { value: 'medium', label: '中', rank: 2 },
    { value: 'low', label: '低', rank: 1 },
  ];
  const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));
  const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.label]));
  const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.rank]));
  const RECURRENCES = [
    { value: 'none', label: 'なし' },
    { value: 'daily', label: '毎日' },
    { value: 'weekdays', label: '平日（月〜金）' },
    { value: 'weekly', label: '毎週' },
    { value: 'monthly', label: '毎月' },
  ];
  const RECURRENCE_LABEL = Object.fromEntries(RECURRENCES.map((r) => [r.value, r.label]));
  const VIEWS = ['list', 'board', 'gantt', 'calendar'];

  const HISTORY_TYPES = ['create', 'edit', 'status', 'memo', 'checklist'];
  const HISTORY_LABEL = {
    create: 'タスクを作成',
    edit: '項目を編集',
    status: '状態を変更',
    memo: 'メモを追加',
    checklist: 'チェックリスト',
  };

  // フォームで編集できる項目（表示順）
  const FIELDS = [
    'title',
    'project',
    'assignee',
    'startDate',
    'due',
    'status',
    'priority',
    'recurrence',
    'dependsOn',
    'estimateHours',
    'actualHours',
    'tags',
    'description',
  ];
  const FIELD_LABEL = {
    title: 'タスク名',
    project: '案件名',
    assignee: '担当者',
    startDate: '開始日',
    due: '期限',
    priority: '優先度',
    status: '状態',
    recurrence: '繰り返し',
    dependsOn: '先行タスク',
    estimateHours: '予定時間',
    actualHours: '実績時間',
    tags: 'タグ',
    description: '詳細説明',
  };
  const MAX_HOURS = 9999;
  // 自動化ルール（設定画面で ON / OFF）
  const RULES = [
    { key: 'checklistDoneToReview', label: 'チェックリストの項目がすべて完了したら、状態を「確認待ち」にする（未着手・作業中のときだけ）' },
    { key: 'doingToMyDay', label: '状態を「作業中」にしたら、「今日やる」に追加する' },
  ];
  const DEFAULT_SETTINGS = { myName: '自分', rules: { checklistDoneToReview: false, doingToMyDay: false } };
  const MAX_LENGTH = { title: 200, project: 100, assignee: 50, description: 5000, memo: 5000, checklist: 200, tag: 20, templateName: 50 };

  const DEFAULT_FILTERS = { keyword: '', status: 'all', priority: 'all', assignee: 'all', tag: 'all', due: 'all', sort: 'due' };
  const FILTER_KEYS = ['keyword', 'status', 'priority', 'assignee', 'tag', 'due']; // 並び替え以外の絞り込み条件

  // サマリーカードをクリックしたときに適用する絞り込み
  const SUMMARY_PRESETS = {
    open: { status: 'open' },
    doing: { status: 'doing' },
    review: { status: 'review' },
    overdue: { due: 'overdue' },
  };

  // ==========================================================
  // 2. ユーティリティ
  // ==========================================================
  const pad2 = (n) => String(n).padStart(2, '0');
  const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

  /** ローカル日付を YYYY-MM-DD にする（UTC に変換しない） */
  function toDateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function todayKey() {
    return toDateKey(new Date());
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return { y, m, d };
  }

  function addDays(key, days) {
    const { y, m, d } = parseDateKey(key);
    return toDateKey(new Date(y, m - 1, d + days));
  }

  /** n か月後の同じ日。その月に同じ日がなければ月末にする（1/31 → 2/28） */
  function addMonths(key, months) {
    const { y, m, d } = parseDateKey(key);
    const lastDay = new Date(y, m - 1 + months + 1, 0).getDate();
    return toDateKey(new Date(y, m - 1 + months, Math.min(d, lastDay)));
  }

  function weekdayOf(key) {
    const { y, m, d } = parseDateKey(key);
    return new Date(y, m - 1, d).getDay();
  }

  function isWeekend(key) {
    const day = weekdayOf(key);
    return day === 0 || day === 6;
  }

  /** fromKey から toKey までの日数（暦日の差。時刻やタイムゾーンの影響を受けない） */
  function daysBetween(fromKey, toKey) {
    const a = parseDateKey(fromKey);
    const b = parseDateKey(toKey);
    return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  }

  function isValidDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const { y, m, d } = parseDateKey(value);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }

  function formatDate(key) {
    const { y, m, d } = parseDateKey(key);
    return `${y}/${pad2(m)}/${pad2(d)}（${WEEKDAY[new Date(y, m - 1, d).getDay()]}）`;
  }

  function formatDateTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function isValidTimestamp(value) {
    return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix) {
    const random =
      window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}_${random}`;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function excerpt(text, max) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
  }

  /** 検索用に表記ゆれ（全角・半角、大文字・小文字）をそろえる */
  function normalizeForSearch(text) {
    return text.normalize('NFKC').toLowerCase();
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  const $ = (selector, root = document) => root.querySelector(selector);

  /** 要素を作る。子要素の文字列は必ずテキストノードとして追加する */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  // 固定の SVG アイコン（ユーザー入力は含めない）
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    sparkle: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/>',
    reset: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
    checklist: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    hourglass: '<path d="M6 2h12M6 22h12"/><path d="M7 2v3.5L12 12l5-6.5V2"/><path d="M7 22v-3.5L12 12l5 6.5V22"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  };

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = ICONS[name];
    return svg;
  }

  // ==========================================================
  // 3. データ検証と保存
  // ==========================================================
  function emptyData() {
    return { app: APP_ID, version: DATA_VERSION, tasks: [], templates: [], settings: deepClone(DEFAULT_SETTINGS) };
  }

  function isValidHours(value) {
    return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_HOURS);
  }

  function normalizeSettings(raw) {
    if (raw === undefined) return { settings: deepClone(DEFAULT_SETTINGS) };
    if (!isPlainObject(raw)) return { error: '設定の形式が正しくありません' };
    if (raw.myName !== undefined && typeof raw.myName !== 'string') return { error: '設定（自分の名前）の形式が正しくありません' };
    if (raw.rules !== undefined && !isPlainObject(raw.rules)) return { error: '設定（自動化ルール）の形式が正しくありません' };
    const rules = {};
    for (const { key } of RULES) {
      const value = raw.rules ? raw.rules[key] : undefined;
      if (value !== undefined && typeof value !== 'boolean') return { error: '設定（自動化ルール）の形式が正しくありません' };
      rules[key] = value === undefined ? DEFAULT_SETTINGS.rules[key] : value;
    }
    const myName = raw.myName === undefined ? DEFAULT_SETTINGS.myName : raw.myName.trim();
    return { settings: { myName, rules } };
  }

  /** タグの前後の空白を除き、空と重複を取り除く */
  function normalizeTags(list) {
    const seen = new Set();
    const tags = [];
    for (const raw of list) {
      const tag = raw.trim();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      tags.push(tag);
    }
    return tags;
  }

  /** 入力欄のタグ（カンマ・読点区切り）を配列にする */
  function parseTagInput(text) {
    return normalizeTags(text.split(/[,，、]/));
  }

  /**
   * 保存データ・インポートデータを検証し、正規化したデータを返す。
   * 想定外の形式は ok:false で拒否する（呼び出し側は既存データに触れない）。
   */
  function validateData(input) {
    const fail = (message) => ({ ok: false, errors: [message] });
    if (!isPlainObject(input)) return fail('データの形式が正しくありません（オブジェクトではありません）');
    if (input.app !== undefined && input.app !== APP_ID) return fail('Task Board のデータではありません');
    if (!Number.isInteger(input.version)) return fail('データのバージョン番号がありません');
    if (input.version > DATA_VERSION) {
      return fail(`新しいバージョン（v${input.version}）のデータのため読み込めません`);
    }
    if (input.version < 1) return fail(`不明なバージョン（v${input.version}）のデータです`);
    // 古い版のデータは、normalizeTask / normalizeTemplate で足りない項目を補って最新版にする
    if (!Array.isArray(input.tasks)) return fail('タスクの一覧（tasks）がありません');
    if (input.templates !== undefined && !Array.isArray(input.templates)) return fail('テンプレートの形式が正しくありません');

    const errors = [];
    const usedIds = new Set();
    const tasks = [];
    input.tasks.forEach((raw, index) => {
      const result = normalizeTask(raw, `${index + 1}件目のタスク`, usedIds);
      if (result.error) errors.push(result.error);
      else tasks.push(result.task);
    });
    const templates = [];
    (input.templates || []).forEach((raw, index) => {
      const result = normalizeTemplate(raw, `${index + 1}件目のテンプレート`, usedIds);
      if (result.error) errors.push(result.error);
      else templates.push(result.template);
    });
    const settingsResult = normalizeSettings(input.settings);
    if (settingsResult.error) errors.push(settingsResult.error);
    if (errors.length) return { ok: false, errors };
    // 存在しないタスクを指す先行タスクは外す（自分自身も不可）
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const task of tasks) {
      if (task.dependsOn && (!taskIds.has(task.dependsOn) || task.dependsOn === task.id)) task.dependsOn = '';
    }
    return { ok: true, data: { app: APP_ID, version: DATA_VERSION, tasks, templates, settings: settingsResult.settings } };
  }

  const isStringArray = (value) => Array.isArray(value) && value.every((v) => typeof v === 'string');

  function normalizeTemplate(raw, where, usedIds) {
    const error = (message) => ({ error: `${where}：${message}` });
    const isStr = (v) => typeof v === 'string';
    const optionalStr = (v) => v === undefined || isStr(v);
    if (!isPlainObject(raw)) return error('形式が正しくありません');
    if (!isStr(raw.id) || !raw.id.trim() || usedIds.has(raw.id)) return error('ID がないか、重複しています');
    usedIds.add(raw.id);
    if (!isStr(raw.name) || !raw.name.trim()) return error('テンプレート名がありません');
    if (!isStr(raw.title) || !raw.title.trim()) return error('タスク名がありません');
    if (!optionalStr(raw.project) || !optionalStr(raw.assignee) || !optionalStr(raw.description)) {
      return error('案件名・担当者・詳細説明の形式が正しくありません');
    }
    if (!PRIORITY_LABEL[raw.priority]) return error('優先度の値が正しくありません');
    if (raw.recurrence !== undefined && !RECURRENCE_LABEL[raw.recurrence]) return error('繰り返しの値が正しくありません');
    if (raw.tags !== undefined && !isStringArray(raw.tags)) return error('タグの形式が正しくありません');
    if (raw.checklist !== undefined && !isStringArray(raw.checklist)) return error('チェックリストの形式が正しくありません');
    if (!isValidTimestamp(raw.createdAt)) return error('作成日時が正しくありません');
    return {
      template: {
        id: raw.id,
        name: raw.name.trim(),
        title: raw.title.trim(),
        project: (raw.project || '').trim(),
        assignee: (raw.assignee || '').trim(),
        priority: raw.priority,
        recurrence: raw.recurrence || 'none',
        tags: normalizeTags(raw.tags || []),
        description: raw.description || '',
        checklist: (raw.checklist || []).map((t) => t.trim()).filter(Boolean),
        createdAt: raw.createdAt,
      },
    };
  }

  function normalizeTask(raw, where, usedIds) {
    const error = (message) => ({ error: `${where}：${message}` });
    const isStr = (v) => typeof v === 'string';
    const optionalStr = (v) => v === undefined || isStr(v);
    const takeId = (id) => {
      if (!isStr(id) || !id.trim() || usedIds.has(id)) return false;
      usedIds.add(id);
      return true;
    };

    if (!isPlainObject(raw)) return error('形式が正しくありません');
    if (!takeId(raw.id)) return error('ID がないか、重複しています');
    if (!isStr(raw.title) || !raw.title.trim()) return error('タスク名がありません');
    if (!isStr(raw.assignee) || !raw.assignee.trim()) return error('担当者がありません');
    if (!isValidDateKey(raw.due)) return error('期限の日付が正しくありません');
    if (!PRIORITY_LABEL[raw.priority]) return error('優先度の値が正しくありません');
    if (!STATUS_LABEL[raw.status]) return error('状態の値が正しくありません');
    if (!optionalStr(raw.project) || !optionalStr(raw.description) || !optionalStr(raw.sampleKey)) {
      return error('案件名・詳細説明の形式が正しくありません');
    }
    if (!isValidTimestamp(raw.createdAt) || !isValidTimestamp(raw.updatedAt)) {
      return error('作成日時・更新日時が正しくありません');
    }
    // v3 で追加した項目（なければ初期値を補う）
    if (raw.startDate !== undefined && raw.startDate !== '' && !isValidDateKey(raw.startDate)) {
      return error('開始日の日付が正しくありません');
    }
    if (raw.startDate && raw.startDate > raw.due) return error('開始日が期限より後になっています');
    if (raw.recurrence !== undefined && !RECURRENCE_LABEL[raw.recurrence]) return error('繰り返しの値が正しくありません');
    if (raw.tags !== undefined && !isStringArray(raw.tags)) return error('タグの形式が正しくありません');
    if (raw.myDay !== undefined && raw.myDay !== '' && !isValidDateKey(raw.myDay)) return error('「今日やる」の日付が正しくありません');
    if (!optionalStr(raw.recurNextId)) return error('繰り返しの情報が正しくありません');
    if (!optionalStr(raw.dependsOn)) return error('先行タスクの形式が正しくありません');
    for (const key of ['estimateHours', 'actualHours']) {
      if (raw[key] !== undefined && !isValidHours(raw[key])) return error(`${FIELD_LABEL[key]}の値が正しくありません`);
    }

    const memos = [];
    if (!Array.isArray(raw.memos) && raw.memos !== undefined) return error('メモの形式が正しくありません');
    for (const memo of raw.memos === undefined ? [] : raw.memos) {
      if (!isPlainObject(memo) || !takeId(memo.id) || !isStr(memo.text) || !isValidTimestamp(memo.createdAt)) {
        return error('メモの形式が正しくありません');
      }
      memos.push({ id: memo.id, text: memo.text, createdAt: memo.createdAt });
    }

    const checklist = [];
    if (!Array.isArray(raw.checklist) && raw.checklist !== undefined) return error('チェックリストの形式が正しくありません');
    for (const item of raw.checklist === undefined ? [] : raw.checklist) {
      if (
        !isPlainObject(item) ||
        !takeId(item.id) ||
        !isStr(item.text) ||
        !item.text.trim() ||
        typeof item.done !== 'boolean' ||
        !isValidTimestamp(item.createdAt)
      ) {
        return error('チェックリストの形式が正しくありません');
      }
      checklist.push({ id: item.id, text: item.text.trim(), done: item.done, createdAt: item.createdAt });
    }

    const history = [];
    if (!Array.isArray(raw.history) && raw.history !== undefined) return error('対応履歴の形式が正しくありません');
    for (const entry of raw.history === undefined ? [] : raw.history) {
      if (
        !isPlainObject(entry) ||
        !takeId(entry.id) ||
        !isValidTimestamp(entry.at) ||
        !HISTORY_TYPES.includes(entry.type) ||
        !optionalStr(entry.text)
      ) {
        return error('対応履歴の形式が正しくありません');
      }
      const changes = entry.changes === undefined ? [] : entry.changes;
      const changesValid =
        Array.isArray(changes) &&
        changes.every((c) => isPlainObject(c) && isStr(c.label) && isStr(c.from) && isStr(c.to));
      if (!changesValid) return error('対応履歴の変更内容の形式が正しくありません');
      const normalized = {
        id: entry.id,
        at: entry.at,
        type: entry.type,
        changes: changes.map((c) => ({ label: c.label, from: c.from, to: c.to })),
      };
      if (entry.text !== undefined) normalized.text = entry.text;
      history.push(normalized);
    }

    const task = {
      id: raw.id,
      title: raw.title.trim(),
      project: (raw.project || '').trim(),
      assignee: raw.assignee.trim(),
      startDate: raw.startDate || '',
      due: raw.due,
      priority: raw.priority,
      status: raw.status,
      recurrence: raw.recurrence || 'none',
      dependsOn: raw.dependsOn || '',
      estimateHours: raw.estimateHours === undefined ? null : raw.estimateHours,
      actualHours: raw.actualHours === undefined || raw.actualHours === null ? 0 : raw.actualHours,
      tags: normalizeTags(raw.tags || []),
      description: raw.description || '',
      myDay: raw.myDay || '',
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      checklist,
      memos,
      history,
    };
    if (raw.sampleKey) task.sampleKey = raw.sampleKey;
    if (raw.recurNextId) task.recurNextId = raw.recurNextId;
    return { task };
  }

  const storage = {
    read() {
      try {
        return { ok: true, raw: window.localStorage.getItem(STORAGE_KEY) };
      } catch (err) {
        return { ok: false, error: err };
      }
    },
    write(data) {
      if (state.memoryOnly) return { ok: true }; // claude.ai 版：この端末には残さず、claude.ai 側に保存する
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err };
      }
    },
  };

  // 表示設定（一覧／ボード）。保存できなくても動作に影響しないため、失敗は無視する
  const prefs = {
    load() {
      try {
        const value = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
        return isPlainObject(value) ? value : {};
      } catch (err) {
        return {};
      }
    },
    save(value) {
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(value));
      } catch (err) {
        /* 表示設定の保存失敗はデータに影響しないため無視 */
      }
    },
  };

  /** 起動時の読み込み。壊れたデータは上書きせず、別キーへ退避してから空で始める */
  function loadData() {
    const result = storage.read();
    if (!result.ok && host) {
      state.memoryOnly = true;
      return emptyData();
    }
    if (!result.ok) {
      state.saveBlocked = true;
      state.startupNotice =
        'このブラウザではデータを保存できません（localStorage が無効です）。README の「ローカルサーバーで起動する」方法をお試しください。';
      return emptyData();
    }
    if (result.raw === null) return emptyData();

    let parsed;
    try {
      parsed = JSON.parse(result.raw);
    } catch (err) {
      parsed = undefined;
    }
    const validated = parsed === undefined ? { ok: false } : validateData(parsed);
    if (validated.ok) return validated.data;

    const backupKey = `${STORAGE_KEY}.unreadable-${Date.now()}`;
    try {
      window.localStorage.setItem(backupKey, result.raw);
      state.startupNotice = `保存データを読み込めなかったため、元のデータを「${backupKey}」に退避して空の状態で開始しました。`;
    } catch (err) {
      // 退避できない場合は元データを守るため保存を止める
      state.saveBlocked = true;
      state.startupNotice = '保存データを読み込めませんでした。元のデータを守るため、保存を停止しています。';
    }
    return emptyData();
  }

  // ==========================================================
  // 4. 状態とデータ操作
  // ==========================================================
  const state = {
    data: emptyData(),
    filters: { ...DEFAULT_FILTERS },
    today: todayKey(),
    view: 'list', // 'list'（一覧）/ 'board'（ボード）/ 'gantt'（ガント）/ 'calendar'（カレンダー）
    selected: new Set(), // 一覧で一括操作のために選んだタスクの ID
    ganttStart: '', // ガントチャートの表示開始日
    calendarMonth: '', // カレンダーの表示月（YYYY-MM）
    detailTaskId: null,
    editingTaskId: null,
    formMode: 'create', // 'create'（新規）/ 'edit'（編集）/ 'duplicate'（複製）
    duplicateChecklist: [], // 複製時に引き継ぐチェックリストの項目
    draggingTaskId: null,
    share: { mode: 'report', taskId: null },
    formSnapshot: '',
    saveBlocked: false,
    memoryOnly: false, // claude.ai 版で localStorage が使えないとき
    ai: null, // claude.ai 版で Claude に聞ける場合の関数群（cloud-sync.js が設定）
    icsAvailable: true, // claude.ai 版では .ics を保存できないため false になる
    startupNotice: '',
  };

  function findTask(id, data = state.data) {
    return data.tasks.find((t) => t.id === id) || null;
  }

  /**
   * 変更後のデータを保存する。保存に成功したときだけ画面のデータを差し替える。
   * 失敗したときは成功表示を出さず、エラーとバックアップの案内を出す。
   */
  function commit(nextData, successMessage) {
    if (state.saveBlocked) {
      showSaveError(null);
      return false;
    }
    const result = storage.write(nextData);
    if (!result.ok) {
      showSaveError(result.error);
      return false;
    }
    const prevData = state.data;
    state.data = nextData;
    renderAll();
    if (successMessage) toast(successMessage, 'success');
    if (host && host.afterCommit) {
      try {
        host.afterCommit(prevData, nextData);
      } catch (err) {
        /* 同期の失敗は cloud-sync.js が画面に表示する */
      }
    }
    return true;
  }

  function historyEntry(type, at, extra) {
    return { id: createId('hist'), at, type, changes: [], ...extra };
  }

  /** 履歴に残す表示用の値 */
  function displayValue(field, value) {
    if (field === 'due') return formatDate(value);
    if (field === 'startDate') return value ? formatDate(value) : '（なし）';
    if (field === 'priority') return PRIORITY_LABEL[value];
    if (field === 'status') return STATUS_LABEL[value];
    if (field === 'recurrence') return RECURRENCE_LABEL[value];
    if (field === 'tags') return value.length ? value.join('、') : '（なし）';
    if (field === 'estimateHours') return value === null ? '（なし）' : formatHours(value);
    if (field === 'actualHours') return formatHours(value || 0);
    if (field === 'dependsOn') {
      const pre = value ? findTask(value) : null;
      return pre ? excerpt(pre.title, 40) : '（なし）';
    }
    if (field === 'description') return value ? excerpt(value, 40) : '（なし）';
    return value || '（なし）';
  }

  function sameValue(field, a, b) {
    return field === 'tags' ? a.join('\n') === b.join('\n') : a === b;
  }

  function createTask(values, checklistTexts = [], successMessage = 'タスクを登録しました') {
    const now = nowIso();
    const task = {
      id: createId('task'),
      ...values,
      myDay: '',
      createdAt: now,
      updatedAt: now,
      checklist: checklistTexts.map((text) => ({ id: createId('check'), text, done: false, createdAt: now })),
      memos: [],
      history: [historyEntry('create', now)],
    };
    const next = deepClone(state.data);
    next.tasks.push(task);
    return commit(next, successMessage);
  }

  // ----- 繰り返しタスク -----
  /** 期限から n 回先の日付 */
  function stepOccurrence(dueKey, rule, n) {
    if (rule === 'daily') return addDays(dueKey, n);
    if (rule === 'weekly') return addDays(dueKey, 7 * n);
    if (rule === 'monthly') return addMonths(dueKey, n); // 元の日付を基準にして、月末のずれをためない
    // weekdays：土日を飛ばして n 日先
    let key = dueKey;
    for (let i = 0; i < n; i++) {
      do key = addDays(key, 1);
      while (isWeekend(key));
    }
    return key;
  }

  /** 次回の期限。遅れて完了した場合も、今日より前にならないところまで進める */
  function nextOccurrence(dueKey, rule) {
    if (rule === 'weekdays') {
      let key = stepOccurrence(dueKey, rule, 1);
      while (key < state.today) key = stepOccurrence(key, rule, 1);
      return key;
    }
    let n = 1;
    let key = stepOccurrence(dueKey, rule, n);
    while (key < state.today) key = stepOccurrence(dueKey, rule, ++n);
    return key;
  }

  /**
   * 繰り返し設定のあるタスクが完了したら、次回分を作る（data を直接変更する）。
   * 完了 → 未完了 → 完了と切り替えても、次回分が残っていれば重複して作らない。
   */
  function spawnNextRecurrence(data, task, now) {
    if (task.recurrence === 'none' || task.status !== 'done') return null;
    if (task.recurNextId && findTask(task.recurNextId, data)) return null;
    const due = nextOccurrence(task.due, task.recurrence);
    const span = task.startDate ? daysBetween(task.startDate, task.due) : null;
    const created = {
      id: createId('task'),
      title: task.title,
      project: task.project,
      assignee: task.assignee,
      startDate: span === null ? '' : addDays(due, -span),
      due,
      priority: task.priority,
      status: 'todo',
      recurrence: task.recurrence,
      dependsOn: '',
      estimateHours: task.estimateHours,
      actualHours: 0,
      tags: task.tags.slice(),
      description: task.description,
      myDay: '',
      createdAt: now,
      updatedAt: now,
      checklist: task.checklist.map((i) => ({ id: createId('check'), text: i.text, done: false, createdAt: now })),
      memos: [],
      history: [historyEntry('create', now, { text: `繰り返し（${RECURRENCE_LABEL[task.recurrence]}）で自動作成` })],
    };
    task.recurNextId = created.id;
    data.tasks.push(created);
    return created;
  }

  function recurrenceMessage(created) {
    return created ? `。次回分（期限 ${shortDate(created.due)}）を作成しました` : '';
  }

  /** 完了したタスクを先行タスクにしているタスク（未完了のもの）への案内 */
  function unblockedMessage(data, doneTask) {
    if (doneTask.status !== 'done') return '';
    const waiting = data.tasks.filter((t) => t.dependsOn === doneTask.id && t.status !== 'done');
    if (!waiting.length) return '';
    const names = waiting.slice(0, 2).map((t) => `「${excerpt(t.title, 20)}」`).join('');
    return `。${names}${waiting.length > 2 ? `ほか${waiting.length - 2}件` : ''}に着手できます`;
  }

  /** 状態変更に伴う自動化ルール（data を直接変更する） */
  function applyStatusRules(data, task) {
    if (data.settings.rules.doingToMyDay && task.status === 'doing') task.myDay = state.today;
  }

  /** @returns {'saved'|'unchanged'|'failed'} */
  function updateTask(id, values) {
    const next = deepClone(state.data);
    const task = findTask(id, next);
    if (!task) {
      toast('対象のタスクが見つかりません。削除された可能性があります。', 'error');
      return 'failed';
    }
    const changes = [];
    let statusChange = null;
    for (const field of FIELDS) {
      if (sameValue(field, task[field], values[field])) continue;
      const change = { label: FIELD_LABEL[field], from: displayValue(field, task[field]), to: displayValue(field, values[field]) };
      if (field === 'status') statusChange = change;
      else changes.push(change);
      task[field] = field === 'tags' ? values.tags.slice() : values[field];
    }
    if (!changes.length && !statusChange) return 'unchanged';

    const now = nowIso();
    task.updatedAt = now;
    if (changes.length) task.history.push(historyEntry('edit', now, { changes }));
    if (statusChange) task.history.push(historyEntry('status', now, { changes: [statusChange] }));
    let extra = '';
    if (statusChange) {
      applyStatusRules(next, task);
      extra = recurrenceMessage(spawnNextRecurrence(next, task, now)) + unblockedMessage(next, task);
    }
    return commit(next, `タスクを更新しました${extra}`) ? 'saved' : 'failed';
  }

  /** 状態を変える（data を直接変更する）。変わらなければ false */
  function applyStatus(data, task, status, now) {
    if (task.status === status) return false;
    task.history.push(
      historyEntry('status', now, {
        changes: [{ label: FIELD_LABEL.status, from: STATUS_LABEL[task.status], to: STATUS_LABEL[status] }],
      })
    );
    task.status = status;
    task.updatedAt = now;
    return true;
  }

  function changeStatus(id, status) {
    const next = deepClone(state.data);
    const task = findTask(id, next);
    if (!task || !STATUS_LABEL[status]) return false;
    const now = nowIso();
    if (!applyStatus(next, task, status, now)) return false;
    applyStatusRules(next, task);
    const extra = recurrenceMessage(spawnNextRecurrence(next, task, now)) + unblockedMessage(next, task);
    return commit(next, `状態を「${STATUS_LABEL[status]}」に変更しました${extra}`);
  }

  // ----- タイムトラッキング（実績時間の記録） -----
  function addActualTime(id, hours) {
    const next = deepClone(state.data);
    const task = findTask(id, next);
    if (!task) return false;
    const before = task.actualHours || 0;
    const after = Math.min(MAX_HOURS, Math.round((before + hours) * 100) / 100);
    const now = nowIso();
    task.history.push(
      historyEntry('edit', now, { changes: [{ label: FIELD_LABEL.actualHours, from: formatHours(before), to: formatHours(after) }] })
    );
    task.actualHours = after;
    task.updatedAt = now;
    return commit(next, `実績時間に ${formatHours(hours)} を記録しました（合計 ${formatHours(after)}）`);
  }

  // ----- 設定（マイタスク用の名前・自動化ルール） -----
  function saveSettings(settings) {
    const next = deepClone(state.data);
    next.settings = settings;
    return commit(next, '設定を保存しました');
  }

  // ----- 今日やる（マイデイ）。日付が変わると自動で外れる -----
  function isMyDay(task) {
    return task.myDay === state.today;
  }

  function toggleMyDay(id) {
    const next = deepClone(state.data);
    const task = findTask(id, next);
    if (!task) return false;
    const adding = !isMyDay(task);
    task.myDay = adding ? state.today : '';
    return commit(next, adding ? '「今日やる」に追加しました' : '「今日やる」から外しました');
  }

  // ----- 一括操作 -----
  /** patch：{ status } / { priority } / { myDay: true } のいずれか */
  function bulkUpdate(ids, patch) {
    const next = deepClone(state.data);
    const now = nowIso();
    let changed = 0;
    let spawned = 0;
    for (const id of ids) {
      const task = findTask(id, next);
      if (!task) continue;
      if (patch.status && applyStatus(next, task, patch.status, now)) {
        changed++;
        applyStatusRules(next, task);
        if (spawnNextRecurrence(next, task, now)) spawned++;
      } else if (patch.priority && task.priority !== patch.priority) {
        task.history.push(
          historyEntry('edit', now, {
            changes: [{ label: FIELD_LABEL.priority, from: PRIORITY_LABEL[task.priority], to: PRIORITY_LABEL[patch.priority] }],
          })
        );
        task.priority = patch.priority;
        task.updatedAt = now;
        changed++;
      } else if (patch.myDay && !isMyDay(task)) {
        task.myDay = state.today;
        changed++;
      }
    }
    if (!changed) {
      toast('変更が必要なタスクはありませんでした', 'info');
      return false;
    }
    const what = patch.status
      ? `状態を「${STATUS_LABEL[patch.status]}」に変更しました`
      : patch.priority
        ? `優先度を「${PRIORITY_LABEL[patch.priority]}」に変更しました`
        : '「今日やる」に追加しました';
    const extra = spawned ? `。繰り返しの次回分を${spawned}件作成しました` : '';
    return commit(next, `${changed}件の${what}${extra}`);
  }

  // ----- 削除と取り消し -----
  function deleteTasks(ids) {
    const removed = state.data.tasks.filter((t) => ids.includes(t.id));
    if (!removed.length) return false;
    const next = deepClone(state.data);
    next.tasks = next.tasks.filter((t) => !ids.includes(t.id));
    if (!commit(next)) return false;
    ids.forEach((id) => state.selected.delete(id));
    const label = removed.length === 1 ? `「${excerpt(removed[0].title, 30)}」を削除しました` : `${removed.length}件のタスクを削除しました`;
    toast(label, 'success', { action: { label: '元に戻す', onClick: () => restoreTasks(removed) }, duration: UNDO_MS });
    return true;
  }

  function restoreTasks(tasks) {
    const next = deepClone(state.data);
    const existing = new Set(next.tasks.map((t) => t.id));
    const toRestore = tasks.filter((t) => !existing.has(t.id));
    if (!toRestore.length) return false;
    next.tasks.push(...deepClone(toRestore));
    return commit(next, `${toRestore.length}件のタスクを元に戻しました`);
  }

  // ----- テンプレート -----
  function saveTemplate(taskId, name) {
    const next = deepClone(state.data);
    const task = findTask(taskId, next);
    if (!task) return false;
    next.templates.push({
      id: createId('tmpl'),
      name,
      title: task.title,
      project: task.project,
      assignee: task.assignee,
      priority: task.priority,
      recurrence: task.recurrence,
      tags: task.tags.slice(),
      description: task.description,
      checklist: task.checklist.map((i) => i.text),
      createdAt: nowIso(),
    });
    return commit(next, `テンプレート「${name}」を保存しました`);
  }

  function deleteTemplate(templateId) {
    const next = deepClone(state.data);
    const template = next.templates.find((t) => t.id === templateId);
    if (!template) return false;
    next.templates = next.templates.filter((t) => t.id !== templateId);
    return commit(next, `テンプレート「${template.name}」を削除しました`);
  }

  function addMemo(id, text) {
    const next = deepClone(state.data);
    const task = findTask(id, next);
    if (!task) return false;
    const now = nowIso();
    task.memos.push({ id: createId('memo'), text, createdAt: now });
    task.history.push(historyEntry('memo', now, { text: excerpt(text, 80) }));
    task.updatedAt = now;
    return commit(next, 'メモを追加しました');
  }

  /** チェックリストを変更して履歴に残す。mutate は履歴の文言を返す（変更がなければ null） */
  function updateChecklist(taskId, mutate, successMessage) {
    const next = deepClone(state.data);
    const task = findTask(taskId, next);
    if (!task) return false;
    const now = nowIso();
    const text = mutate(task, now);
    if (!text) return false;
    task.history.push(historyEntry('checklist', now, { text }));
    task.updatedAt = now;
    return commit(next, typeof successMessage === 'function' ? successMessage() : successMessage);
  }

  function addChecklistItem(taskId, text) {
    return updateChecklist(
      taskId,
      (task, now) => {
        task.checklist.push({ id: createId('check'), text, done: false, createdAt: now });
        return `「${excerpt(text, 60)}」を追加`;
      },
      'チェックリストに追加しました'
    );
  }

  function addChecklistItems(taskId, texts, source) {
    return updateChecklist(
      taskId,
      (task, now) => {
        texts.forEach((text) => task.checklist.push({ id: createId('check'), text, done: false, createdAt: now }));
        const head = `「${excerpt(texts[0], 40)}」${texts.length > 1 ? `ほか${texts.length - 1}項目` : ''}を追加`;
        return source ? `${head}（${source}）` : head;
      },
      `チェックリストに${texts.length}項目を追加しました`
    );
  }

  function toggleChecklistItem(taskId, itemId, done) {
    let movedToReview = false;
    return updateChecklist(
      taskId,
      (task, now) => {
        const item = task.checklist.find((i) => i.id === itemId);
        if (!item || item.done === done) return null;
        item.done = done;
        // 自動化ルール：全項目が完了したら「確認待ち」にする
        const allDone = task.checklist.every((i) => i.done);
        if (done && allDone && state.data.settings.rules.checklistDoneToReview && ['todo', 'doing'].includes(task.status)) {
          movedToReview = applyStatus(null, task, 'review', now);
        }
        return `「${excerpt(item.text, 60)}」を${done ? '完了' : '未完了に戻す'}`;
      },
      () =>
        movedToReview
          ? 'すべての項目が完了したので、状態を「確認待ち」にしました'
          : done
            ? '項目を完了にしました'
            : '項目を未完了に戻しました'
    );
  }

  function removeChecklistItem(taskId, itemId) {
    return updateChecklist(
      taskId,
      (task) => {
        const item = task.checklist.find((i) => i.id === itemId);
        if (!item) return null;
        task.checklist = task.checklist.filter((i) => i.id !== itemId);
        return `「${excerpt(item.text, 60)}」を削除`;
      },
      'チェックリストの項目を削除しました'
    );
  }

  function checklistProgress(task) {
    return { total: task.checklist.length, done: task.checklist.filter((i) => i.done).length };
  }

  // ==========================================================
  // 5. 絞り込み・並び替え
  // ==========================================================

  /** 'overdue'（期限切れ）/ 'today'（本日期限）/ 'upcoming' / 'done' */
  function deadlineState(task) {
    if (task.status === 'done') return 'done';
    if (task.due < state.today) return 'overdue';
    if (task.due === state.today) return 'today';
    return 'upcoming';
  }

  function matchesFilters(task, filters, keywords) {
    if (filters.status === 'open') {
      if (task.status === 'done') return false;
    } else if (filters.status !== 'all' && task.status !== filters.status) {
      return false;
    }
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (filters.assignee !== 'all' && task.assignee !== filters.assignee) return false;
    if (filters.tag !== 'all' && !task.tags.includes(filters.tag)) return false;

    if (filters.due !== 'all') {
      const ds = deadlineState(task);
      if (filters.due === 'overdue' && ds !== 'overdue') return false;
      if (filters.due === 'today' && ds !== 'today') return false;
      // 今日やる：☀ を付けたタスクと、本日期限のタスク
      if (filters.due === 'myday' && !isMyDay(task) && ds !== 'today') return false;
      if (filters.due === 'week') {
        // 今日から7日後までの未完了タスク
        if (task.status === 'done' || task.due < state.today || task.due > addDays(state.today, WEEK_DAYS)) return false;
      }
    }

    if (keywords.length) {
      const haystack = normalizeForSearch([task.title, task.project, task.assignee, task.description, ...task.tags].join('\n'));
      if (!keywords.every((k) => haystack.includes(k))) return false;
    }
    return true;
  }

  const time = (iso) => Date.parse(iso) || 0;
  const COMPARE = {
    doneLast: (a, b) => (a.status === 'done') - (b.status === 'done'),
    due: (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0),
    priority: (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority],
    updated: (a, b) => time(b.updatedAt) - time(a.updatedAt),
  };
  // 期限順・優先度順では、完了済みを末尾にまとめる
  const SORT_ORDER = {
    due: [COMPARE.doneLast, COMPARE.due, COMPARE.priority, COMPARE.updated],
    updated: [COMPARE.updated],
    priority: [COMPARE.doneLast, COMPARE.priority, COMPARE.due, COMPARE.updated],
  };

  function getVisibleTasks() {
    const filters = state.filters;
    const keywords = normalizeForSearch(filters.keyword).split(/\s+/).filter(Boolean);
    const comparers = SORT_ORDER[filters.sort] || SORT_ORDER.due;
    return state.data.tasks
      .filter((task) => matchesFilters(task, filters, keywords))
      .sort((a, b) => {
        for (const compare of comparers) {
          const r = compare(a, b);
          if (r !== 0) return r;
        }
        return 0;
      });
  }

  function activeFilterCount() {
    return FILTER_KEYS.filter((key) => state.filters[key].trim() !== DEFAULT_FILTERS[key]).length;
  }

  // ==========================================================
  // 6. 描画
  // ==========================================================
  const dom = {};

  function cacheDom() {
    Object.assign(dom, {
      addBtn: $('#add-task-btn'),
      today: $('#today-label'),
      summaryCards: Array.from(document.querySelectorAll('[data-summary]')),
      keyword: $('#filter-keyword'),
      filterSelects: {
        status: $('#filter-status'),
        priority: $('#filter-priority'),
        assignee: $('#filter-assignee'),
        tag: $('#filter-tag'),
        due: $('#filter-due'),
        sort: $('#filter-sort'),
      },
      clearFilters: $('#clear-filters'),
      clearFiltersLabel: $('#clear-filters-label'),
      resultCount: $('#result-count'),
      listSection: $('#task-list-section'),
      list: $('#task-list'),
      exportBtn: $('#export-btn'),
      importBtn: $('#import-btn'),
      importFile: $('#import-file'),
      sampleBtn: $('#sample-btn'),
      alert: $('#storage-alert'),
      alertText: $('#storage-alert-text'),
      alertExport: $('#storage-alert-export'),
      alertClose: $('#storage-alert-close'),
      toasts: $('#toast-region'),
      taskDialog: $('#task-dialog'),
      taskForm: $('#task-form'),
      taskDialogTitle: $('#task-dialog-title'),
      taskSubmit: $('#task-submit'),
      projectOptions: $('#project-options'),
      assigneeOptions: $('#assignee-options'),
      detailDialog: $('#detail-dialog'),
      detailTitle: $('#detail-title'),
      detailClose: $('#detail-close'),
      detailContent: $('#detail-content'),
      confirmDialog: $('#confirm-dialog'),
      confirmTitle: $('#confirm-title'),
      confirmMessage: $('#confirm-message'),
      confirmOk: $('#confirm-ok'),
      confirmCancel: $('#confirm-cancel'),
      viewButtons: Array.from(document.querySelectorAll('[data-view]')),
      reportBtn: $('#report-btn'),
      csvBtn: $('#csv-btn'),
      icsBtn: $('#ics-btn'),
      shareDialog: $('#share-dialog'),
      shareTitle: $('#share-title'),
      shareOptions: $('#share-options'),
      shareAssignee: $('#share-assignee'),
      shareText: $('#share-text'),
      shareCopy: $('#share-copy'),
      shareMail: $('#share-mail'),
      shareIcs: $('#share-ics'),
      shareClose: $('#share-close'),
      duplicateNote: $('#duplicate-note'),
      myDayBtn: $('#myday-btn'),
      myDayCount: $('#myday-count'),
      reportType: $('#share-type'),
      templateField: $('#template-field'),
      templateSelect: $('#f-template'),
      templateBtn: $('#template-btn'),
      templateDialog: $('#template-dialog'),
      templateList: $('#template-list'),
      templateClose: $('#template-close'),
      promptDialog: $('#prompt-dialog'),
      promptForm: $('#prompt-form'),
      promptTitle: $('#prompt-title'),
      promptLabel: $('#prompt-label'),
      promptInput: $('#prompt-input'),
      promptError: $('#prompt-error'),
      promptOk: $('#prompt-ok'),
      promptCancel: $('#prompt-cancel'),
      settingsBtn: $('#settings-btn'),
      settingsDialog: $('#settings-dialog'),
      settingsForm: $('#settings-form'),
      settingsName: $('#settings-name'),
      settingsRules: $('#settings-rules'),
      settingsCancel: $('#settings-cancel'),
      myTasksBtn: $('#mytasks-btn'),
      aiField: $('#ai-field'),
      aiInput: $('#ai-input'),
      aiRun: $('#ai-run'),
      aiStatus: $('#ai-status'),
    });
  }

  function renderAll() {
    renderViewToggle();
    renderToday();
    renderSummary();
    renderFilterOptions();
    renderList();
    renderDetail();
  }

  function renderToday() {
    const { y, m, d } = parseDateKey(state.today);
    dom.today.replaceChildren(
      h('span', { class: 'today-caption' }, '今日'),
      h('span', { class: 'today-date' }, `${pad2(m)}/${pad2(d)}`),
      h('span', { class: 'today-sub' }, h('span', { class: 'today-wd' }, WEEKDAY[new Date(y, m - 1, d).getDay()]), h('span', { class: 'today-year' }, String(y)))
    );
    dom.today.setAttribute('aria-label', `今日は${formatDate(state.today)}`);
  }

  function renderSummary() {
    const tasks = state.data.tasks; // サマリーは常に全データが対象
    const counts = {
      open: tasks.filter((t) => t.status !== 'done').length,
      doing: tasks.filter((t) => t.status === 'doing').length,
      review: tasks.filter((t) => t.status === 'review').length,
      overdue: tasks.filter((t) => deadlineState(t) === 'overdue').length,
    };
    for (const card of dom.summaryCards) {
      const key = card.dataset.summary;
      $(`[data-summary-value="${key}"]`, card).textContent = String(counts[key]);
      card.classList.toggle('has-items', counts[key] > 0);
      card.setAttribute('aria-pressed', String(isPresetActive(key)));
    }
  }

  function isPresetActive(key) {
    const expected = { ...DEFAULT_FILTERS, ...SUMMARY_PRESETS[key], sort: state.filters.sort };
    return Object.keys(DEFAULT_FILTERS).every((k) => state.filters[k] === expected[k]);
  }

  function uniqueValues(field) {
    const values = new Set(state.data.tasks.map((t) => t[field]).filter(Boolean));
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ja'));
  }

  function uniqueTags() {
    const tags = new Set(state.data.tasks.flatMap((t) => t.tags));
    return Array.from(tags).sort((a, b) => a.localeCompare(b, 'ja'));
  }

  function renderFilterOptions() {
    // 担当者・タグの絞り込み候補（選択中の値は、該当がなくなっても残す）
    const fill = (select, values, current) => {
      const list = values.slice();
      if (current !== 'all' && !list.includes(current)) list.push(current);
      select.replaceChildren(h('option', { value: 'all' }, 'すべて'), ...list.map((v) => h('option', { value: v }, v)));
    };
    fill(dom.filterSelects.assignee, uniqueValues('assignee'), state.filters.assignee);
    fill(dom.filterSelects.tag, uniqueTags(), state.filters.tag);
    syncFilterControls();
  }

  function syncFilterControls() {
    if (dom.keyword.value !== state.filters.keyword) dom.keyword.value = state.filters.keyword;
    for (const [key, select] of Object.entries(dom.filterSelects)) {
      select.value = state.filters[key];
      select.classList.toggle('is-active', key !== 'sort' && state.filters[key] !== DEFAULT_FILTERS[key]);
    }
    const count = activeFilterCount();
    dom.clearFilters.disabled = count === 0;
    dom.clearFiltersLabel.replaceChildren(
      '条件をクリア',
      count ? h('span', { class: 'filter-count', 'aria-label': `（${count}件の条件）` }, String(count)) : ''
    );
    // 今日やるボタン（☀ を付けたタスク＋本日期限のうち、未完了の件数）
    const myDayOpen = state.data.tasks.filter((t) => t.status !== 'done' && (isMyDay(t) || deadlineState(t) === 'today')).length;
    dom.myDayCount.textContent = String(myDayOpen);
    dom.myDayBtn.setAttribute('aria-pressed', String(state.filters.due === 'myday'));
    const myName = state.data.settings.myName;
    dom.myTasksBtn.setAttribute('aria-pressed', String(Boolean(myName) && state.filters.assignee === myName));
  }

  function renderList() {
    const all = state.data.tasks;
    const visible = getVisibleTasks();
    const focusKey = document.activeElement && dom.list.contains(document.activeElement)
      ? document.activeElement.dataset.focusKey
      : null;

    dom.resultCount.replaceChildren(
      '表示 ',
      h('strong', null, String(visible.length)),
      ` 件 / 全 ${all.length} 件`,
      activeFilterCount() ? '（絞り込み中）' : ''
    );

    // 一括操作の選択は、一覧に表示中のタスクだけに絞る（見えないタスクを誤って変更しないため）
    const visibleIds = new Set(visible.map((t) => t.id));
    state.selected = new Set(Array.from(state.selected).filter((id) => state.view === 'list' && visibleIds.has(id)));

    if (all.length === 0) {
      dom.list.replaceChildren(renderOnboarding());
    } else if (visible.length === 0) {
      dom.list.replaceChildren(renderNoResults());
    } else if (state.view === 'board') {
      dom.list.replaceChildren(renderBoard(visible));
    } else if (state.view === 'gantt') {
      dom.list.replaceChildren(renderGantt(visible));
    } else if (state.view === 'calendar') {
      dom.list.replaceChildren(renderCalendar(visible));
    } else {
      dom.list.replaceChildren(...[renderBulkBar(), renderTable(visible)].filter(Boolean));
      const selectAll = $('[data-select-all]', dom.list);
      if (selectAll) {
        selectAll.checked = state.selected.size > 0 && state.selected.size === visible.length;
        selectAll.indeterminate = state.selected.size > 0 && state.selected.size < visible.length;
      }
    }

    if (focusKey) {
      const target = dom.list.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
      if (target) target.focus();
    }
    syncFilterControls();
    renderSummaryPressed();
  }

  function renderViewToggle() {
    for (const button of dom.viewButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
    }
  }

  function setView(view) {
    if (!VIEWS.includes(view)) return;
    state.view = view;
    state.selected.clear();
    prefs.save({ ...prefs.load(), view });
    renderViewToggle();
    renderList();
  }

  function renderSummaryPressed() {
    for (const card of dom.summaryCards) {
      card.setAttribute('aria-pressed', String(isPresetActive(card.dataset.summary)));
    }
  }

  function renderOnboarding() {
    return h(
      'div',
      { class: 'empty-state' },
      h('span', { class: 'empty-icon' }, icon('inbox')),
      h('p', { class: 'empty-title' }, 'まだタスクがありません'),
      h(
        'p',
        { class: 'empty-text' },
        '「何を、いつまでに、誰がやるか」を登録して、対応漏れを防ぎましょう。まずは使い方を試したい場合は、サンプルデータを追加できます。'
      ),
      h(
        'div',
        { class: 'empty-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'add-first', 'data-focus-key': 'add-first' }, icon('plus'), '最初のタスクを登録する'),
        h('button', { type: 'button', class: 'btn', 'data-action': 'add-samples', 'data-focus-key': 'add-samples' }, icon('sparkle'), 'サンプルデータを追加する')
      )
    );
  }

  function renderNoResults() {
    return h(
      'div',
      { class: 'empty-state' },
      h('span', { class: 'empty-icon' }, icon('search')),
      h('p', { class: 'empty-title' }, '条件に一致するタスクがありません'),
      h('p', { class: 'empty-text' }, 'キーワードや絞り込み条件を変えるか、条件をクリアしてください。'),
      h(
        'div',
        { class: 'empty-actions' },
        h('button', { type: 'button', class: 'btn', 'data-action': 'clear-filters' }, icon('reset'), '検索条件をクリア')
      )
    );
  }

  function renderTable(tasks) {
    return h(
      'table',
      { class: 'task-table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h(
            'th',
            { scope: 'col', class: 'col-select' },
            h('input', { type: 'checkbox', class: 'select-box', 'data-select-all': true, 'data-focus-key': 'select-all', 'aria-label': '表示中のタスクをすべて選択' })
          ),
          h('th', { scope: 'col' }, 'タスク・案件'),
          h('th', { scope: 'col', class: 'col-assignee' }, '担当者'),
          h('th', { scope: 'col', class: 'col-due' }, '期限'),
          h('th', { scope: 'col', class: 'col-priority' }, '優先度'),
          h('th', { scope: 'col', class: 'col-status' }, '状態'),
          h('th', { scope: 'col', class: 'col-actions' }, h('span', { class: 'visually-hidden' }, '操作'))
        )
      ),
      h('tbody', null, tasks.map(renderRow))
    );
  }

  function renderRow(task) {
    const ds = deadlineState(task);
    const selected = state.selected.has(task.id);
    return h(
      'tr',
      { class: `task-row is-${ds}${selected ? ' is-selected' : ''}`, 'data-task-id': task.id },
      h(
        'td',
        { class: 'cell-select' },
        h('input', {
          type: 'checkbox',
          class: 'select-box',
          checked: selected,
          'data-select': task.id,
          'data-focus-key': `select:${task.id}`,
          'aria-label': `「${task.title}」を選択`,
        })
      ),
      h(
        'td',
        { class: 'cell-title' },
        h('button', { type: 'button', class: 'task-title', 'data-action': 'detail', 'data-focus-key': `title:${task.id}` }, task.title),
        renderTaskMeta(task)
      ),
      h('td', { class: 'cell-assignee', 'data-label': '担当者' }, renderAssignee(task.assignee)),
      h('td', { class: 'cell-due', 'data-label': '期限' }, renderDue(task, ds)),
      h('td', { class: 'cell-priority', 'data-label': '優先度' }, priorityBadge(task.priority)),
      h('td', { class: 'cell-status', 'data-label': '状態' }, statusSelect(task, `status:${task.id}`)),
      h(
        'td',
        { class: 'cell-actions' },
        h(
          'div',
          { class: 'row-actions' },
          myDayButton(task, `myday:${task.id}`),
          h('button', { type: 'button', class: 'icon-btn', 'data-action': 'detail', 'data-focus-key': `detail:${task.id}`, 'aria-label': `「${task.title}」の詳細を表示`, title: '詳細' }, icon('eye')),
          h('button', { type: 'button', class: 'icon-btn', 'data-action': 'edit', 'data-focus-key': `edit:${task.id}`, 'aria-label': `「${task.title}」を編集`, title: '編集' }, icon('edit')),
          h('button', { type: 'button', class: 'icon-btn icon-btn-danger', 'data-action': 'delete', 'data-focus-key': `delete:${task.id}`, 'aria-label': `「${task.title}」を削除`, title: '削除' }, icon('trash'))
        )
      )
    );
  }

  function myDayButton(task, focusKey) {
    const on = isMyDay(task);
    return h(
      'button',
      {
        type: 'button',
        class: `icon-btn myday-btn${on ? ' is-on' : ''}`,
        'data-action': 'myday',
        'data-focus-key': focusKey,
        'aria-pressed': String(on),
        'aria-label': `「${task.title}」を今日やる`,
        title: on ? '「今日やる」から外す' : '「今日やる」に追加',
      },
      icon('sun')
    );
  }

  function formatHours(value) {
    if (value === null || value === undefined) return '';
    return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}h`;
  }

  /** 先行タスクが未完了なら、その先行タスクを返す */
  function blockingTask(task) {
    if (!task.dependsOn || task.status === 'done') return null;
    const pre = findTask(task.dependsOn);
    return pre && pre.status !== 'done' ? pre : null;
  }

  function renderTags(tags) {
    return tags.length ? h('span', { class: 'tag-list' }, tags.map((t) => h('span', { class: 'tag' }, icon('tag'), t))) : null;
  }

  /** 案件名・タグ・繰り返し・待ち・チェックリストの進捗・時間・メモ件数 */
  function renderTaskMeta(task) {
    const { total, done } = checklistProgress(task);
    const blocker = blockingTask(task);
    const items = [
      task.project ? h('span', { class: 'meta-item' }, icon('folder'), task.project) : null,
      isMyDay(task) ? h('span', { class: 'meta-item meta-myday' }, icon('sun'), '今日やる') : null,
      blocker ? h('span', { class: 'meta-item meta-blocked', title: `先行タスク「${blocker.title}」の完了待ち` }, icon('hourglass'), `待ち：${excerpt(blocker.title, 16)}`) : null,
      task.recurrence !== 'none'
        ? h('span', { class: 'meta-item', title: '繰り返し' }, icon('repeat'), RECURRENCE_LABEL[task.recurrence])
        : null,
      total
        ? h(
            'span',
            { class: `meta-item${done === total ? ' is-complete' : ''}`, title: 'チェックリストの進捗' },
            icon('checklist'),
            h('span', { class: 'visually-hidden' }, 'チェックリスト '),
            `${done}/${total}`
          )
        : null,
      task.memos.length
        ? h('span', { class: 'meta-item', title: 'メモの件数' }, icon('note'), h('span', { class: 'visually-hidden' }, 'メモ '), `${task.memos.length}`)
        : null,
      task.estimateHours !== null || task.actualHours > 0
        ? h(
            'span',
            { class: `meta-item${task.estimateHours !== null && task.actualHours > task.estimateHours ? ' meta-over' : ''}`, title: '実績時間／予定時間' },
            icon('clock'),
            `${formatHours(task.actualHours || 0)}${task.estimateHours !== null ? ` / ${formatHours(task.estimateHours)}` : ''}`
          )
        : null,
      renderTags(task.tags),
    ].filter(Boolean);
    return items.length ? h('div', { class: 'task-meta' }, items) : null;
  }

  // ----- 一括操作バー -----
  function renderBulkBar() {
    const count = state.selected.size;
    if (!count) return null;
    const option = (value, label) => h('option', { value }, label);
    return h(
      'div',
      { class: 'bulk-bar', role: 'region', 'aria-label': '選択したタスクの一括操作' },
      h('p', { class: 'bulk-count' }, h('strong', null, String(count)), '件を選択中'),
      h(
        'div',
        { class: 'bulk-actions' },
        h(
          'select',
          { class: 'select select-sm', 'data-bulk': 'status', 'data-focus-key': 'bulk-status', 'aria-label': '選択したタスクの状態をまとめて変更' },
          option('', '状態を変更…'),
          STATUSES.map((s) => option(s.value, s.label))
        ),
        h(
          'select',
          { class: 'select select-sm', 'data-bulk': 'priority', 'data-focus-key': 'bulk-priority', 'aria-label': '選択したタスクの優先度をまとめて変更' },
          option('', '優先度を変更…'),
          PRIORITIES.map((p) => option(p.value, `優先度 ${p.label}`))
        ),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-bulk': 'myday', 'data-focus-key': 'bulk-myday' }, icon('sun'), '今日やるに追加'),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger-outline', 'data-bulk': 'delete', 'data-focus-key': 'bulk-delete' }, icon('trash'), '削除'),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'data-bulk': 'clear', 'data-focus-key': 'bulk-clear' }, '選択を解除')
      )
    );
  }

  // ----- ガントチャート（タイムライン） -----
  function ganttStart() {
    return state.ganttStart || addDays(state.today, -GANTT_LEAD_DAYS);
  }

  function renderGantt(tasks) {
    const start = ganttStart();
    const end = addDays(start, GANTT_DAYS - 1);
    const days = Array.from({ length: GANTT_DAYS }, (_, i) => addDays(start, i));
    const rows = tasks.length;
    const cells = [h('div', { class: 'gantt-corner', style: 'grid-row:1;grid-column:1' }, 'タスク')];

    days.forEach((key, i) => {
      const { m, d } = parseDateKey(key);
      const col = i + 2;
      const classes = ['gantt-day'];
      if (isWeekend(key)) classes.push('is-weekend');
      if (key === state.today) classes.push('is-today');
      cells.push(
        h(
          'div',
          { class: classes.join(' '), style: `grid-row:1;grid-column:${col}` },
          h('span', { class: 'gantt-day-num' }, d === 1 || i === 0 ? `${m}/${d}` : String(d)),
          h('span', { class: 'gantt-day-wd' }, WEEKDAY[weekdayOf(key)])
        )
      );
      if (isWeekend(key)) cells.push(h('div', { class: 'gantt-shade', style: `grid-row:2 / span ${rows};grid-column:${col}`, 'aria-hidden': 'true' }));
      if (key === state.today) cells.push(h('div', { class: 'gantt-today-line', style: `grid-row:2 / span ${rows};grid-column:${col}`, 'aria-hidden': 'true' }));
    });

    tasks.forEach((task, index) => {
      const row = index + 2;
      const ds = deadlineState(task);
      const from = task.startDate || task.due;
      cells.push(h('div', { class: 'gantt-rowline', style: `grid-row:${row};grid-column:1 / -1`, 'aria-hidden': 'true' }));
      cells.push(
        h(
          'div',
          { class: 'gantt-label', style: `grid-row:${row};grid-column:1`, 'data-task-id': task.id },
          h('button', { type: 'button', class: 'task-title', 'data-action': 'detail', 'data-focus-key': `title:${task.id}` }, task.title),
          h('span', { class: 'gantt-label-sub' }, task.assignee)
        )
      );
      const range = from === task.due ? formatDate(task.due) : `${formatDate(from)}〜${formatDate(task.due)}`;
      if (task.due < start || from > end) {
        const before = task.due < start;
        cells.push(
          h(
            'p',
            { class: `gantt-out${before ? '' : ' is-after'}`, style: `grid-row:${row};grid-column:2 / -1` },
            before ? `← 期限 ${shortDate(task.due)}（表示範囲より前）` : `開始 ${shortDate(from)}（表示範囲より後） →`
          )
        );
        return;
      }
      const startCol = Math.max(0, daysBetween(start, from)) + 2;
      const endCol = Math.min(GANTT_DAYS - 1, daysBetween(start, task.due)) + 3;
      const classes = [`gantt-bar`, `bar-${task.status}`, `is-${ds}`];
      if (from < start) classes.push('is-clipped-start');
      if (task.due > end) classes.push('is-clipped-end');
      if (from === task.due) classes.push('is-single');
      cells.push(
        h(
          'button',
          {
            type: 'button',
            class: classes.join(' '),
            style: `grid-row:${row};grid-column:${startCol} / ${endCol}`,
            'data-action': 'detail',
            'data-task-id': task.id,
            'data-focus-key': `bar:${task.id}`,
            'aria-label': `${task.title}：${range}（${STATUS_LABEL[task.status]}${ds === 'overdue' ? '・期限切れ' : ''}）`,
            title: `${task.title}\n${range}`,
          },
          h('span', { class: 'gantt-bar-text' }, task.title)
        )
      );
    });

    return h(
      'div',
      { class: 'gantt' },
      h(
        'div',
        { class: 'view-toolbar' },
        h(
          'div',
          { class: 'view-nav' },
          h('button', { type: 'button', class: 'btn btn-sm', 'data-nav': 'gantt-prev', 'data-focus-key': 'gantt-prev' }, icon('chevronLeft'), '前の週'),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-nav': 'gantt-today', 'data-focus-key': 'gantt-today' }, '今日'),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-nav': 'gantt-next', 'data-focus-key': 'gantt-next' }, '次の週', icon('chevronRight'))
        ),
        h('p', { class: 'view-range' }, `${formatDate(start)} 〜 ${formatDate(end)}`),
        h('p', { class: 'hint' }, '開始日を入れたタスクは、開始日から期限までを横棒で表示します。')
      ),
      h(
        'div',
        { class: 'gantt-scroll' },
        h('div', { class: 'gantt-grid', style: `--gantt-days:${GANTT_DAYS};--gantt-rows:${rows}` }, cells)
      )
    );
  }

  // ----- カレンダー（月表示。期限の日にタスクを表示） -----
  function calendarMonth() {
    return state.calendarMonth || state.today.slice(0, 7);
  }

  function renderCalendar(tasks) {
    const month = calendarMonth();
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`;
    const offset = weekdayOf(first); // 日曜始まり
    const gridStart = addDays(first, -offset);
    const daysInMonth = new Date(y, m, 0).getDate();
    const weeks = Math.ceil((offset + daysInMonth) / 7);
    const byDate = new Map();
    for (const task of tasks) {
      if (!byDate.has(task.due)) byDate.set(task.due, []);
      byDate.get(task.due).push(task);
    }
    const inMonthCount = tasks.filter((t) => t.due.startsWith(month)).length;

    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const key = addDays(gridStart, i);
      const { d } = parseDateKey(key);
      const list = byDate.get(key) || [];
      const wd = weekdayOf(key);
      const classes = ['cal-cell'];
      if (!key.startsWith(month)) classes.push('is-out');
      if (key === state.today) classes.push('is-today');
      if (wd === 0) classes.push('is-sun');
      if (wd === 6) classes.push('is-sat');
      if (!list.length) classes.push('is-empty');
      cells.push(
        h(
          'div',
          { class: classes.join(' '), role: 'listitem', 'aria-label': `${formatDate(key)}（${list.length}件）` },
          h('p', { class: 'cal-date' }, h('span', { class: 'cal-day' }, String(d)), h('span', { class: 'cal-wd' }, WEEKDAY[wd]), key === state.today ? h('span', { class: 'cal-today' }, '今日') : null),
          list.length
            ? h(
                'ul',
                { class: 'cal-tasks' },
                list.map((task) => {
                  const ds = deadlineState(task);
                  return h(
                    'li',
                    null,
                    h(
                      'button',
                      {
                        type: 'button',
                        class: `cal-task is-${ds} st-${task.status}`,
                        'data-action': 'detail',
                        'data-task-id': task.id,
                        'data-focus-key': `cal:${task.id}`,
                        'aria-label': `${task.title}（${STATUS_LABEL[task.status]}${ds === 'overdue' ? '・期限切れ' : ''}）`,
                        title: `${task.title}（${STATUS_LABEL[task.status]}）`,
                      },
                      h('span', { class: 'cal-dot', 'aria-hidden': 'true' }),
                      h('span', { class: 'cal-task-text' }, task.title)
                    )
                  );
                })
              )
            : null
        )
      );
    }

    return h(
      'div',
      { class: 'calendar' },
      h(
        'div',
        { class: 'view-toolbar' },
        h(
          'div',
          { class: 'view-nav' },
          h('button', { type: 'button', class: 'btn btn-sm', 'data-nav': 'cal-prev', 'data-focus-key': 'cal-prev' }, icon('chevronLeft'), '前の月'),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-nav': 'cal-today', 'data-focus-key': 'cal-today' }, '今月'),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-nav': 'cal-next', 'data-focus-key': 'cal-next' }, '次の月', icon('chevronRight'))
        ),
        h('p', { class: 'view-range' }, `${y}年${m}月`),
        h('p', { class: 'hint' }, `この月に期限があるタスク：${inMonthCount}件（絞り込み条件を反映）`)
      ),
      h(
        'div',
        { class: 'cal-grid' },
        WEEKDAY.map((w, i) => h('div', { class: `cal-head${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}`, 'aria-hidden': 'true' }, w)),
        h('div', { class: 'cal-body', role: 'list', 'aria-label': `${y}年${m}月のカレンダー` }, cells)
      )
    );
  }

  function navigateView(action) {
    if (action === 'gantt-prev') state.ganttStart = addDays(ganttStart(), -7);
    else if (action === 'gantt-next') state.ganttStart = addDays(ganttStart(), 7);
    else if (action === 'gantt-today') state.ganttStart = '';
    else if (action === 'cal-prev') state.calendarMonth = addMonths(`${calendarMonth()}-01`, -1).slice(0, 7);
    else if (action === 'cal-next') state.calendarMonth = addMonths(`${calendarMonth()}-01`, 1).slice(0, 7);
    else if (action === 'cal-today') state.calendarMonth = '';
    renderList();
  }

  // ----- ボード（カンバン）表示 -----
  function renderBoard(tasks) {
    return h(
      'div',
      { class: 'board' },
      h('p', { class: 'board-hint' }, 'カードをドラッグして別の列に移すと状態が変わります（各カードのプルダウンでも変更できます）。'),
      h(
        'div',
        { class: 'board-cols' },
        STATUSES.map((s) => {
          const items = tasks.filter((t) => t.status === s.value);
          return h(
            'section',
            { class: `board-col board-col-${s.value}`, 'data-drop-status': s.value, 'aria-label': `${s.label}（${items.length}件）` },
            h('header', { class: 'board-col-head' }, statusBadge(s.value), h('span', { class: 'board-count' }, `${items.length}件`)),
            h('div', { class: 'board-cards' }, items.length ? items.map(renderCard) : h('p', { class: 'board-empty' }, '該当するタスクはありません'))
          );
        })
      )
    );
  }

  function renderCard(task) {
    const ds = deadlineState(task);
    return h(
      'article',
      { class: `board-card is-${ds}`, 'data-task-id': task.id, draggable: 'true' },
      h('button', { type: 'button', class: 'task-title', 'data-action': 'detail', 'data-focus-key': `title:${task.id}` }, task.title),
      renderTaskMeta(task),
      h('div', { class: 'card-due' }, renderDue(task, ds)),
      h('div', { class: 'card-foot' }, renderAssignee(task.assignee), priorityBadge(task.priority)),
      h('div', { class: 'card-status' }, statusSelect(task, `status:${task.id}`))
    );
  }

  function renderAssignee(name) {
    return h('span', { class: 'assignee' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, Array.from(name)[0] || ''), name);
  }

  function renderDue(task, ds) {
    const diff = daysBetween(state.today, task.due);
    let flags = null;
    if (ds === 'overdue') {
      flags = h('div', { class: 'due-flags' }, h('span', { class: 'badge badge-overdue' }, '期限切れ'), h('span', { class: 'due-note' }, `${-diff}日超過`));
    } else if (ds === 'today') {
      flags = h('div', { class: 'due-flags' }, h('span', { class: 'badge badge-today' }, '本日期限'));
    } else if (ds === 'upcoming' && diff <= SOON_DAYS) {
      flags = h('div', { class: 'due-flags' }, h('span', { class: 'due-note' }, `あと${diff}日`));
    }
    return [h('div', { class: 'due-date' }, formatDate(task.due)), flags];
  }

  function statusBadge(status) {
    return h('span', { class: `badge badge-status-${status}` }, STATUS_LABEL[status]);
  }

  function priorityBadge(priority) {
    return h('span', { class: `badge badge-priority-${priority}` }, `優先度 ${PRIORITY_LABEL[priority]}`);
  }

  function deadlineBadge(ds) {
    if (ds === 'overdue') return h('span', { class: 'badge badge-overdue' }, '期限切れ');
    if (ds === 'today') return h('span', { class: 'badge badge-today' }, '本日期限');
    return null;
  }

  function statusSelect(task, focusKey, id) {
    return h(
      'select',
      {
        id,
        class: 'status-select',
        'data-action': 'status',
        'data-task-id': task.id,
        'data-status': task.status,
        'data-focus-key': focusKey,
        'aria-label': `「${task.title}」の状態`,
      },
      STATUSES.map((s) => h('option', { value: s.value, selected: s.value === task.status }, s.label))
    );
  }

  // ==========================================================
  // 7. 詳細パネル
  // ==========================================================
  function openDetail(taskId) {
    if (!findTask(taskId)) return;
    state.detailTaskId = taskId;
    dom.detailContent.replaceChildren();
    renderDetail();
    openDialog(dom.detailDialog, dom.detailClose);
    dom.detailContent.scrollTop = 0;
  }

  function renderDetail() {
    if (!state.detailTaskId) return;
    const task = findTask(state.detailTaskId);
    if (!task) {
      closeDialog(dom.detailDialog);
      return;
    }
    const content = dom.detailContent;
    // 書きかけのメモ・チェック項目は再描画しても残す
    const draftOf = (selector) => {
      const input = $(selector, content);
      return input && input.dataset.taskId === task.id ? input.value : '';
    };
    const drafts = { memo: draftOf('#memo-input'), checklist: draftOf('#checklist-input') };
    const focusKey = document.activeElement && content.contains(document.activeElement)
      ? document.activeElement.dataset.focusKey
      : null;
    const scrollTop = content.scrollTop;

    dom.detailTitle.textContent = task.title;
    content.replaceChildren(...buildDetail(task, drafts));
    content.scrollTop = scrollTop;

    if (focusKey) {
      const target =
        content.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`) ||
        (focusKey.startsWith('check') ? $('#checklist-input', content) : null); // 削除した項目の代わり
      if (target) target.focus();
    }
  }

  function buildDetail(task, drafts) {
    const ds = deadlineState(task);
    const diff = daysBetween(state.today, task.due);
    const dueNote =
      ds === 'overdue' ? `（${-diff}日超過）` : ds === 'upcoming' && diff <= SOON_DAYS ? `（あと${diff}日）` : '';

    const blocker = blockingTask(task);
    const badges = h(
      'div',
      { class: 'detail-badges' },
      statusBadge(task.status),
      priorityBadge(task.priority),
      deadlineBadge(ds),
      isMyDay(task) ? h('span', { class: 'badge badge-myday' }, '今日やる') : null,
      blocker ? h('span', { class: 'badge badge-blocked' }, '先行タスク待ち') : null
    );

    const myDayOn = isMyDay(task);
    const actions = h(
      'div',
      { class: 'detail-actions' },
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'field-label', for: 'detail-status' }, '状態を変更'),
        statusSelect(task, 'detail-status', 'detail-status')
      ),
      h(
        'div',
        { class: 'detail-actions-buttons' },
        h(
          'button',
          { type: 'button', class: `btn btn-sm${myDayOn ? ' is-on' : ''}`, 'data-detail-action': 'myday', 'data-focus-key': 'detail-myday', 'aria-pressed': String(myDayOn) },
          icon('sun'),
          myDayOn ? '今日やる（解除）' : '今日やる'
        ),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-detail-action': 'edit', 'data-focus-key': 'detail-edit' }, icon('edit'), '編集'),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-detail-action': 'duplicate', 'data-focus-key': 'detail-duplicate' }, icon('copy'), '複製'),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-detail-action': 'template', 'data-focus-key': 'detail-template' }, icon('layers'), 'テンプレートに保存'),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-detail-action': 'share', 'data-focus-key': 'detail-share' }, icon('share'), '共有'),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger-outline', 'data-detail-action': 'delete', 'data-focus-key': 'detail-delete' }, icon('trash'), '削除')
      )
    );

    const item = (label, value, wide) => h('div', { class: wide ? 'is-wide' : null }, h('dt', null, label), h('dd', null, value));
    const taskLink = (t) =>
      h('button', { type: 'button', class: 'link-btn', 'data-detail-open': t.id }, t.title, h('span', { class: 'link-sub' }, `（${STATUS_LABEL[t.status]}）`));
    const pre = task.dependsOn ? findTask(task.dependsOn) : null;
    const followers = state.data.tasks.filter((t) => t.dependsOn === task.id);
    const grid = h(
      'dl',
      { class: 'detail-grid' },
      item('案件名', task.project || '（なし）'),
      item('担当者', renderAssignee(task.assignee)),
      item('開始日', task.startDate ? formatDate(task.startDate) : '（なし）'),
      item('期限', `${formatDate(task.due)}${dueNote}`),
      item('優先度', PRIORITY_LABEL[task.priority]),
      item('繰り返し', RECURRENCE_LABEL[task.recurrence]),
      item('タグ', renderTags(task.tags) || '（なし）', true),
      item('先行タスク', pre ? taskLink(pre) : '（なし）', true),
      followers.length ? item('このタスクを待っているタスク', h('span', { class: 'link-list' }, followers.map(taskLink)), true) : null,
      item('作成日時', formatDateTime(task.createdAt)),
      item('最終更新日時', formatDateTime(task.updatedAt))
    );

    const description = h(
      'section',
      { class: 'detail-section', 'aria-labelledby': 'detail-desc-heading' },
      h('h3', { class: 'section-title', id: 'detail-desc-heading' }, icon('text'), '詳細説明'),
      task.description
        ? h('p', { class: 'description-text' }, task.description)
        : h('p', { class: 'muted-text' }, '詳細説明は登録されていません。')
    );

    return [
      badges,
      actions,
      grid,
      buildTimeSection(task),
      description,
      buildChecklistSection(task, drafts.checklist),
      buildMemoSection(task, drafts.memo),
      buildHistorySection(task),
    ];
  }

  /** タイムトラッキング：予定時間と実績時間。ボタンで実績を足していく */
  function buildTimeSection(task) {
    const actual = task.actualHours || 0;
    const estimate = task.estimateHours;
    const percent = estimate ? Math.min(100, Math.round((actual / estimate) * 100)) : 0;
    const over = estimate !== null && actual > estimate;
    const quick = [
      [0.25, '＋15分'],
      [0.5, '＋30分'],
      [1, '＋1時間'],
    ];
    return h(
      'section',
      { class: 'detail-section', 'aria-labelledby': 'detail-time-heading' },
      h('h3', { class: 'section-title', id: 'detail-time-heading' }, icon('clock'), '作業時間'),
      h(
        'div',
        { class: 'time-box' },
        h(
          'p',
          { class: 'time-figures' },
          h('span', { class: 'time-actual' }, formatHours(actual)),
          h('span', { class: 'time-sep' }, '／'),
          h('span', { class: 'time-estimate' }, estimate === null ? '予定なし' : `予定 ${formatHours(estimate)}`),
          over ? h('span', { class: 'badge badge-overdue' }, `予定を ${formatHours(Math.round((actual - estimate) * 100) / 100)} 超過`) : null
        ),
        estimate
          ? h(
              'div',
              { class: `progress${over ? ' is-over' : ''}`, role: 'progressbar', 'aria-label': '予定時間に対する実績', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent },
              h('span', { class: 'progress-bar', style: `width:${percent}%` })
            )
          : null,
        h(
          'div',
          { class: 'time-quick' },
          h('span', { class: 'hint' }, '実績に記録：'),
          quick.map(([hours, label]) =>
            h('button', { type: 'button', class: 'btn btn-sm', 'data-time-add': String(hours), 'data-focus-key': `time-${hours}` }, label)
          )
        )
      )
    );
  }

  function buildChecklistSection(task, draft) {
    const { total, done } = checklistProgress(task);
    const percent = total ? Math.round((done / total) * 100) : 0;

    const input = h('input', {
      type: 'text',
      id: 'checklist-input',
      class: 'input',
      maxlength: MAX_LENGTH.checklist,
      placeholder: '例：事前確認／作業／事後確認',
      autocomplete: 'off',
      'aria-describedby': 'checklist-error',
      'data-task-id': task.id,
      'data-focus-key': 'checklist-input',
    });
    input.value = draft;
    const errorEl = h('p', { class: 'field-error', id: 'checklist-error', hidden: true });
    const form = h(
      'form',
      { class: 'checklist-form', novalidate: true },
      h('label', { class: 'visually-hidden', for: 'checklist-input' }, 'チェックリストに項目を追加'),
      input,
      h('button', { type: 'submit', class: 'btn btn-sm', 'data-focus-key': 'checklist-submit' }, icon('plus'), '追加')
    );
    input.addEventListener('input', () => {
      errorEl.hidden = true;
      input.removeAttribute('aria-invalid');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) {
        errorEl.textContent = 'チェック項目を入力してください';
        errorEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      if (addChecklistItem(task.id, text)) {
        const current = $('#checklist-input', dom.detailContent);
        if (current) {
          current.value = '';
          current.focus();
        }
      }
    });

    const items = task.checklist.map((item) => {
      const checkbox = h('input', { type: 'checkbox', checked: item.done, 'data-focus-key': `check:${item.id}` });
      checkbox.addEventListener('change', () => {
        if (!toggleChecklistItem(task.id, item.id, checkbox.checked)) renderDetail();
      });
      return h(
        'li',
        { class: `checklist-item${item.done ? ' is-done' : ''}` },
        h('label', { class: 'check' }, checkbox, h('span', { class: 'check-text' }, item.text)),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn icon-btn-danger',
            'aria-label': `「${item.text}」を削除`,
            title: '項目を削除',
            'data-focus-key': `check-remove:${item.id}`,
            onclick: () => removeChecklistItem(task.id, item.id),
          },
          icon('x')
        )
      );
    });

    return h(
      'section',
      { class: 'detail-section', 'aria-labelledby': 'detail-checklist-heading' },
      h(
        'h3',
        { class: 'section-title', id: 'detail-checklist-heading' },
        icon('checklist'),
        'チェックリスト',
        h('span', { class: 'section-count' }, total ? `${done}/${total} 完了` : '')
      ),
      total
        ? h(
            'div',
            {
              class: `progress${done === total ? ' is-complete' : ''}`,
              role: 'progressbar',
              'aria-label': 'チェックリストの進捗',
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': percent,
            },
            h('span', { class: 'progress-bar', style: `width:${percent}%` })
          )
        : null,
      items.length ? h('ul', { class: 'checklist' }, items) : h('p', { class: 'muted-text' }, '作業の手順や確認項目を登録できます。'),
      form,
      errorEl,
      state.ai
        ? h(
            'div',
            { class: 'ai-inline' },
            h('button', { type: 'button', class: 'btn btn-sm btn-ai', 'data-ai-checklist': task.id, 'data-focus-key': 'ai-checklist' }, icon('sparkle'), 'Claude で手順を提案'),
            h('span', { class: 'hint', id: 'ai-checklist-status', role: 'status' })
          )
        : null
    );
  }

  function buildMemoSection(task, draft) {
    const textarea = h('textarea', {
      id: 'memo-input',
      class: 'textarea',
      rows: 3,
      maxlength: MAX_LENGTH.memo,
      placeholder: '対応内容や連絡事項を記録します',
      'aria-describedby': 'memo-error memo-hint',
      'data-task-id': task.id,
      'data-focus-key': 'memo-input',
    });
    textarea.value = draft;
    const errorEl = h('p', { class: 'field-error', id: 'memo-error', hidden: true });

    const form = h(
      'form',
      { class: 'memo-form field', novalidate: true },
      h('label', { class: 'field-label', for: 'memo-input' }, 'メモを追加'),
      textarea,
      errorEl,
      h(
        'div',
        { class: 'memo-form-foot' },
        h('span', { class: 'hint', id: 'memo-hint' }, 'Ctrl + Enter でも追加できます'),
        h('button', { type: 'submit', class: 'btn btn-primary btn-sm', 'data-focus-key': 'memo-submit' }, icon('plus'), 'メモを追加')
      )
    );
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    textarea.addEventListener('input', () => {
      errorEl.hidden = true;
      textarea.removeAttribute('aria-invalid');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = textarea.value.trim();
      if (!text) {
        errorEl.textContent = 'メモを入力してください';
        errorEl.hidden = false;
        textarea.setAttribute('aria-invalid', 'true');
        textarea.focus();
        return;
      }
      if (addMemo(task.id, text)) {
        const input = $('#memo-input', dom.detailContent);
        if (input) {
          input.value = '';
          input.focus();
        }
      }
    });

    const memos = task.memos.slice().sort((a, b) => time(b.createdAt) - time(a.createdAt));
    return h(
      'section',
      { class: 'detail-section', 'aria-labelledby': 'detail-memo-heading' },
      h('h3', { class: 'section-title', id: 'detail-memo-heading' }, icon('note'), 'メモ', h('span', { class: 'section-count' }, `${memos.length}件`)),
      form,
      memos.length
        ? h(
            'ul',
            { class: 'memo-list', 'aria-label': 'メモ一覧（新しい順）' },
            memos.map((m) =>
              h('li', { class: 'memo-item' }, h('time', { class: 'memo-time', datetime: m.createdAt }, formatDateTime(m.createdAt)), h('p', { class: 'memo-text' }, m.text))
            )
          )
        : h('p', { class: 'muted-text' }, 'まだメモはありません。')
    );
  }

  function buildHistorySection(task) {
    const entries = task.history.slice().sort((a, b) => time(b.at) - time(a.at));
    return h(
      'section',
      { class: 'detail-section', 'aria-labelledby': 'detail-history-heading' },
      h('h3', { class: 'section-title', id: 'detail-history-heading' }, icon('history'), '対応履歴', h('span', { class: 'section-count' }, '新しい順')),
      entries.length
        ? h('ol', { class: 'timeline' }, entries.map(renderHistoryItem))
        : h('p', { class: 'muted-text' }, '履歴はありません。')
    );
  }

  function renderHistoryItem(entry) {
    let body = null;
    if (entry.type === 'status' && entry.changes[0]) {
      body = h('p', { class: 'timeline-body' }, renderChange(entry.changes[0]));
    } else if (entry.type === 'edit') {
      body = h(
        'ul',
        { class: 'timeline-body change-list' },
        entry.changes.map((c) => h('li', null, `${c.label}：`, renderChange(c)))
      );
    } else if (entry.type === 'memo' && entry.text) {
      body = h('p', { class: 'timeline-body' }, `「${entry.text}」`);
    } else if ((entry.type === 'checklist' || entry.type === 'create') && entry.text) {
      body = h('p', { class: 'timeline-body' }, entry.text);
    }
    return h(
      'li',
      { class: 'timeline-item', 'data-type': entry.type },
      h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
      h(
        'div',
        null,
        h(
          'p',
          { class: 'timeline-head' },
          h('span', { class: 'timeline-type' }, HISTORY_LABEL[entry.type]),
          h('time', { class: 'timeline-time', datetime: entry.at }, formatDateTime(entry.at))
        ),
        body
      )
    );
  }

  function renderChange(change) {
    return h(
      'span',
      null,
      h('span', { class: 'change-from' }, change.from),
      h('span', { class: 'change-arrow' }, '→'),
      h('span', { class: 'change-to' }, change.to)
    );
  }

  // ==========================================================
  // 8. ダイアログ
  // ==========================================================
  // 閉じる処理はすべて closeDialog() を通し、後始末（フォーカスを戻す等）を同期的に行う。
  // ブラウザが自分で閉じた場合に備え、close イベントでも同じ後始末を呼ぶ（2回目は何もしない）。
  const dialogStack = [];
  const returnFocus = new Map();
  const onClosedHandlers = new Map();

  function openDialog(dialog, focusTarget) {
    if (!dialog.open) {
      const active = document.activeElement;
      returnFocus.set(dialog, { el: active, key: active && active.dataset ? active.dataset.focusKey : null });
      dialog.returnValue = ''; // 前回の結果（'ok' など）を持ち越さない
      dialog.showModal();
      dialogStack.push(dialog);
      dialog.append(dom.toasts); // 通知をダイアログより前面に出す
    }
    if (focusTarget) focusTarget.focus();
  }

  function closeDialog(dialog, returnValue = '') {
    if (dialog.open) dialog.close(returnValue);
    handleDialogClosed(dialog);
  }

  function handleDialogClosed(dialog) {
    const index = dialogStack.indexOf(dialog);
    if (index < 0) return; // 後始末済み
    dialogStack.splice(index, 1);
    const parent = dialogStack[dialogStack.length - 1] || document.body;
    if (dom.toasts.parentElement === dialog) parent.append(dom.toasts);
    restoreFocus(dialog);
    const onClosed = onClosedHandlers.get(dialog);
    if (onClosed) onClosed(dialog.returnValue);
  }

  function setupDialog(dialog, { onRequestClose, onClosed } = {}) {
    const requestClose = onRequestClose || (() => closeDialog(dialog));
    if (onClosed) onClosedHandlers.set(dialog, onClosed);
    // Escape キー
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      requestClose();
    });
    // 背景（ダイアログの外側）のクリック
    let pressedOnBackdrop = false;
    dialog.addEventListener('mousedown', (e) => {
      pressedOnBackdrop = e.target === dialog;
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog && pressedOnBackdrop) requestClose();
      pressedOnBackdrop = false;
    });
    // close イベントは遅れて届くため、開き直した後に届いた古いイベントは無視する
    dialog.addEventListener('close', () => {
      if (!dialog.open) handleDialogClosed(dialog);
    });
  }

  function restoreFocus(dialog) {
    const saved = returnFocus.get(dialog);
    returnFocus.delete(dialog);
    let target = saved && saved.el && saved.el.isConnected ? saved.el : null;
    if (!target && saved && saved.key) {
      target = document.querySelector(`[data-focus-key="${CSS.escape(saved.key)}"]`);
    }
    if (target && target !== document.body) target.focus();
    else dom.listSection.focus();
  }

  // ----- 登録・編集フォーム -----
  function readForm() {
    const f = dom.taskForm.elements;
    const hours = (value, emptyValue) => (value.trim() === '' ? emptyValue : Number(value));
    return {
      title: f.title.value.trim(),
      project: f.project.value.trim(),
      assignee: f.assignee.value.trim(),
      startDate: f.startDate.value,
      due: f.due.value,
      status: f.status.value,
      priority: f.priority.value,
      recurrence: f.recurrence.value,
      dependsOn: f.dependsOn.value,
      estimateHours: hours(f.estimateHours.value, null),
      actualHours: hours(f.actualHours.value, 0),
      tags: parseTagInput(f.tags.value),
      description: f.description.value.trim(),
    };
  }

  function validateTaskValues(values) {
    const errors = {};
    if (!values.title) errors.title = 'タスク名を入力してください';
    else if (values.title.length > MAX_LENGTH.title) errors.title = `タスク名は${MAX_LENGTH.title}文字以内で入力してください`;
    if (values.project.length > MAX_LENGTH.project) errors.project = `案件名は${MAX_LENGTH.project}文字以内で入力してください`;
    if (!values.assignee) errors.assignee = '担当者を入力してください';
    else if (values.assignee.length > MAX_LENGTH.assignee) errors.assignee = `担当者は${MAX_LENGTH.assignee}文字以内で入力してください`;
    if (!values.due) errors.due = '期限を選択してください';
    else if (!isValidDateKey(values.due)) errors.due = '期限の日付が正しくありません';
    if (values.startDate && !isValidDateKey(values.startDate)) errors.startDate = '開始日の日付が正しくありません';
    else if (values.startDate && values.due && values.startDate > values.due) {
      errors.startDate = '開始日は期限と同じか、それより前の日付にしてください';
    }
    if (!STATUS_LABEL[values.status]) errors.status = '状態を選択してください';
    if (!PRIORITY_LABEL[values.priority]) errors.priority = '優先度を選択してください';
    if (!RECURRENCE_LABEL[values.recurrence]) errors.recurrence = '繰り返しを選択してください';
    for (const key of ['estimateHours', 'actualHours']) {
      if (!isValidHours(values[key])) errors[key] = `0〜${MAX_HOURS} の数値（時間）で入力してください`;
    }
    if (values.tags.length > MAX_TAGS) errors.tags = `タグは${MAX_TAGS}個までにしてください`;
    else if (values.tags.some((t) => t.length > MAX_LENGTH.tag)) errors.tags = `タグは1つ${MAX_LENGTH.tag}文字以内で入力してください`;
    if (values.description.length > MAX_LENGTH.description) {
      errors.description = `詳細説明は${MAX_LENGTH.description}文字以内で入力してください`;
    }
    return errors;
  }

  function fieldControl(field) {
    const el = dom.taskForm.elements[field];
    return el instanceof RadioNodeList ? el[0] : el;
  }

  function setFieldError(field, message) {
    const wrapper = dom.taskForm.querySelector(`[data-field="${field}"]`);
    const errorEl = $(`#err-${field}`);
    const control = fieldControl(field);
    wrapper.classList.toggle('has-error', Boolean(message));
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
    if (control) {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }

  function clearFieldErrors() {
    FIELDS.forEach((field) => setFieldError(field, ''));
  }

  function refreshDatalists() {
    dom.projectOptions.replaceChildren(...uniqueValues('project').map((v) => h('option', { value: v })));
    dom.assigneeOptions.replaceChildren(...uniqueValues('assignee').map((v) => h('option', { value: v })));
  }

  /** candidateId を先行タスクにすると、先行タスクの連鎖が自分に戻ってくるか */
  function wouldCreateCycle(candidateId, selfId) {
    const seen = new Set();
    let current = candidateId;
    while (current && !seen.has(current)) {
      if (current === selfId) return true;
      seen.add(current);
      const t = findTask(current);
      current = t ? t.dependsOn : '';
    }
    return false;
  }

  function fillDependsOnOptions(selfId, currentId) {
    const candidates = state.data.tasks
      .filter((t) => t.id !== selfId && (t.status !== 'done' || t.id === currentId) && !(selfId && wouldCreateCycle(t.id, selfId)))
      .sort((a, b) => COMPARE.due(a, b));
    const select = dom.taskForm.elements.dependsOn;
    select.replaceChildren(
      h('option', { value: '' }, '（なし）'),
      ...candidates.map((t) => h('option', { value: t.id }, `${excerpt(t.title, 40)}（期限 ${shortDate(t.due)}・${STATUS_LABEL[t.status]}）`))
    );
    select.value = currentId && candidates.some((t) => t.id === currentId) ? currentId : '';
  }

  function fillTemplateOptions(show) {
    const templates = state.data.templates;
    dom.templateField.hidden = !show || !templates.length;
    dom.templateSelect.replaceChildren(
      h('option', { value: '' }, '使わない'),
      ...templates.map((t) => h('option', { value: t.id }, `${t.name}${t.checklist.length ? `（チェック ${t.checklist.length}項目）` : ''}`))
    );
    dom.templateSelect.value = '';
  }

  /** フォームに値を入れる（source はタスクまたはテンプレート） */
  function fillForm(source, overrides = {}) {
    const f = dom.taskForm.elements;
    const v = { ...source, ...overrides };
    f.title.value = v.title || '';
    f.project.value = v.project || '';
    f.assignee.value = v.assignee || '';
    f.startDate.value = v.startDate || '';
    f.due.value = v.due || '';
    f.status.value = v.status || 'todo';
    f.priority.value = v.priority || 'medium';
    f.recurrence.value = v.recurrence || 'none';
    f.estimateHours.value = v.estimateHours === null || v.estimateHours === undefined ? '' : String(v.estimateHours);
    f.actualHours.value = v.actualHours ? String(v.actualHours) : '';
    f.tags.value = (v.tags || []).join(', ');
    f.description.value = v.description || '';
  }

  function applyTemplate(templateId) {
    const template = state.data.templates.find((t) => t.id === templateId);
    if (!template) {
      state.duplicateChecklist = [];
      dom.duplicateNote.hidden = true;
      return;
    }
    const f = dom.taskForm.elements;
    fillForm(template, { startDate: f.startDate.value, due: f.due.value, status: f.status.value, actualHours: 0, estimateHours: null });
    state.duplicateChecklist = template.checklist.slice();
    dom.duplicateNote.hidden = false;
    dom.duplicateNote.textContent = template.checklist.length
      ? `テンプレート「${template.name}」を入力しました。チェックリスト（${template.checklist.length}項目）も一緒に登録します。期限を入れて登録してください。`
      : `テンプレート「${template.name}」を入力しました。期限を入れて登録してください。`;
    clearFieldErrors();
    f.due.focus();
  }

  /**
   * 登録・編集フォームを開く。
   * options.duplicateOf を渡すと、そのタスクの内容を下書きにして新規登録（複製）する。
   */
  function openTaskForm(taskId, options = {}) {
    const sourceId = taskId || options.duplicateOf || null;
    const source = sourceId ? findTask(sourceId) : null;
    if (sourceId && !source) {
      toast('対象のタスクが見つかりません。', 'error');
      return;
    }
    const isEdit = Boolean(taskId);
    const isDuplicate = !isEdit && Boolean(source);
    state.editingTaskId = isEdit ? source.id : null;
    state.formMode = isEdit ? 'edit' : isDuplicate ? 'duplicate' : 'create';
    state.duplicateChecklist = isDuplicate ? source.checklist.map((i) => i.text) : [];

    const copyTitle = (title) => {
      const suffix = '（コピー）';
      return `${Array.from(title).slice(0, MAX_LENGTH.title - suffix.length).join('')}${suffix}`;
    };
    if (isEdit) fillForm(source);
    else if (isDuplicate) fillForm(source, { title: copyTitle(source.title), status: 'todo', actualHours: 0 });
    else fillForm({});
    fillDependsOnOptions(isEdit ? source.id : null, source ? source.dependsOn : '');
    fillTemplateOptions(state.formMode === 'create');
    dom.aiField.hidden = !(state.ai && state.formMode === 'create');
    dom.aiInput.value = '';
    dom.aiStatus.textContent = '';
    clearFieldErrors();
    refreshDatalists();
    dom.taskDialogTitle.textContent = isEdit ? 'タスクを編集' : isDuplicate ? 'タスクを複製' : 'タスクを追加';
    dom.taskSubmit.textContent = isEdit ? '変更を保存' : '登録する';
    dom.duplicateNote.hidden = !isDuplicate;
    dom.duplicateNote.textContent = state.duplicateChecklist.length
      ? `複製元のチェックリスト（${state.duplicateChecklist.length}項目）も、未完了の状態で引き継ぎます。メモと対応履歴は引き継ぎません。`
      : 'メモと対応履歴は引き継ぎません。';
    state.formSnapshot = isDuplicate ? '' : JSON.stringify(readForm()); // 複製は閉じる前に必ず確認する
    openDialog(dom.taskDialog, dom.taskForm.elements.title);
    dom.taskDialog.querySelector('.modal-body').scrollTop = 0;
  }

  function isFormDirty() {
    return JSON.stringify(readForm()) !== state.formSnapshot;
  }

  async function requestCloseTaskForm() {
    if (isFormDirty()) {
      const ok = await confirmDialog({
        title: '入力内容を破棄しますか？',
        message: '保存していない入力内容は失われます。',
        confirmLabel: '破棄して閉じる',
        danger: true,
      });
      if (!ok) return;
    }
    closeDialog(dom.taskDialog);
  }

  function handleTaskSubmit(e) {
    e.preventDefault();
    const values = readForm();
    const errors = validateTaskValues(values);
    FIELDS.forEach((field) => setFieldError(field, errors[field] || ''));
    const firstError = FIELDS.find((field) => errors[field]);
    if (firstError) {
      fieldControl(firstError).focus();
      return;
    }

    if (state.editingTaskId) {
      const result = updateTask(state.editingTaskId, values);
      if (result === 'unchanged') {
        toast('変更はありませんでした', 'info');
        closeDialog(dom.taskDialog);
      } else if (result === 'saved') {
        closeDialog(dom.taskDialog);
      }
    } else {
      const message = state.formMode === 'duplicate' ? 'タスクを複製しました' : 'タスクを登録しました';
      if (createTask(values, state.duplicateChecklist, message)) closeDialog(dom.taskDialog);
    }
    // 保存に失敗した場合はフォームを開いたままにして、入力内容を残す
  }

  // ----- 確認ダイアログ -----
  let confirmResolver = null;

  function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
    if (confirmResolver) confirmResolver(false);
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.confirmOk.textContent = confirmLabel;
    dom.confirmOk.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    return new Promise((resolve) => {
      confirmResolver = resolve;
      openDialog(dom.confirmDialog, dom.confirmCancel); // 安全な選択肢に初期フォーカス
    });
  }

  async function requestDelete(taskIds) {
    const ids = Array.isArray(taskIds) ? taskIds : [taskIds];
    const tasks = ids.map((id) => findTask(id)).filter(Boolean);
    if (!tasks.length) return;
    const ok = await confirmDialog({
      title: tasks.length === 1 ? 'タスクを削除しますか？' : `${tasks.length}件のタスクを削除しますか？`,
      message:
        (tasks.length === 1 ? `「${tasks[0].title}」を削除します。` : `選択した${tasks.length}件のタスクを削除します。`) +
        '\nメモと対応履歴も削除されます。削除の直後は、通知の「元に戻す」で復元できます。',
      confirmLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    if (deleteTasks(tasks.map((t) => t.id))) {
      if (!dialogStack.length) dom.listSection.focus();
    }
  }

  // ----- 入力ダイアログ（テンプレート名など） -----
  let promptResolver = null;

  function promptDialog({ title, label, value = '', maxLength = 50, confirmLabel = '保存する', requiredMessage = '入力してください' }) {
    if (promptResolver) promptResolver(null);
    dom.promptTitle.textContent = title;
    dom.promptLabel.textContent = label;
    dom.promptInput.value = value;
    dom.promptInput.maxLength = maxLength;
    dom.promptInput.removeAttribute('aria-invalid');
    dom.promptError.hidden = true;
    dom.promptOk.textContent = confirmLabel;
    dom.promptForm.dataset.required = requiredMessage;
    return new Promise((resolve) => {
      promptResolver = resolve;
      openDialog(dom.promptDialog, dom.promptInput);
      dom.promptInput.select();
    });
  }

  function handlePromptSubmit(e) {
    e.preventDefault();
    const value = dom.promptInput.value.trim();
    if (!value) {
      dom.promptError.textContent = dom.promptForm.dataset.required;
      dom.promptError.hidden = false;
      dom.promptInput.setAttribute('aria-invalid', 'true');
      dom.promptInput.focus();
      return;
    }
    closeDialog(dom.promptDialog, value);
  }

  // ----- テンプレートの保存・管理 -----
  async function requestSaveTemplate(taskId) {
    const task = findTask(taskId);
    if (!task) return;
    const name = await promptDialog({
      title: 'テンプレートに保存',
      label: 'テンプレート名',
      value: excerpt(task.title, MAX_LENGTH.templateName),
      maxLength: MAX_LENGTH.templateName,
      requiredMessage: 'テンプレート名を入力してください',
    });
    if (name) saveTemplate(taskId, name);
  }

  function openTemplateManager() {
    renderTemplateList();
    openDialog(dom.templateDialog, dom.templateClose);
  }

  function renderTemplateList() {
    const templates = state.data.templates;
    if (!templates.length) {
      dom.templateList.replaceChildren(
        h('p', { class: 'muted-text' }, 'テンプレートはまだありません。タスクの詳細パネルの「テンプレートに保存」から作れます。')
      );
      return;
    }
    dom.templateList.replaceChildren(
      h(
        'ul',
        { class: 'template-items' },
        templates.map((t) =>
          h(
            'li',
            { class: 'template-item' },
            h(
              'div',
              { class: 'template-text' },
              h('p', { class: 'template-name' }, t.name),
              h(
                'p',
                { class: 'template-sub' },
                [t.title, t.checklist.length ? `チェック ${t.checklist.length}項目` : '', t.recurrence !== 'none' ? `繰り返し：${RECURRENCE_LABEL[t.recurrence]}` : '']
                  .filter(Boolean)
                  .join('／')
              )
            ),
            h(
              'button',
              { type: 'button', class: 'icon-btn icon-btn-danger', 'data-template-delete': t.id, 'aria-label': `テンプレート「${t.name}」を削除`, title: '削除' },
              icon('trash')
            )
          )
        )
      )
    );
  }

  async function requestDeleteTemplate(templateId) {
    const template = state.data.templates.find((t) => t.id === templateId);
    if (!template) return;
    const ok = await confirmDialog({
      title: 'テンプレートを削除しますか？',
      message: `テンプレート「${template.name}」を削除します。登録済みのタスクには影響しません。`,
      confirmLabel: '削除する',
      danger: true,
    });
    if (ok && deleteTemplate(templateId)) renderTemplateList();
  }

  // ----- 設定（マイタスク・自動化ルール） -----
  function openSettings() {
    const settings = state.data.settings;
    dom.settingsName.value = settings.myName;
    dom.settingsRules.replaceChildren(
      ...RULES.map((rule) =>
        h(
          'label',
          { class: 'check rule-item' },
          h('input', { type: 'checkbox', 'data-rule': rule.key, checked: settings.rules[rule.key] }),
          h('span', { class: 'check-text' }, rule.label)
        )
      )
    );
    openDialog(dom.settingsDialog, dom.settingsName);
  }

  function handleSettingsSubmit(e) {
    e.preventDefault();
    const rules = {};
    dom.settingsRules.querySelectorAll('[data-rule]').forEach((input) => {
      rules[input.dataset.rule] = input.checked;
    });
    const myName = dom.settingsName.value.trim().slice(0, MAX_LENGTH.assignee);
    if (saveSettings({ myName, rules })) closeDialog(dom.settingsDialog);
  }

  /** マイタスク：自分の名前が担当のタスクだけを表示する */
  function toggleMyTasks() {
    const name = state.data.settings.myName;
    if (!name) {
      toast('マイタスクを使うには、設定で「自分の名前」を入力してください', 'info');
      openSettings();
      return;
    }
    setFilters({ assignee: state.filters.assignee === name ? 'all' : name });
  }

  // ==========================================================
  // 9. 通知・保存エラー表示
  // ==========================================================
  const MAX_TOASTS = 4;

  /** options.action = { label, onClick } で、通知にボタン（「元に戻す」など）を付ける */
  function toast(message, type = 'success', options = {}) {
    const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check';
    const actionBtn = options.action
      ? h('button', { type: 'button', class: 'toast-action', 'data-focus-key': 'toast-action' }, options.action.label)
      : null;
    const el = h(
      'div',
      { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
      icon(iconName),
      h('p', { class: 'toast-msg' }, message),
      actionBtn,
      h('button', { type: 'button', class: 'toast-close', 'aria-label': '通知を閉じる' }, icon('x'))
    );
    const duration = options.duration || (type === 'error' ? 9000 : 3200);
    let timer = null;
    const dismiss = () => {
      clearTimeout(timer);
      if (el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 200);
    };
    const start = () => {
      clearTimeout(timer);
      timer = setTimeout(dismiss, duration);
    };
    $('.toast-close', el).addEventListener('click', dismiss);
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        dismiss();
        options.action.onClick();
      });
    }
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', start);
    el.addEventListener('focusin', () => clearTimeout(timer));

    dom.toasts.append(el);
    while (dom.toasts.children.length > MAX_TOASTS) dom.toasts.firstElementChild.remove();
    start();
  }

  function isQuotaError(err) {
    return Boolean(err) && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014);
  }

  function showSaveError(err) {
    const reason = state.saveBlocked
      ? 'データを保存できない状態です。'
      : isQuotaError(err)
        ? '保存容量の上限を超えたため、保存できませんでした。'
        : 'データを保存できませんでした。';
    const message = `${reason}今回の変更は保存されていません。「JSONをエクスポート」でバックアップを取り、不要なタスクやメモを整理してください。`;
    toast(message, 'error');
    showAlert(message);
  }

  function showAlert(message) {
    dom.alertText.textContent = message;
    dom.alert.hidden = false;
  }

  // ==========================================================
  // 10. バックアップとサンプルデータ
  // ==========================================================
  function fileStamp() {
    const now = new Date();
    return `${toDateKey(now).replace(/-/g, '')}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  }

  /** ファイルを保存する。保存できたら true（claude.ai 版では保存の確認で取り消されることがある） */
  async function downloadFile(content, fileName, type) {
    if (host && host.saveFile) return host.saveFile(fileName, content, type);
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: fileName });
    (dialogStack[dialogStack.length - 1] || document.body).append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  async function exportData() {
    const payload = {
      app: APP_ID,
      version: DATA_VERSION,
      exportedAt: nowIso(),
      tasks: state.data.tasks,
      templates: state.data.templates,
      settings: state.data.settings,
    };
    if (await downloadFile(JSON.stringify(payload, null, 2), `task-board-backup-${fileStamp()}.json`, 'application/json')) {
      toast(`${state.data.tasks.length}件のタスクを JSON ファイルに書き出しました`, 'success');
    }
  }

  // ----- CSV（Excel 用） -----
  /** Excel で数式として実行されないよう、= + - @ などで始まる値の先頭に ' を付ける */
  function csvCell(value) {
    let text = String(value === null || value === undefined ? '' : value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  async function exportCsv() {
    const tasks = getVisibleTasks();
    if (!tasks.length) {
      toast('書き出すタスクがありません（絞り込み条件を確認してください）', 'info');
      return;
    }
    const slashDate = (key) => key.replace(/-/g, '/');
    const deadlineLabel = { overdue: '期限切れ', today: '本日期限', upcoming: '', done: '' };
    const header = ['タスク名', '案件名', '担当者', '開始日', '期限', '優先度', '状態', '期限判定', '繰り返し', 'タグ', '予定時間', '実績時間', 'チェックリスト', 'メモ件数', '詳細説明', '作成日時', '最終更新日時'];
    const rows = tasks.map((t) => {
      const { total, done } = checklistProgress(t);
      return [
        t.title,
        t.project,
        t.assignee,
        t.startDate ? slashDate(t.startDate) : '',
        slashDate(t.due),
        PRIORITY_LABEL[t.priority],
        STATUS_LABEL[t.status],
        deadlineLabel[deadlineState(t)],
        t.recurrence === 'none' ? '' : RECURRENCE_LABEL[t.recurrence],
        t.tags.join(' / '),
        t.estimateHours === null ? '' : t.estimateHours,
        t.actualHours || '',
        total ? `${done}/${total}` : '',
        t.memos.length,
        t.description,
        formatDateTime(t.createdAt),
        formatDateTime(t.updatedAt),
      ];
    });
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    // 先頭の BOM で、Excel で開いても文字化けしないようにする
    if (await downloadFile(`\uFEFF${csv}\r\n`, `task-board-${fileStamp()}.csv`, 'text/csv;charset=utf-8')) {
      toast(`表示中の${tasks.length}件を CSV に書き出しました`, 'success');
    }
  }

  // ----- 予定表（.ics：Outlook など） -----
  function icsEscape(text) {
    return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  /** 1行 75 オクテットごとに折り返す（RFC 5545）。日本語の途中では切らない */
  function icsFold(line) {
    const encoder = new TextEncoder();
    const lines = [];
    let current = '';
    let bytes = 0;
    for (const ch of line) {
      const size = encoder.encode(ch).length;
      const limit = lines.length ? 74 : 75; // 2行目以降は先頭の空白 1 オクテット分を引く
      if (bytes + size > limit) {
        lines.push(current);
        current = '';
        bytes = 0;
      }
      current += ch;
      bytes += size;
    }
    lines.push(current);
    return lines.join('\r\n ');
  }

  function buildIcs(tasks) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Task Board//Task Board//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const t of tasks) {
      const summary = `【期限】${t.title}`;
      const description = [
        `案件：${t.project || '（なし）'}`,
        `担当：${t.assignee}`,
        `状態：${STATUS_LABEL[t.status]}／優先度：${PRIORITY_LABEL[t.priority]}`,
        t.description ? `\n${t.description}` : '',
        '\n（Task Board から書き出し）',
      ]
        .filter(Boolean)
        .join('\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${t.id}@task-board.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${t.due.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${addDays(t.due, 1).replace(/-/g, '')}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(description)}`,
        'TRANSP:TRANSPARENT', // 予定表で「空き時間」として扱う
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsEscape(summary)}`,
        `TRIGGER:${ICS_ALARM}`,
        'END:VALARM',
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(icsFold).join('\r\n')}\r\n`;
  }

  async function exportIcs(tasks, fileName) {
    const targets = tasks.filter((t) => t.status !== 'done');
    if (!targets.length) {
      toast('予定表に書き出す未完了タスクがありません', 'info');
      return;
    }
    if (!(await downloadFile(buildIcs(targets), fileName, 'text/calendar;charset=utf-8'))) return;
    toast(`${targets.length}件の期限を予定表ファイル（.ics）に書き出しました。開くと Outlook に取り込めます`, 'success');
  }

  // ----- 報告文・共有（Outlook / Webex / Teams） -----
  function shortDate(key) {
    const { y, m, d } = parseDateKey(key);
    return `${pad2(m)}/${pad2(d)}（${WEEKDAY[new Date(y, m - 1, d).getDay()]}）`;
  }

  function deadlineText(task) {
    const ds = deadlineState(task);
    const diff = daysBetween(state.today, task.due);
    if (ds === 'overdue') return `※期限切れ（${-diff}日超過）`;
    if (ds === 'today') return '※本日期限';
    return '';
  }

  function reportLine(task) {
    const { total, done } = checklistProgress(task);
    const detail = [
      `担当：${task.assignee}`,
      `期限：${shortDate(task.due)}${deadlineText(task)}`,
      `状態：${STATUS_LABEL[task.status]}`,
      `優先度：${PRIORITY_LABEL[task.priority]}`,
      total ? `チェック：${done}/${total}` : '',
    ].filter(Boolean);
    return [`・${task.title}${task.project ? `［${task.project}］` : ''}`, `　${detail.join('／')}`];
  }

  const REPORT_TYPES = {
    status: '状況報告（期限別）',
    plan: '今日の予定（出社時）',
    done: '今日の実績（退社時）',
  };

  function reportTargets(assignee) {
    return state.data.tasks.filter((t) => assignee === 'all' || t.assignee === assignee);
  }

  function reportWho(assignee) {
    return assignee === 'all' ? '全員' : assignee;
  }

  /** 報告文を作る。type：status（期限別の状況）／ plan（今日の予定）／ done（今日の実績） */
  function buildReport(assignee, type = 'status') {
    if (type === 'plan') return buildPlanReport(assignee);
    if (type === 'done') return buildDoneReport(assignee);
    const tasks = reportTargets(assignee)
      .filter((t) => t.status !== 'done')
      .sort((a, b) => COMPARE.due(a, b) || COMPARE.priority(a, b));
    const weekEnd = addDays(state.today, WEEK_DAYS);
    const groups = [
      ['期限切れ', tasks.filter((t) => deadlineState(t) === 'overdue')],
      ['本日期限', tasks.filter((t) => deadlineState(t) === 'today')],
      [`今後${WEEK_DAYS}日以内`, tasks.filter((t) => t.due > state.today && t.due <= weekEnd)],
      [`${WEEK_DAYS + 1}日以降`, tasks.filter((t) => t.due > weekEnd)],
    ];
    const lines = [
      `【タスク状況報告】${formatDate(state.today)}時点（担当：${reportWho(assignee)}）`,
      `未完了 ${tasks.length}件（期限切れ ${groups[0][1].length}件／本日期限 ${groups[1][1].length}件／確認待ち ${tasks.filter((t) => t.status === 'review').length}件）`,
      '',
    ];
    for (const [label, list] of groups) {
      lines.push(`■${label}（${list.length}件）`);
      if (list.length) list.forEach((t) => lines.push(...reportLine(t)));
      else lines.push('・なし');
      lines.push('');
    }
    return {
      subject: `【タスク状況報告】${formatDate(state.today)}${assignee === 'all' ? '' : `（${assignee}）`}`,
      body: lines.join('\n').trimEnd(),
    };
  }

  /** 今日の予定：「今日やる」と本日期限の未完了タスク。期限切れは別に挙げる */
  function buildPlanReport(assignee) {
    const open = reportTargets(assignee).filter((t) => t.status !== 'done');
    const today = open.filter((t) => isMyDay(t) || deadlineState(t) === 'today').sort((a, b) => COMPARE.priority(a, b) || COMPARE.due(a, b));
    const overdue = open.filter((t) => deadlineState(t) === 'overdue' && !today.includes(t)).sort((a, b) => COMPARE.due(a, b));
    const hours = today.reduce((sum, t) => sum + (t.estimateHours || 0), 0);
    const lines = [`【本日の予定】${formatDate(state.today)}（担当：${reportWho(assignee)}）`, ''];
    lines.push(`■今日やること（${today.length}件${hours ? `／予定 ${formatHours(Math.round(hours * 100) / 100)}` : ''}）`);
    if (today.length) today.forEach((t) => lines.push(...reportLine(t)));
    else lines.push('・なし');
    if (overdue.length) {
      lines.push('', `■期限切れ（${overdue.length}件）`);
      overdue.forEach((t) => lines.push(...reportLine(t)));
    }
    return { subject: `【本日の予定】${formatDate(state.today)}`, body: lines.join('\n').trimEnd() };
  }

  /** 今日の実績：今日完了したタスクと、今日進めたタスク（対応履歴から集計） */
  function buildDoneReport(assignee) {
    const isToday = (iso) => toDateKey(new Date(iso)) === state.today;
    const completed = [];
    const progressed = [];
    for (const task of reportTargets(assignee)) {
      const todays = task.history.filter((e) => isToday(e.at) && e.type !== 'create');
      if (!todays.length) continue;
      const finished = task.status === 'done' && todays.some((e) => e.type === 'status' && e.changes[0] && e.changes[0].to === STATUS_LABEL.done);
      (finished ? completed : progressed).push({ task, count: todays.length });
    }
    const line = ({ task }) => {
      const extra = [task.actualHours ? `実績 ${formatHours(task.actualHours)}` : '', `状態：${STATUS_LABEL[task.status]}`].filter(Boolean).join('／');
      return `・${task.title}${task.project ? `［${task.project}］` : ''}（${extra}）`;
    };
    const lines = [`【本日の実績】${formatDate(state.today)}（担当：${reportWho(assignee)}）`, ''];
    lines.push(`■完了（${completed.length}件）`);
    if (completed.length) completed.forEach((x) => lines.push(line(x)));
    else lines.push('・なし');
    lines.push('', `■対応中・進捗あり（${progressed.length}件）`);
    if (progressed.length) progressed.forEach((x) => lines.push(line(x)));
    else lines.push('・なし');
    const tomorrow = reportTargets(assignee).filter((t) => t.status !== 'done' && t.due === addDays(state.today, 1));
    if (tomorrow.length) {
      lines.push('', `■明日が期限（${tomorrow.length}件）`);
      tomorrow.forEach((t) => lines.push(`・${t.title}（状態：${STATUS_LABEL[t.status]}）`));
    }
    return { subject: `【本日の実績】${formatDate(state.today)}`, body: lines.join('\n').trimEnd() };
  }

  /** タスク1件を共有する文面 */
  function buildTaskShare(task) {
    const { total, done } = checklistProgress(task);
    const lines = [
      `【タスク共有】${task.title}`,
      `案件：${task.project || '（なし）'}`,
      `担当：${task.assignee}`,
      task.startDate ? `開始日：${formatDate(task.startDate)}` : '',
      `期限：${formatDate(task.due)}${deadlineText(task)}`,
      `状態：${STATUS_LABEL[task.status]}／優先度：${PRIORITY_LABEL[task.priority]}`,
      task.recurrence !== 'none' ? `繰り返し：${RECURRENCE_LABEL[task.recurrence]}` : '',
      task.tags.length ? `タグ：${task.tags.join('、')}` : '',
      task.estimateHours !== null || task.actualHours ? `作業時間：実績 ${formatHours(task.actualHours || 0)}${task.estimateHours !== null ? `／予定 ${formatHours(task.estimateHours)}` : ''}` : '',
      blockingTask(task) ? `先行タスク待ち：${blockingTask(task).title}` : '',
    ].filter(Boolean);
    if (total) {
      lines.push('', `チェックリスト（${done}/${total} 完了）`);
      task.checklist.forEach((i) => lines.push(`${i.done ? '[x]' : '[ ]'} ${i.text}`));
    }
    if (task.description) lines.push('', '詳細：', task.description);
    const latest = task.memos.slice().sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
    if (latest) lines.push('', `最新メモ（${formatDateTime(latest.createdAt)}）：`, latest.text);
    return { subject: `【タスク共有】${task.title}（期限 ${shortDate(task.due)}）`, body: lines.join('\n') };
  }

  function openReport(options = {}) {
    state.share = { mode: 'report', taskId: null };
    const assignees = uniqueValues('assignee');
    dom.shareAssignee.replaceChildren(
      h('option', { value: 'all' }, '全員'),
      ...assignees.map((name) => h('option', { value: name }, name))
    );
    // 担当者で絞り込み中なら、その担当者の報告にする
    dom.shareAssignee.value = assignees.includes(state.filters.assignee) ? state.filters.assignee : 'all';
    dom.reportType.value = options.type || 'status';
    dom.shareTitle.textContent = '報告文を作成';
    dom.shareOptions.hidden = false;
    dom.shareIcs.hidden = true;
    dom.shareText.value = buildReport(dom.shareAssignee.value, dom.reportType.value).body;
    openDialog(dom.shareDialog, dom.shareCopy);
  }

  function openShareTask(taskId) {
    const task = findTask(taskId);
    if (!task) return;
    state.share = { mode: 'task', taskId };
    dom.shareTitle.textContent = 'タスクを共有';
    dom.shareOptions.hidden = true;
    dom.shareIcs.hidden = !state.icsAvailable;
    dom.shareText.value = buildTaskShare(task).body;
    openDialog(dom.shareDialog, dom.shareCopy);
  }

  function shareSubject() {
    if (state.share.mode === 'task') {
      const task = findTask(state.share.taskId);
      return task ? buildTaskShare(task).subject : '【タスク共有】';
    }
    return buildReport(dom.shareAssignee.value, dom.reportType.value).subject;
  }

  /** クリップボードにコピーする。使えない環境では選択してコピーする方法に切り替える */
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      /* 下の方法を試す */
    }
    const active = document.activeElement;
    const area = h('textarea', { readonly: true, class: 'clipboard-buffer', 'aria-hidden': 'true' });
    area.value = text;
    (dialogStack[dialogStack.length - 1] || document.body).append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (err) {
      copied = false;
    }
    area.remove();
    if (active && active.isConnected) active.focus();
    return copied;
  }

  async function handleShareCopy() {
    if (await copyText(dom.shareText.value)) {
      toast('コピーしました。Webex や Teams のメッセージ欄に貼り付けてください（Ctrl + V）', 'success');
    } else {
      dom.shareText.focus();
      dom.shareText.select();
      toast('自動でコピーできませんでした。選択した文面を Ctrl + C でコピーしてください', 'error');
    }
  }

  function buildMailto(subject, body) {
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`;
  }

  /** 既定のメールソフト（Outlook など）で下書きを開く。送信は利用者がメールソフト側で行う */
  async function handleShareMail() {
    const subject = shareSubject();
    const body = dom.shareText.value;
    let url = buildMailto(subject, body);
    let bodyCopied = false;
    if (url.length > MAILTO_MAX_LENGTH) {
      // 長い本文は URL で渡せないため、件名だけで下書きを開き、本文はクリップボードから貼り付けてもらう
      bodyCopied = await copyText(body);
      url = buildMailto(subject, bodyCopied ? '' : '（本文が長いため、Task Board の画面から文面をコピーして貼り付けてください）');
    }
    const link = h('a', { href: url });
    (dialogStack[dialogStack.length - 1] || document.body).append(link);
    link.click();
    link.remove();
    toast(
      bodyCopied
        ? '本文が長いため、件名だけでメールの下書きを開きました。本文はコピー済みなので、Ctrl + V で貼り付けてください'
        : 'メールソフトで下書きを開きます。開かない場合は「コピー」で文面をコピーして、メールに貼り付けてください',
      'info'
    );
  }

  async function importFromFile(file) {
    const keepMessage = '既存のデータは変更していません。';
    if (file.size > MAX_IMPORT_BYTES) {
      toast(`ファイルが大きすぎます（10MB まで）。${keepMessage}`, 'error');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      toast(`JSON ファイルとして読み取れませんでした。${keepMessage}`, 'error');
      return;
    }
    const result = validateData(parsed);
    if (!result.ok) {
      const more = result.errors.length > 1 ? `（ほか${result.errors.length - 1}件）` : '';
      toast(`読み込めないデータです：${result.errors[0]}${more}。${keepMessage}`, 'error');
      return;
    }
    const ok = await confirmDialog({
      title: 'バックアップから復元しますか？',
      message:
        `現在のデータ（${state.data.tasks.length}件）をすべて削除し、ファイルのデータ（${result.data.tasks.length}件）に置き換えます。\n` +
        'この操作は元に戻せません。必要に応じて、先に現在のデータをエクスポートしてください。',
      confirmLabel: '置き換えて復元する',
      danger: true,
    });
    if (!ok) return;
    closeDialog(dom.detailDialog);
    commit(result.data, `${result.data.tasks.length}件のタスクを復元しました`);
  }

  const SAMPLE_DEFS = [
    {
      key: 'sample-1',
      title: '見積書の作成と送付',
      project: 'A社 ネットワーク更改',
      assignee: '佐藤',
      offset: -2,
      priority: 'high',
      status: 'doing',
      description: '構成案に合わせて機器・保守費用を積算し、営業経由でお客様へ送付する。',
      memo: '機器の単価を代理店に確認中。回答待ち。',
      startOffset: -6,
      tags: ['見積'],
      estimateHours: 4,
      actualHours: 2.5,
    },
    {
      key: 'sample-2',
      title: '定例会議の議事録まとめ',
      project: '社内定例',
      assignee: '自分',
      offset: 0,
      priority: 'medium',
      status: 'todo',
      description: '決定事項と宿題（担当・期限）を整理して共有フォルダに保存する。',
      recurrence: 'weekly',
      tags: ['定例'],
      estimateHours: 0.5,
    },
    {
      key: 'sample-3',
      title: '作業手順書のレビュー依頼',
      project: 'A社 ネットワーク更改',
      assignee: '鈴木',
      offset: 3,
      priority: 'high',
      status: 'review',
      description: '事前確認・作業・事後確認・切戻しの各手順をレビューしてもらう。',
      memo: 'レビュー依頼のメールを送付済み。',
      checklist: ['事前確認の手順', '作業（投入コマンド）', '事後確認の手順', '切戻し手順'],
      checkedCount: 2,
      startOffset: -1,
      tags: ['手順書', 'レビュー'],
    },
    {
      key: 'sample-4',
      title: '検証環境の構築',
      project: 'B社 VPN 移行',
      assignee: '自分',
      offset: 6,
      priority: 'medium',
      status: 'doing',
      description: '',
      checklist: ['検証機器の手配', '初期設定', '疎通確認'],
      checkedCount: 1,
      startOffset: 0,
      tags: ['検証'],
      myDay: true,
      dependsOnKey: 'sample-3',
      estimateHours: 6,
      actualHours: 1.5,
    },
    {
      key: 'sample-5',
      title: '経費精算の申請',
      project: '',
      assignee: '自分',
      offset: 14,
      priority: 'low',
      status: 'todo',
      description: '先月分の交通費と書籍代。',
    },
    {
      key: 'sample-6',
      title: '月次報告書の提出',
      project: '社内定例',
      assignee: '田中',
      offset: -5,
      priority: 'medium',
      status: 'done',
      description: '',
    },
  ];

  function buildSampleTask(def, index) {
    const base = Date.now() - (SAMPLE_DEFS.length - index) * 3600000;
    const at = (minutes) => new Date(base + minutes * 60000).toISOString();
    const history = [historyEntry('create', at(0))];
    const memos = [];
    let last = at(0);
    if (def.status !== 'todo') {
      last = at(10);
      history.push(
        historyEntry('status', last, { changes: [{ label: FIELD_LABEL.status, from: STATUS_LABEL.todo, to: STATUS_LABEL[def.status] }] })
      );
    }
    if (def.memo) {
      last = at(20);
      memos.push({ id: createId('memo'), text: def.memo, createdAt: last });
      history.push(historyEntry('memo', last, { text: excerpt(def.memo, 80) }));
    }
    return {
      id: createId('task'),
      sampleKey: def.key,
      title: def.title,
      project: def.project,
      assignee: def.assignee,
      startDate: def.startOffset === undefined ? '' : addDays(state.today, def.startOffset),
      due: addDays(state.today, def.offset),
      priority: def.priority,
      status: def.status,
      recurrence: def.recurrence || 'none',
      dependsOn: '', // サンプル追加時に dependsOnKey から設定する
      estimateHours: def.estimateHours === undefined ? null : def.estimateHours,
      actualHours: def.actualHours || 0,
      tags: def.tags || [],
      description: def.description,
      myDay: def.myDay ? state.today : '',
      createdAt: at(0),
      updatedAt: last,
      checklist: (def.checklist || []).map((text, i) => ({
        id: createId('check'),
        text,
        done: i < (def.checkedCount || 0),
        createdAt: at(0),
      })),
      memos,
      history,
    };
  }

  /** サンプルを追加する。既存データは消さず、追加済みのサンプルは重複させない */
  function addSampleData() {
    const existing = new Set(state.data.tasks.map((t) => t.sampleKey).filter(Boolean));
    const samples = SAMPLE_DEFS.map(buildSampleTask).filter((t) => !existing.has(t.sampleKey));
    if (!samples.length) {
      toast('サンプルデータはすでに追加されています', 'info');
      return;
    }
    const next = deepClone(state.data);
    next.tasks.push(...samples);
    // 先行タスク（サンプル同士の依存関係）を ID に置き換える
    const idByKey = new Map(next.tasks.filter((t) => t.sampleKey).map((t) => [t.sampleKey, t.id]));
    for (const task of samples) {
      const def = SAMPLE_DEFS.find((d) => d.key === task.sampleKey);
      if (def && def.dependsOnKey && idByKey.has(def.dependsOnKey)) task.dependsOn = idByKey.get(def.dependsOnKey);
    }
    commit(next, `サンプルデータを${samples.length}件追加しました`);
  }

  // ==========================================================
  // 11. 初期化・イベント設定
  // ==========================================================
  function setFilters(patch) {
    state.filters = { ...state.filters, ...patch };
    renderList();
  }

  function clearFilters() {
    state.filters = { ...DEFAULT_FILTERS, sort: state.filters.sort };
    renderList();
  }

  // ----- Claude を使った入力補助（claude.ai 版のみ） -----
  async function runAiFill() {
    const text = dom.aiInput.value.trim();
    if (!text) {
      dom.aiStatus.textContent = 'タスクの内容を文章で入力してください';
      dom.aiInput.focus();
      return;
    }
    dom.aiRun.disabled = true;
    dom.aiStatus.textContent = 'Claude が考えています…';
    try {
      const r = await state.ai.parseTask(text, {
        today: state.today,
        assignees: uniqueValues('assignee'),
        projects: uniqueValues('project'),
        tags: uniqueTags(),
        myName: state.data.settings.myName,
      });
      const f = dom.taskForm.elements;
      const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      const due = isValidDateKey(r.due) ? r.due : f.due.value;
      const start = isValidDateKey(r.startDate) && (!due || r.startDate <= due) ? r.startDate : '';
      fillForm(readForm(), {
        title: str(r.title, MAX_LENGTH.title) || f.title.value,
        project: str(r.project, MAX_LENGTH.project) || f.project.value,
        assignee: str(r.assignee, MAX_LENGTH.assignee) || f.assignee.value,
        startDate: start,
        due,
        priority: PRIORITY_LABEL[r.priority] ? r.priority : f.priority.value,
        tags: Array.isArray(r.tags)
          ? normalizeTags(r.tags.filter((t) => typeof t === 'string').map((t) => t.slice(0, MAX_LENGTH.tag))).slice(0, MAX_TAGS)
          : [],
        description: str(r.description, MAX_LENGTH.description) || f.description.value,
      });
      const checklist = Array.isArray(r.checklist)
        ? r.checklist.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, MAX_LENGTH.checklist)).slice(0, 20)
        : [];
      if (checklist.length) state.duplicateChecklist = checklist;
      dom.duplicateNote.hidden = false;
      dom.duplicateNote.textContent = `Claude の提案を入力しました。内容を確認してから登録してください。${
        state.duplicateChecklist.length ? `チェックリスト（${state.duplicateChecklist.length}項目）も一緒に登録します。` : ''
      }`;
      dom.aiStatus.textContent = '入力しました';
      clearFieldErrors();
      f.title.focus();
    } catch (err) {
      dom.aiStatus.textContent = (err && err.message) || 'Claude から回答を得られませんでした。もう一度お試しください';
    } finally {
      dom.aiRun.disabled = false;
    }
  }

  async function runAiChecklist(taskId, button) {
    const task = findTask(taskId);
    const statusEl = $('#ai-checklist-status', dom.detailContent);
    if (!task || !state.ai) return;
    button.disabled = true;
    if (statusEl) statusEl.textContent = 'Claude が考えています…';
    let items = [];
    try {
      items = await state.ai.suggestChecklist({
        title: task.title,
        project: task.project,
        description: task.description,
        existing: task.checklist.map((i) => i.text),
      });
      items = (Array.isArray(items) ? items : [])
        .filter((t) => typeof t === 'string' && t.trim())
        .map((t) => t.trim().slice(0, MAX_LENGTH.checklist))
        .slice(0, 12);
    } catch (err) {
      const el = $('#ai-checklist-status', dom.detailContent);
      if (el) el.textContent = (err && err.message) || 'Claude から回答を得られませんでした';
      const btn = $('[data-ai-checklist]', dom.detailContent);
      if (btn) btn.disabled = false;
      return;
    }
    const current = $('#ai-checklist-status', dom.detailContent);
    if (current) current.textContent = '';
    const btn = $('[data-ai-checklist]', dom.detailContent);
    if (btn) btn.disabled = false;
    if (!items.length) {
      toast('追加できる手順の提案はありませんでした', 'info');
      return;
    }
    const ok = await confirmDialog({
      title: `${items.length}項目をチェックリストに追加しますか？`,
      message: items.map((t) => `・${t}`).join('\n'),
      confirmLabel: '追加する',
    });
    if (ok) addChecklistItems(taskId, items, 'Claude の提案');
  }

  /** claude.ai 版（cloud-sync.js）に渡す操作 */
  function hostApi() {
    return {
      getData: () => state.data,
      validate: (data) => validateData(data),
      /** claude.ai に保存されている内容で画面を置き換える */
      applyRemote(data, message) {
        const result = validateData(data);
        if (!result.ok) return { ok: false, errors: result.errors };
        if (!state.memoryOnly) {
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.data));
          } catch (err) {
            /* この端末への控えは保存できなくても、claude.ai 側にある */
          }
        }
        state.data = result.data;
        renderAll();
        if (message) toast(message, 'info');
        return { ok: true };
      },
      toast,
      setAi(ai) {
        state.ai = ai;
        renderDetail();
      },
      setIcsAvailable(available) {
        state.icsAvailable = available;
        dom.icsBtn.hidden = !available;
      },
    };
  }

  function handleBulkButton(action) {
    const ids = Array.from(state.selected);
    if (action === 'clear') {
      state.selected.clear();
      renderList();
    } else if (action === 'myday') {
      bulkUpdate(ids, { myDay: true });
    } else if (action === 'delete') {
      requestDelete(ids);
    }
  }

  function bindEvents() {
    dom.addBtn.addEventListener('click', () => openTaskForm(null));

    // サマリーカード → 絞り込み
    for (const card of dom.summaryCards) {
      card.addEventListener('click', () => {
        const key = card.dataset.summary;
        if (isPresetActive(key)) clearFilters();
        else {
          state.filters = { ...DEFAULT_FILTERS, sort: state.filters.sort, ...SUMMARY_PRESETS[key] };
          renderList();
        }
      });
    }

    // 検索・絞り込み
    let keywordTimer = null;
    dom.keyword.addEventListener('input', () => {
      clearTimeout(keywordTimer);
      keywordTimer = setTimeout(() => setFilters({ keyword: dom.keyword.value }), 150);
    });
    for (const [key, select] of Object.entries(dom.filterSelects)) {
      select.addEventListener('change', () => setFilters({ [key]: select.value }));
    }
    dom.clearFilters.addEventListener('click', () => {
      clearFilters();
      dom.keyword.focus();
    });

    // 一覧の操作（イベント委任）
    dom.list.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.dataset.action;
        const row = actionEl.closest('[data-task-id]');
        const id = row ? row.dataset.taskId : null;
        if (action === 'detail') openDetail(id);
        else if (action === 'edit') openTaskForm(id);
        else if (action === 'delete') requestDelete(id);
        else if (action === 'myday') toggleMyDay(id);
        else if (action === 'add-first') openTaskForm(null);
        else if (action === 'add-samples') addSampleData();
        else if (action === 'clear-filters') clearFilters();
        return;
      }
      const nav = e.target.closest('[data-nav]');
      if (nav) {
        navigateView(nav.dataset.nav);
        return;
      }
      const bulk = e.target.closest('button[data-bulk]');
      if (bulk) {
        handleBulkButton(bulk.dataset.bulk);
        return;
      }
      // 行・カードのどこをクリックしても詳細を開く（ボタン・プルダウン以外）
      const row = e.target.closest('tr[data-task-id], .board-card');
      if (row && !e.target.closest('button, select, a, input')) openDetail(row.dataset.taskId);
    });
    dom.list.addEventListener('change', (e) => {
      const select = e.target.closest('select[data-action="status"]');
      if (select && !changeStatus(select.dataset.taskId, select.value)) renderList();
      // 一括操作の選択
      const box = e.target.closest('input[data-select]');
      if (box) {
        if (box.checked) state.selected.add(box.dataset.select);
        else state.selected.delete(box.dataset.select);
        renderList();
      }
      if (e.target.closest('input[data-select-all]')) {
        const visible = getVisibleTasks();
        state.selected = e.target.checked ? new Set(visible.map((t) => t.id)) : new Set();
        renderList();
      }
      const bulkSelect = e.target.closest('select[data-bulk]');
      if (bulkSelect && bulkSelect.value) {
        bulkUpdate(Array.from(state.selected), { [bulkSelect.dataset.bulk]: bulkSelect.value });
        renderList();
      }
    });

    // ボード：ドラッグ＆ドロップで状態を変更
    const clearDropTarget = () => {
      dom.list.querySelectorAll('.board-col.is-drop-target').forEach((col) => col.classList.remove('is-drop-target'));
    };
    dom.list.addEventListener('dragstart', (e) => {
      const card = e.target.closest && e.target.closest('.board-card');
      if (!card) return;
      state.draggingTaskId = card.dataset.taskId;
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    });
    dom.list.addEventListener('dragend', (e) => {
      const card = e.target.closest && e.target.closest('.board-card');
      if (card) card.classList.remove('is-dragging');
      state.draggingTaskId = null;
      clearDropTarget();
    });
    dom.list.addEventListener('dragover', (e) => {
      const col = e.target.closest('[data-drop-status]');
      if (!col || !state.draggingTaskId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!col.classList.contains('is-drop-target')) {
        clearDropTarget();
        col.classList.add('is-drop-target');
      }
    });
    dom.list.addEventListener('dragleave', (e) => {
      const col = e.target.closest('[data-drop-status]');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-drop-target');
    });
    dom.list.addEventListener('drop', (e) => {
      const col = e.target.closest('[data-drop-status]');
      if (!col) return;
      e.preventDefault();
      const id = state.draggingTaskId || e.dataTransfer.getData('text/plain');
      state.draggingTaskId = null;
      clearDropTarget();
      if (id) changeStatus(id, col.dataset.dropStatus);
    });

    // 表示の切替（一覧／ボード／ガント／カレンダー）
    for (const button of dom.viewButtons) {
      button.addEventListener('click', () => setView(button.dataset.view));
    }
    dom.myDayBtn.addEventListener('click', () => setFilters({ due: state.filters.due === 'myday' ? 'all' : 'myday' }));
    dom.myTasksBtn.addEventListener('click', toggleMyTasks);

    // 詳細パネル
    setupDialog(dom.detailDialog, {
      onClosed: () => {
        state.detailTaskId = null;
      },
    });
    dom.detailClose.addEventListener('click', () => closeDialog(dom.detailDialog));
    dom.detailContent.addEventListener('click', (e) => {
      const button = e.target.closest('[data-detail-action]');
      if (!button || !state.detailTaskId) return;
      const action = button.dataset.detailAction;
      if (action === 'edit') openTaskForm(state.detailTaskId);
      else if (action === 'duplicate') openTaskForm(null, { duplicateOf: state.detailTaskId });
      else if (action === 'share') openShareTask(state.detailTaskId);
      else if (action === 'delete') requestDelete(state.detailTaskId);
      else if (action === 'myday') toggleMyDay(state.detailTaskId);
      else if (action === 'template') requestSaveTemplate(state.detailTaskId);
    });
    dom.detailContent.addEventListener('click', (e) => {
      const aiBtn = e.target.closest('[data-ai-checklist]');
      if (aiBtn) runAiChecklist(aiBtn.dataset.aiChecklist, aiBtn);
      const timeBtn = e.target.closest('[data-time-add]');
      if (timeBtn && state.detailTaskId) addActualTime(state.detailTaskId, Number(timeBtn.dataset.timeAdd));
      const link = e.target.closest('[data-detail-open]');
      if (link && findTask(link.dataset.detailOpen)) {
        state.detailTaskId = link.dataset.detailOpen;
        dom.detailContent.scrollTop = 0;
        renderDetail();
        dom.detailClose.focus();
      }
    });
    dom.detailContent.addEventListener('change', (e) => {
      const select = e.target.closest('select[data-action="status"]');
      if (select && !changeStatus(select.dataset.taskId, select.value)) renderDetail();
    });

    // 登録・編集フォーム
    setupDialog(dom.taskDialog, { onRequestClose: requestCloseTaskForm });
    dom.taskForm.addEventListener('submit', handleTaskSubmit);
    dom.taskDialog.querySelectorAll('[data-dialog-close]').forEach((btn) => btn.addEventListener('click', requestCloseTaskForm));
    dom.taskForm.addEventListener('input', (e) => {
      const wrapper = e.target.closest('[data-field]');
      if (wrapper && wrapper.classList.contains('has-error')) setFieldError(wrapper.dataset.field, '');
    });
    dom.templateSelect.addEventListener('change', () => applyTemplate(dom.templateSelect.value));
    dom.aiRun.addEventListener('click', runAiFill);
    dom.aiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runAiFill();
      }
    });

    // 入力ダイアログ
    setupDialog(dom.promptDialog, {
      onClosed: (returnValue) => {
        const resolve = promptResolver;
        promptResolver = null;
        if (resolve) resolve(returnValue || null);
      },
    });
    dom.promptForm.addEventListener('submit', handlePromptSubmit);
    dom.promptCancel.addEventListener('click', () => closeDialog(dom.promptDialog, ''));
    dom.promptInput.addEventListener('input', () => {
      dom.promptError.hidden = true;
      dom.promptInput.removeAttribute('aria-invalid');
    });

    // テンプレート管理
    setupDialog(dom.templateDialog);
    dom.templateBtn.addEventListener('click', openTemplateManager);
    dom.templateClose.addEventListener('click', () => closeDialog(dom.templateDialog));
    dom.templateList.addEventListener('click', (e) => {
      const button = e.target.closest('[data-template-delete]');
      if (button) requestDeleteTemplate(button.dataset.templateDelete);
    });

    // 設定
    setupDialog(dom.settingsDialog);
    dom.settingsBtn.addEventListener('click', openSettings);
    dom.settingsForm.addEventListener('submit', handleSettingsSubmit);
    dom.settingsCancel.addEventListener('click', () => closeDialog(dom.settingsDialog));

    // 確認ダイアログ
    setupDialog(dom.confirmDialog, {
      onClosed: (returnValue) => {
        const resolve = confirmResolver;
        confirmResolver = null;
        if (resolve) resolve(returnValue === 'ok');
      },
    });
    dom.confirmOk.addEventListener('click', () => closeDialog(dom.confirmDialog, 'ok'));
    dom.confirmCancel.addEventListener('click', () => closeDialog(dom.confirmDialog, 'cancel'));

    // バックアップ・補助操作
    dom.exportBtn.addEventListener('click', exportData);
    dom.alertExport.addEventListener('click', exportData);
    dom.alertClose.addEventListener('click', () => {
      dom.alert.hidden = true;
    });
    dom.importBtn.addEventListener('click', () => dom.importFile.click());
    dom.importFile.addEventListener('change', () => {
      const file = dom.importFile.files[0];
      dom.importFile.value = '';
      if (file) importFromFile(file);
    });
    dom.sampleBtn.addEventListener('click', addSampleData);
    dom.csvBtn.addEventListener('click', exportCsv);
    dom.icsBtn.addEventListener('click', () => exportIcs(getVisibleTasks(), `task-board-deadlines-${fileStamp()}.ics`));

    // 報告文・共有
    setupDialog(dom.shareDialog);
    dom.reportBtn.addEventListener('click', () => openReport());
    dom.shareClose.addEventListener('click', () => closeDialog(dom.shareDialog));
    const rebuildReport = () => {
      dom.shareText.value = buildReport(dom.shareAssignee.value, dom.reportType.value).body;
    };
    dom.shareAssignee.addEventListener('change', rebuildReport);
    dom.reportType.addEventListener('change', rebuildReport);
    dom.shareCopy.addEventListener('click', handleShareCopy);
    dom.shareMail.addEventListener('click', handleShareMail);
    dom.shareIcs.addEventListener('click', () => {
      const task = findTask(state.share.taskId);
      if (!task) return;
      if (task.status === 'done') toast('完了済みのタスクは予定表に書き出しません', 'info');
      else exportIcs([task], `task-board-${task.due}.ics`);
    });

    // キーボードショートカット（入力中・ダイアログ表示中は無効）
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || dialogStack.length) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        openTaskForm(null);
      } else if (key === '/') {
        e.preventDefault();
        dom.keyword.focus();
      } else if (key === 'v') {
        e.preventDefault();
        setView(VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length]);
      } else if (key === 't') {
        e.preventDefault();
        setFilters({ due: state.filters.due === 'myday' ? 'all' : 'myday' });
      } else if (key === 'm') {
        e.preventDefault();
        toggleMyTasks();
      }
    });

    // 別のタブで変更された場合は、その内容を読み込み直す
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY || e.storageArea !== window.localStorage) return;
      let parsed = null;
      try {
        parsed = e.newValue === null ? emptyData() : JSON.parse(e.newValue);
      } catch (err) {
        return;
      }
      const result = validateData(parsed);
      if (!result.ok) return;
      state.data = result.data;
      renderAll();
      toast('別のタブでの変更を反映しました', 'info');
    });

    // 日付が変わったら期限表示を更新する
    const refreshToday = () => {
      const today = todayKey();
      if (today !== state.today) {
        state.today = today;
        renderAll();
      }
    };
    setInterval(refreshToday, 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshToday();
    });
  }

  function init() {
    cacheDom();
    state.view = VIEWS.includes(prefs.load().view) ? prefs.load().view : 'list';
    state.data = loadData();
    bindEvents();
    renderAll();
    if (state.startupNotice) showAlert(state.startupNotice);
    if (host && host.attach) host.attach(hostApi());
  }

  init();
})();
