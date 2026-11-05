// 記録の保存先：GitHub の非公開リポジトリ（暗号化して保存）
//
// 方針（v2.0.0、docs/design.md 18 章）
// - 記録（運動・体重・食事・設定）の「正」は GitHub の非公開リポジトリ。端末の localStorage（fitlog.v1）は一時的な写し
// - 記録を変えたら「未送信」の印を付け、数秒後に暗号化して GitHub に書き込む。送れなければ端末に残して、後で送り直す
// - 他の端末（PC など）で変わった記録は、起動時やアプリに戻ったときに読み込む
// - 同時に変更があったとき（GitHub の版が進んでいたとき）は、両方の変更を合わせて（統合して）から書き込む
// - タスク（Task Board）は端末に保存したまま、設定で選んだ場合だけ暗号化して自動バックアップする
// - 暗号化：合言葉から PBKDF2（SHA-256・31 万回）で鍵を作り、AES-256-GCM で暗号化。鍵とトークンはこの端末にだけ保存する

import { load as loadLocal, newId, normalize, save as saveLocal } from './storage.js';
import { readQueue, removeFromQueue, shareSettings, weeklySummary } from './share.js';

const CONFIG_KEY = 'stride.cloud';
const STATE_KEY = 'stride.cloud.state'; // { dirty, recordsSha, baseIds, tasksSha, tasksHash, lastSyncAt, lastError }
const TASK_KEY = 'taskBoard.data';
const RECORDS_PATH = 'data/records.enc.json';
const TASKS_PATH = 'data/tasks.enc.json';
const INBOX_DIR = 'inbox'; // ショートカットが歩数を置く受け取り箱（暗号化なし。取り込んだら消す）
const NOTIFY_STATUS_PATH = 'notify/status.json'; // 入力忘れのお知らせ用：最後に体重を記録した日付だけ（値は含めない）
const VAPID_PUBLIC_PATH = 'notify/vapid-public.txt'; // 通知の公開鍵（管理者が tools/notify/setup_notify.py で置く）
const DEVICE_KEY = 'stride.deviceId';
const WEEKLY_PATH = 'notify/weekly.json'; // LINE で家族に送る「今週のふりかえり」の文章（日曜の夜に Actions が送る）
const OUTBOX_DIR = 'outbox'; // LINE で家族に送る自己ベストの報告（置かれると Actions がすぐ送って消す）
const PBKDF2_ITERATIONS = 310000;
const PUSH_DELAY_MS = 3000;
const LISTS = ['weights', 'strength', 'jogs', 'daily'];

/* ======================================================================
   統合（純粋関数。テスト対象）
   ====================================================================== */

/**
 * 3 者統合：前回同期したときの ID（base）を手がかりに、端末（local）と GitHub（remote）の変更を合わせる。
 * - 両方にある記録：端末の内容を優先（端末で編集した可能性があるため）
 * - 端末にだけある記録：base になければ「端末で追加」→ 残す。base にあれば「GitHub 側（他の端末）で削除」→ 消す
 * - GitHub にだけある記録：base になければ「他の端末で追加」→ 残す。base にあれば「この端末で削除」→ 消す
 * - 設定は端末を優先、種目は両方を合わせる
 * @param {Record<string,string[]>} baseIds 前回同期時の各一覧の ID
 */
export function mergeRecords(baseIds, local, remote) {
  const out = { ...remote, ...local, settings: { ...remote.settings, ...local.settings } };
  for (const key of LISTS) {
    const base = new Set((baseIds && baseIds[key]) || []);
    const localList = local[key] || [];
    const remoteList = remote[key] || [];
    const localIds = new Set(localList.map((x) => x.id));
    const remoteIds = new Set(remoteList.map((x) => x.id));
    const merged = [];
    for (const item of localList) {
      if (remoteIds.has(item.id) || !base.has(item.id)) merged.push(item);
    }
    for (const item of remoteList) {
      if (!localIds.has(item.id) && !base.has(item.id)) merged.push(item);
    }
    out[key] = merged;
  }
  out.exercises = [...new Set([...(local.exercises || []), ...(remote.exercises || [])])];
  // 1 日 1 件の一覧（体重・食事）は、同じ日付が重なったら端末側（先に並べた方）を残す
  return normalize(out);
}

/** 各一覧の ID（次の統合の base にする） */
export function idsOf(data) {
  const ids = {};
  for (const key of LISTS) ids[key] = (data[key] || []).map((x) => x.id);
  return ids;
}

