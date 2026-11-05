// 家族の部屋（v2.10.0）：家族どうしでメッセージと応援スタンプを送り合う
//
// しくみ
// - 家族で 1 つの非公開リポジトリ（例：stride-family）に、メッセージを 1 件 1 ファイルで置く。
// - 本文は「家族の合言葉」で暗号化する（AES-GCM。鍵の作り方は個人の記録と同じ）。
//   名前・種類（メッセージかスタンプか）・スタンプの絵文字・送った時刻は、通知に使うため暗号化しない。
// - GitHub のトークンは、個人の記録用のトークンをそのまま使う（管理者がトークンの対象に家族の部屋を足す）。
// - メッセージは 3 か月で消す（端末の表示からも、GitHub からも）。
// - 新しいメッセージの通知は、家族の部屋の GitHub Actions（tools/notify/family.mjs）が相手の端末に送る。
import * as cloud from './cloud.js';

const CONFIG_KEY = 'stride.family';           // { repo, salt, key, name, member }
const CACHE_KEY = 'stride.family.messages';   // 復号したメッセージ（この端末の中だけ）
const SEEN_KEY = 'stride.family.seen';        // 最後に読んだメッセージの時刻
const CLEAN_KEY = 'stride.family.cleanedAt';  // 古いメッセージを最後に整理した時刻
const ROOM_PATH = 'family/room.json';         // 合言葉の確認用（暗号化した目印）
const MSG_DIR = 'messages';
export const KEEP_DAYS = 90;
export const STAMPS = ['👏', '🔥', '💪', '🎉', '👍', '😊'];
export const COMMIT_PREFIX = 'STRIDE 家族メッセージ'; // 通知はこの説明のコミットだけで動く
const TEXT_MAX = 500;

/* ---------- 設定（この端末） ---------- */

export function familyConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    return c && c.repo && c.key && c.salt && c.member ? c : null;
  } catch (_) { return null; }
}
function setFamilyConfig(c) {
  if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  else localStorage.removeItem(CONFIG_KEY);
  emit();
}
/** GitHub に接続するための設定（家族の部屋のリポジトリ＋個人のトークン） */
function ghCfg(fc = familyConfig()) {
  const pc = cloud.getConfig();
  if (!fc || !pc) return null;
  return { repo: fc.repo, token: pc.token };
}

/* ---------- 表示の更新を知らせる ---------- */

const listeners = new Set();
export function onFamilyChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => { try { fn(); } catch (_) { /* 何もしない */ } }); }

/* ---------- メッセージ（純粋関数） ---------- */

/** その月のフォルダ名（YYYY-MM） */
export function monthOf(iso) { return iso.slice(0, 7); }