/* ======================================================================
   暗号化
   ====================================================================== */

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 合言葉から AES 鍵を作る（取り出し可能にして、端末に保存できるようにする） */
export async function deriveKey(passphrase, saltB64) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(saltB64), iterations: PBKDF2_ITERATIONS },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
}

async function importRawKey(rawB64) {
  return crypto.subtle.importKey('raw', b64ToBytes(rawB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function exportRawKey(key) {
  return bytesToB64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

/** オブジェクトを暗号化して、GitHub に置くファイルの中身（JSON 文字列）にする */
export async function encryptJSON(key, saltB64, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return JSON.stringify({
    format: 'stride-enc', v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: saltB64 },
    iv: bytesToB64(iv), data: bytesToB64(cipher), savedAt: new Date().toISOString(),
  });
}

/** GitHub のファイルの中身を復号する。合言葉（鍵）が違えば例外 */
export async function decryptJSON(key, fileText) {
  const f = JSON.parse(fileText);
  if (f.format !== 'stride-enc') throw new Error('STRIDE の暗号化ファイルではありません');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(f.iv) }, key, b64ToBytes(f.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

function saltOf(fileText) {
  try { return JSON.parse(fileText).kdf.salt; } catch (_) { return null; }
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ======================================================================
   GitHub API（Contents API）
   ====================================================================== */

class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** テストで差し替えられるよう、通信は fetch を経由する（window.__strideFetch があればそれを使う） */
function http(url, opts) {
  const f = globalThis.__strideFetch || fetch;
  return f(url, { cache: 'no-store', ...opts });
}

function headers(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

async function ghJSON(res) {
  if (res.ok) return res.json();
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch (_) { /* 何もしない */ }
  throw new GitHubError(res.status, msg);
}

async function getRepo(cfg) {
  return ghJSON(await http(`https://api.github.com/repos/${cfg.repo}`, { headers: headers(cfg.token) }));
}

/** ファイルを読む。なければ null。{ sha, text } */
async function getFile(cfg, path) {
  const res = await http(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, { headers: headers(cfg.token) });
  if (res.status === 404) return null;
  const j = await ghJSON(res);
  let text;
  if (j.content) {
    text = new TextDecoder().decode(b64ToBytes(j.content));
  } else {
    // 1MB を超えるファイルは content が空なので、生データとして取り直す
    const raw = await http(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, { headers: { ...headers(cfg.token), Accept: 'application/vnd.github.raw' } });
    if (!raw.ok) throw new GitHubError(raw.status, 'ファイルを読めませんでした');
    text = await raw.text();
  }
  return { sha: j.sha, text };
}

/** ファイルを書く（sha を渡すと、その版からの更新。版が進んでいれば 409） */
async function putFile(cfg, path, text, sha) {
  const body = { message: `STRIDE 自動保存 ${new Date().toISOString()}`, content: bytesToB64(new TextEncoder().encode(text)) };
  if (sha) body.sha = sha;
  const j = await ghJSON(await http(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
    method: 'PUT', headers: { ...headers(cfg.token), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return j.content.sha;
}

/** フォルダの中身の一覧（なければ空） */
async function listDir(cfg, path) {
  const res = await http(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, { headers: headers(cfg.token) });
  if (res.status === 404) return [];
  const j = await ghJSON(res);
  return Array.isArray(j) ? j : [];
}

async function deleteFile(cfg, path, sha) {
  const res = await http(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
    method: 'DELETE', headers: { ...headers(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `STRIDE 自動整理 ${new Date().toISOString()}`, sha }),
  });
  if (!res.ok && res.status !== 404) await ghJSON(res);
}

/* ======================================================================
   設定と状態（この端末の localStorage）
   ====================================================================== */

export function getConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    return c && c.repo && c.token && c.key && c.salt ? c : null;
  } catch (_) {
    return null;
  }
}

function setConfig(c) { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); }

export function getState() {
  try {
    return { dirty: false, baseIds: null, ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') };
  } catch (_) {
    return { dirty: false, baseIds: null };
  }
}

function setState(patch) {
  const s = { ...getState(), ...patch };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) { /* 何もしない */ }
  notify();
  return s;
}

/* ---------- 状態の通知（画面の表示を更新するため） ---------- */

const listeners = new Set();
let status = 'idle'; // idle | syncing | ok | pending | offline | error | off

export function onStatus(fn) { listeners.add(fn); fn(currentStatus()); return () => listeners.delete(fn); }

export function currentStatus() {
  if (!getConfig()) return { status: 'off', label: '未設定', ...getState() };
  const s = getState();
  const labels = { idle: '待機中', syncing: '同期中…', ok: '保存済み', pending: '送信待ち', offline: 'オフライン（後で送ります）', error: 'エラー' };
  // 未送信の変更があるときは「送信待ち」（同期中・オフライン・エラーの表示はそのまま）
  const st = (status === 'idle' || status === 'ok') && s.dirty ? 'pending' : status;
  return { status: st, label: labels[st] || st, ...s };
}

function notify() { const s = currentStatus(); listeners.forEach((fn) => { try { fn(s); } catch (_) { /* 何もしない */ } }); }
function setStatus(s) { status = s; notify(); }

/* ======================================================================
   同期
   ====================================================================== */

let app = null; // 記録を画面に反映するための接続口（app.js が登録）
let timer = null;
let running = null;
let again = false;

/** app.js から呼ぶ：applyRemote(data) で端末の写しと画面を更新できるようにする */
export function attachApp(a) { app = a; }

/** 記録が変わったとき（app.update / replaceData の後）に呼ぶ */
export function markLocalChange() {
  if (!getConfig()) return;
  setState({ dirty: true });
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, PUSH_DELAY_MS);
}

/** 同期する（重ねて呼ばれたら、終わった後にもう一度だけ行う） */
export async function syncNow() {
  if (!getConfig()) return currentStatus();
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        await syncRecords();
        if (await importStepsInbox()) again = true; // 取り込んだ歩数を記録として保存し直す
        await syncTasks();
        await updateNotifyStatus();
        await syncShare();
      } while (again);
      setState({ lastSyncAt: new Date().toISOString(), lastError: null });
      setStatus('ok');
    } catch (e) {
      const offline = !navigator.onLine || e instanceof TypeError;
      const msg = e.status === 401 ? 'トークンが無効か期限切れです。設定で入れ直してください'
        : e.status === 403 ? 'このトークンには書き込みの権限がありません'
          : e.status === 404 ? 'リポジトリが見つかりません（名前かトークンの対象を確認してください）'
            : offline ? '' : (e.message || '同期できませんでした');
      setState({ lastError: offline ? null : msg });
      setStatus(offline ? 'offline' : 'error');
    } finally {
      running = null;
    }
    return currentStatus();
  })();
  setStatus('syncing');
  return running;
}

async function keyOf(cfg) { return importRawKey(cfg.key); }

async function syncRecords() {
  const cfg = getConfig();
  const key = await keyOf(cfg);
  for (let attempt = 0; attempt < 4; attempt++) {
    const st = getState();
    const local = loadLocal();
    const remoteFile = await getFile(cfg, RECORDS_PATH);

    if (!remoteFile) {
      // GitHub にまだない：端末の記録を最初の版として置く
      const sha = await putFile(cfg, RECORDS_PATH, await encryptJSON(key, cfg.salt, local), null);
      setState({ dirty: false, recordsSha: sha, baseIds: idsOf(local) });
      return;
    }
    if (!st.dirty && remoteFile.sha === st.recordsSha) return; // どちらも変わっていない

    const remote = normalize(await decryptJSON(key, remoteFile.text));
    if (!st.dirty) {
      // 端末は変わっていない：GitHub の内容を端末に反映
      applyLocal(remote);
      setState({ recordsSha: remoteFile.sha, baseIds: idsOf(remote) });
      return;
    }
    // 端末に未送信の変更がある：GitHub が前回から変わっていれば統合してから書き込む
    const next = remoteFile.sha === st.recordsSha ? local : mergeRecords(st.baseIds, local, remote);
    try {
      const sha = await putFile(cfg, RECORDS_PATH, await encryptJSON(key, cfg.salt, next), remoteFile.sha);
      // 書き込み中に端末でさらに変更があった場合は、未送信のまま残してもう一度送る
      const changedMeanwhile = JSON.stringify(loadLocal()) !== JSON.stringify(local);
      if (!changedMeanwhile) applyLocal(next);
      setState({ dirty: changedMeanwhile, recordsSha: sha, baseIds: idsOf(next) });
      if (changedMeanwhile) again = true;
      return;
    } catch (e) {
      if (e.status === 409) continue; // 他の端末が先に書き込んだ：読み直して統合し直す
      throw e;
    }
  }
  throw new Error('他の端末の書き込みと重なり、保存できませんでした。しばらくしてからもう一度お試しください');
}