/** 読みにいく月のフォルダ（今月から KEEP_DAYS 日前の月まで） */
export function monthsToRead(now = new Date()) {
  const out = [];
  const from = new Date(now.getTime() - KEEP_DAYS * 86400000);
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  while (d >= new Date(from.getFullYear(), from.getMonth(), 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/** 古いものを除き、時刻順に並べる */
export function pruneMessages(list, now = new Date()) {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString();
  const seen = new Set();
  return list.filter((m) => m && m.at >= cutoff && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** 自分以外からの、まだ読んでいないメッセージの数 */
export function unreadCount(list, member, seenAt) {
  return list.filter((m) => m.from !== member && (!seenAt || m.at > seenAt)).length;
}

/** ファイル名（時刻を先頭にして、名前順＝時刻順にする） */
export function messagePath(at, rand) {
  return `${MSG_DIR}/${monthOf(at)}/${at.replace(/[:.]/g, '-')}-${rand}.json`;
}

/* ---------- 端末に保存した一覧 ---------- */

export function cachedMessages() {
  try { return pruneMessages(JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')); } catch (_) { return []; }
}
function saveCache(list) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(pruneMessages(list))); } catch (_) { /* 何もしない */ }
}
export function seenAt() { return localStorage.getItem(SEEN_KEY) || ''; }
/** 読んだことにする。silent なら画面の描き直しを頼まない（描いている途中から呼ぶとき。呼ぶと描き直しが繰り返されるため） */
export function markSeen({ silent = false } = {}) {
  const list = cachedMessages();
  const last = list.length ? list[list.length - 1].at : '';
  if (!last || last === seenAt()) return;
  localStorage.setItem(SEEN_KEY, last);
  if (!silent) emit();
}
export function unread() {
  const fc = familyConfig();
  return fc ? unreadCount(cachedMessages(), fc.member, seenAt()) : 0;
}

/* ---------- 接続 ---------- */

/**
 * 家族の部屋に接続する。部屋がまだ始まっていなければ（目印のファイルがなければ）、この合言葉で始める。
 * @returns {Promise<{created: boolean}>}
 */
export async function connectFamily({ repo, passphrase, name }) {
  const pc = cloud.getConfig();
  if (!pc) throw new Error('先に「記録の保存先（GitHub）」を設定してください');
  const cfg = { repo: repo.trim(), token: pc.token };
  let info;
  try {
    info = await cloud.gh.getRepo(cfg);
  } catch (e) {
    if (e.status === 404) {
      throw new Error(`この端末のトークンでは「${cfg.repo}」が見えません。①部屋の名前（半角・空白なし）を確かめる、②このトークンの対象に家族の部屋が入っているかを管理者に確かめてもらう（入っていなければ、対象を 2 つにした新しいトークンを作り、設定の「トークンを入れ直す」で入れ替える）`);
    }
    throw e;
  }
  if (!info.private) throw new Error('家族の部屋は非公開（Private）のリポジトリにしてください');
  const room = await cloud.gh.getFile(cfg, ROOM_PATH);
  let salt;
  let key;
  let created = false;
  if (room) {
    salt = cloud.saltOf(room.text);
    key = await cloud.deriveKey(passphrase, salt);
    try { await cloud.decryptJSON(key, room.text); } catch (_) { throw new Error('家族の合言葉が違います'); }
  } else {
    salt = cloud.bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
    key = await cloud.deriveKey(passphrase, salt);
    await cloud.gh.putFile(cfg, ROOM_PATH, await cloud.encryptJSON(key, salt, { room: 'STRIDE family', createdAt: new Date().toISOString() }), null, 'STRIDE 家族の部屋を始める');
    created = true;
  }
  // 家族の中での自分の目印：個人の保存先の名前（同じ人の iPhone と PC で同じになる）
  setFamilyConfig({ repo: cfg.repo, salt, key: await cloud.exportRawKey(key), name: name.trim().slice(0, 20), member: pc.repo });
  await registerDevice().catch(() => {}); // 通知を使っている端末なら、家族の部屋にも登録する
  await syncFamily();
  return { created };
}

export function disconnectFamily() {
  setFamilyConfig(null);
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(SEEN_KEY);
}

export function setFamilyName(name) {
  const fc = familyConfig();
  if (fc) setFamilyConfig({ ...fc, name: name.trim().slice(0, 20) });
}

/* ---------- 送る・受け取る ---------- */

async function keyOf(fc) { return cloud.importRawKey(fc.key); }

/** メッセージかスタンプを送る */
export async function sendMessage({ text = '', stamp = '' }) {
  const fc = familyConfig();
  const cfg = ghCfg(fc);
  if (!cfg) throw new Error('家族の部屋に接続していません');
  const body = text.trim().slice(0, TEXT_MAX);
  if (!body && !STAMPS.includes(stamp)) throw new Error('メッセージを入れてください');
  const at = new Date().toISOString();
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
  const path = messagePath(at, rand);
  const kind = body ? 'text' : 'stamp';
  const file = {
    format: 'stride-family-message', v: 1,
    from: fc.member, name: fc.name || '家族', kind, stamp: kind === 'stamp' ? stamp : '', at,
    body: kind === 'text' ? await cloud.encryptJSON(await keyOf(fc), fc.salt, { text: body }) : '',
  };
  await cloud.gh.putFile(cfg, path, JSON.stringify(file), null, `${COMMIT_PREFIX} ${at}`);
  saveCache([...cachedMessages(), { id: path, from: fc.member, name: file.name, kind, stamp: file.stamp, text: body, at }]);
  markSeen();
}

/** 新しいメッセージを読み込む（記録の同期のたびに呼ばれる） */
export async function syncFamily() {
  const fc = familyConfig();
  const cfg = ghCfg(fc);
  if (!cfg) return;
  const key = await keyOf(fc);
  const have = new Set(cachedMessages().map((m) => m.id));
  const added = [];
  for (const month of monthsToRead()) {
    const files = await cloud.gh.listDir(cfg, `${MSG_DIR}/${month}`);
    for (const f of files) {
      if (!f.name.endsWith('.json') || have.has(f.path)) continue;
      const got = await cloud.gh.getFile(cfg, f.path);
      if (!got) continue;
      try {
        const m = JSON.parse(got.text);
        if (m.format !== 'stride-family-message') continue;
        const text = m.kind === 'text' ? (await cloud.decryptJSON(key, m.body)).text : '';
        added.push({ id: f.path, from: m.from, name: m.name, kind: m.kind, stamp: m.stamp || '', text, at: m.at });
      } catch (_) {
        // 合言葉が変わった後の古いメッセージなど、読めないものは飛ばす
      }
    }
  }
  if (added.length) {
    saveCache([...cachedMessages(), ...added]);
    emit();
  }
  await cleanOld(cfg);
}

/** 3 か月より前の月のフォルダを、1 日 1 回だけ消す（だれが消してもよい） */
async function cleanOld(cfg) {
  const last = Number(localStorage.getItem(CLEAN_KEY) || 0);
  if (Date.now() - last < 86400000) return;
  localStorage.setItem(CLEAN_KEY, String(Date.now()));
  const keep = new Set(monthsToRead());
  const dirs = await cloud.gh.listDir(cfg, MSG_DIR);
  for (const d of dirs) {
    if (d.type !== 'dir' || keep.has(d.name)) continue;
    for (const f of await cloud.gh.listDir(cfg, d.path)) await cloud.gh.deleteFile(cfg, f.path, f.sha);
  }
}

/* ---------- 通知の登録（家族の部屋にも、この端末の通知先を置く） ---------- */

async function registerDevice(info) {
  const fc = familyConfig();
  const cfg = ghCfg(fc);
  if (!cfg) return;
  const sub = info || await cloud.currentSubscription();
  if (!sub) return;
  const path = `notify/sub-${sub.deviceId}.json`;
  const cur = await cloud.gh.getFile(cfg, path);
  await cloud.gh.putFile(cfg, path, JSON.stringify({ subscription: sub.subscription, device: sub.device, member: fc.member, createdAt: new Date().toISOString() }), cur ? cur.sha : null, 'STRIDE 家族の通知先を登録');
}

async function unregisterDevice(deviceIdValue) {
  const cfg = ghCfg();
  if (!cfg) return;
  const path = `notify/sub-${deviceIdValue}.json`;
  const cur = await cloud.gh.getFile(cfg, path);
  if (cur) await cloud.gh.deleteFile(cfg, path, cur.sha);
}

cloud.addSyncStep(syncFamily);
cloud.onNotifyChange((info) => (info.on ? registerDevice(info) : unregisterDevice(info.deviceId)));

/** 開いている間は 30 秒ごとに新しいメッセージを確かめる（記録の同期とは別。軽い一覧の確認だけ） */
let timer = null;
export function startFamilyPolling() {
  if (timer) return;
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && familyConfig() && navigator.onLine) syncFamily().catch(() => {});
  }, 30000);
}