/** 端末の写しと画面を更新する（「変更あり」の印は付けない） */
function applyLocal(data) {
  const cur = loadLocal();
  if (JSON.stringify(cur) === JSON.stringify(data)) return;
  if (app && app.applyRemote) app.applyRemote(data);
  else saveLocal(data);
}

async function syncTasks() {
  const cfg = getConfig();
  if (!cfg.includeTasks) return;
  const raw = localStorage.getItem(TASK_KEY);
  if (!raw) return;
  const hash = await sha256Hex(raw);
  const st = getState();
  if (hash === st.tasksHash) return;
  const key = await keyOf(cfg);
  let tasksData;
  try { tasksData = JSON.parse(raw); } catch (_) { return; }
  const file = await encryptJSON(key, cfg.salt, tasksData);
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await getFile(cfg, TASKS_PATH);
    try {
      // タスクはこの端末のものを正としてバックアップする（上書き）
      const sha = await putFile(cfg, TASKS_PATH, file, remote ? remote.sha : null);
      setState({ tasksSha: sha, tasksHash: hash });
      return;
    } catch (e) {
      if (e.status === 409) continue;
      throw e;
    }
  }
}

/* ======================================================================
   歩数の受け取り箱（iPhone のショートカットが inbox/steps-YYYY-MM-DD-….json を置く）
   ====================================================================== */

/** 受け取り箱のファイル名から日付を取り出す（steps-2026-11-05-213000.json など） */
export function stepsDateOf(name) {
  const m = /^steps-(\d{4}-\d{2}-\d{2})(?:[-_T].*)?\.json$/.exec(name);
  return m ? m[1] : null;
}

/**
 * 歩数を記録に反映する（純粋関数。テスト対象）。同じ日の食事・歩数の記録があれば歩数だけ上書き
 * @param {{date: string, steps: number}[]} items 日付ごとに 1 件（最新のもの）
 */
export function applySteps(data, items) {
  const out = { ...data, daily: [...(data.daily || [])] };
  for (const { date, steps } of items) {
    const i = out.daily.findIndex((d) => d.date === date);
    if (i >= 0) out.daily[i] = { ...out.daily[i], steps };
    else out.daily.push({ id: newId(), date, intakeKcal: null, steps, memo: '' });
  }
  return normalize(out);
}

/** @returns {boolean} 取り込んだら true */
async function importStepsInbox() {
  const cfg = getConfig();
  const files = (await listDir(cfg, INBOX_DIR)).filter((f) => f.type === 'file' && stepsDateOf(f.name));
  if (!files.length) return false;
  // 同じ日のファイルが複数あれば、名前（時刻）が最も新しいものを使う
  files.sort((a, b) => (a.name < b.name ? -1 : 1));
  const latest = new Map();
  for (const f of files) {
    const file = await getFile(cfg, `${INBOX_DIR}/${f.name}`);
    if (!file) continue;
    try {
      const j = JSON.parse(file.text);
      const steps = Math.round(Number(String(j.steps).replace(/[^\d.]/g, '')));
      const date = /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : stepsDateOf(f.name);
      if (date && steps >= 0 && steps <= 200000) latest.set(date, { date, steps });
    } catch (_) { /* 読めないファイルは消すだけ */ }
  }
  if (latest.size) {
    const next = applySteps(loadLocal(), [...latest.values()]);
    applyLocal(next);
    setState({ dirty: true });
  }
  for (const f of files) await deleteFile(cfg, `${INBOX_DIR}/${f.name}`, f.sha);
  return latest.size > 0;
}

/* ======================================================================
   入力忘れのお知らせ（Web プッシュ）
   - 送るのは保存先リポジトリの GitHub Actions（tools/notify/）。21 時以降、今日の体重がなければ通知する
   - アプリは「最後に体重を記録した日付」だけを notify/status.json に書く（記録の値は書かない）
   - 通知を受け取る端末は notify/sub-<端末ID>.json に購読情報を置く
   ====================================================================== */

/** 最後に体重を記録した日付（なければ null） */
export function lastWeightDate(data) {
  return (data.weights || []).reduce((m, w) => (!m || w.date > m ? w.date : m), null);
}

async function updateNotifyStatus() {
  const cfg = getConfig();
  const st = getState();
  // このリポジトリで通知を使っているか（status.json があるか）を 1 日 1 回だけ確かめる
  let active = st.notifyActive;
  if (active == null || !st.notifyCheckedAt || Date.now() - Date.parse(st.notifyCheckedAt) > 86400000) {
    active = Boolean(await getFile(cfg, NOTIFY_STATUS_PATH));
    setState({ notifyActive: active, notifyCheckedAt: new Date().toISOString() });
  }
  if (!active) return;
  const last = lastWeightDate(loadLocal());
  if (last === st.notifyLastWeightDate) return;
  await writeNotifyStatus(cfg, last);
}

async function writeNotifyStatus(cfg, last) {
  const body = JSON.stringify({ lastWeightDate: last, updatedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await getFile(cfg, NOTIFY_STATUS_PATH);
    try {
      await putFile(cfg, NOTIFY_STATUS_PATH, body, cur ? cur.sha : null);
      setState({ notifyLastWeightDate: last, notifyActive: true });
      return;
    } catch (e) {
      if (e.status === 409 || e.status === 422) continue;
      throw e;
    }
  }
}

/* ---------- LINE で家族に報告（文章を置くだけ。送るのは Actions） ---------- */

async function syncShare() {
  const cfg = getConfig();
  // 送れていない自己ベストの報告を送る（1 件 1 ファイル）
  for (const item of readQueue()) {
    const body = JSON.stringify({ text: item.text, createdAt: new Date().toISOString() });
    try {
      await putFile(cfg, `${OUTBOX_DIR}/event-${item.id}.json`, body, null);
    } catch (e) {
      if (e.status !== 422) throw e; // 422 は同じファイルが置き済み
    }
    removeFromQueue(item.id);
  }
  // 今週のふりかえり（変わったときだけ書き直す。報告をやめたら消す）
  const data = loadLocal();
  const s = shareSettings(data);
  const st = getState();
  if (!(s.enabled && s.weekly)) {
    if (st.weeklyHash) {
      const cur = await getFile(cfg, WEEKLY_PATH);
      if (cur) await deleteFile(cfg, WEEKLY_PATH, cur.sha);
      setState({ weeklyHash: null });
    }
    return;
  }
  const w = weeklySummary(data);
  const hash = await sha256Hex(JSON.stringify(w));
  if (hash === st.weeklyHash) return;
  const cur = await getFile(cfg, WEEKLY_PATH);
  await putFile(cfg, WEEKLY_PATH, JSON.stringify({ ...w, updatedAt: new Date().toISOString() }), cur ? cur.sha : null);
  setState({ weeklyHash: hash });
}

function b64urlToBytes(s) {
  return b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** この端末で通知を使えるか（理由つき） */
export function notifySupport() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (ios && !standalone) return { ok: false, reason: 'iPhone では、ホーム画面に追加した STRIDE から開いたときだけ通知を受け取れます' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: 'この端末・ブラウザは通知に対応していません（iPhone は iOS 16.4 以降が必要です）' };
  }
  if (Notification.permission === 'denied') return { ok: false, reason: '通知が拒否されています。iPhone の「設定 → 通知 → STRIDE」で許可してください' };
  return { ok: true };
}

export function isNotifyOn() {
  const c = getConfig();
  return Boolean(c && c.notify && c.notify.deviceId);
}

/** 通知をオンにする（必ずボタンを押した操作の中から呼ぶ） */
export async function enableNotify() {
  const cfg = getConfig();
  if (!cfg) throw new Error('先に「記録の保存先（GitHub）」を設定してください');
  const sup = notifySupport();
  if (!sup.ok) throw new Error(sup.reason);
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('通知が許可されませんでした');
  const keyFile = await getFile(cfg, VAPID_PUBLIC_PATH);
  if (!keyFile) throw new Error('通知の準備（管理者の作業）がまだ済んでいません。管理者に連絡してください');
  const reg = await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  if (old) await old.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(keyFile.text.trim()) });
  const id = deviceId();
  const path = `notify/sub-${id}.json`;
  const cur = await getFile(cfg, path);
  const label = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : 'PC';
  await putFile(cfg, path, JSON.stringify({ subscription: sub.toJSON(), device: label, createdAt: new Date().toISOString() }), cur ? cur.sha : null);
  await writeNotifyStatus(cfg, lastWeightDate(loadLocal()));
  setConfig({ ...getConfig(), notify: { deviceId: id } });
  notify();
}

/** 通知をオフにする（この端末だけ） */
export async function disableNotify() {
  const cfg = getConfig();
  if (!cfg || !cfg.notify) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (_) { /* 何もしない */ }
  const path = `notify/sub-${cfg.notify.deviceId}.json`;
  const cur = await getFile(cfg, path);
  if (cur) await deleteFile(cfg, path, cur.sha);
  const { notify: _drop, ...rest } = cfg;
  setConfig(rest);
}

/* ======================================================================
   設定画面から使う操作
   ====================================================================== */

/**
 * 接続を確認して、GitHub の状況を調べる（まだ何も書き込まない）
 * @returns {{ remoteRecords: object|null, remoteTasks: object|null, remoteSavedAt: string|null, salt: string, key: CryptoKey }}
 */
export async function inspect({ repo, token, passphrase }) {
  const cfg = { repo: repo.trim(), token: token.trim() };
  const info = await getRepo(cfg);
  if (!info.private) throw new Error('このリポジトリは公開（Public）です。記録を守るため、非公開（Private）のリポジトリを指定してください');
  const recFile = await getFile(cfg, RECORDS_PATH);
  const salt = (recFile && saltOf(recFile.text)) || bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(passphrase, salt);
  let remoteRecords = null;
  let remoteSavedAt = null;
  if (recFile) {
    try {
      remoteRecords = normalize(await decryptJSON(key, recFile.text));
      remoteSavedAt = JSON.parse(recFile.text).savedAt || null;
    } catch (_) {
      throw new Error('合言葉が違います（GitHub にある記録を開けませんでした）');
    }
  }
  let remoteTasks = null;
  const taskFile = await getFile(cfg, TASKS_PATH);
  if (taskFile) {
    try { remoteTasks = await decryptJSON(key, taskFile.text); } catch (_) { remoteTasks = null; }
  }
  return { cfg, remoteRecords, remoteTasks, remoteSavedAt, salt, key, recordsSha: recFile ? recFile.sha : null };
}

/**
 * 接続を確定して同期を始める
 * @param {'remote'|'merge'|'local'} mode GitHub に記録があるときの扱い（GitHub を使う／合わせる／端末で上書き）
 */
export async function connect(found, { includeTasks, mode, restoreTasks }) {
  const { cfg, salt, key, remoteRecords, remoteTasks, recordsSha } = found;
  setConfig({ repo: cfg.repo, token: cfg.token, salt, key: await exportRawKey(key), includeTasks: Boolean(includeTasks) });
  const local = loadLocal();
  if (remoteRecords) {
    if (mode === 'remote') {
      applyLocal(remoteRecords);
      setState({ dirty: false, recordsSha, baseIds: idsOf(remoteRecords) });
    } else if (mode === 'merge') {
      // base を空にすると「両方にあるものを全部残す」統合になる
      const merged = mergeRecords({}, local, remoteRecords);
      applyLocal(merged);
      setState({ dirty: true, recordsSha, baseIds: idsOf(remoteRecords) });
    } else {
      setState({ dirty: true, recordsSha, baseIds: idsOf(remoteRecords) });
      // 端末で上書き：base に GitHub の ID を入れると、端末にない記録は「削除」扱いになる
    }
  } else {
    setState({ dirty: true, recordsSha: null, baseIds: idsOf(local) });
  }
  if (restoreTasks && remoteTasks && Array.isArray(remoteTasks.tasks)) {
    localStorage.setItem(TASK_KEY, JSON.stringify(remoteTasks));
  }
  setState({ tasksHash: null });
  return syncNow();
}

/** 接続を解除する（この端末のトークンと鍵を消す。GitHub の記録と端末の写しは残る） */
export function disconnect() {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(STATE_KEY);
  setStatus('off');
}

export function setIncludeTasks(on) {
  const c = getConfig();
  if (!c) return;
  setConfig({ ...c, includeTasks: Boolean(on) });
  setState({ tasksHash: null });
  if (on) syncNow();
}

/** 起動時・アプリに戻ったとき・電波が戻ったときに同期する */
export function startAutoSync() {
  if (getConfig()) syncNow();
  let lastPull = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (!getConfig()) return;
    if (document.visibilityState === 'visible' && Date.now() - lastPull > 15000) {
      lastPull = Date.now();
      syncNow();
    } else if (document.visibilityState === 'hidden' && getState().dirty) {
      syncNow();
    }
  });
  window.addEventListener('online', () => { if (getConfig()) syncNow(); });
}
