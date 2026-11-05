import { test, testSeq, eq } from './harness.js';
import * as cloud from '../js/cloud.js';
import { defaultData, normalize } from '../js/storage.js';

const W = (id, date, kg) => ({ id, date, weightKg: kg, bodyFatPct: null, memo: '' });
const J = (id, date, km) => ({ id, date, distanceKm: km, durationSec: 1800, memo: '' });
function data(patch) { return normalize({ ...defaultData(), ...patch }); }
const ids = (d, k) => d[k].map((x) => x.id).sort();

/* ---------- 統合（3 者統合） ---------- */
test('統合: 両方で別々に追加した記録は両方残る', () => {
  const base = { weights: ['a'] };
  const local = data({ weights: [W('a', '2026-11-01', 70), W('b', '2026-11-02', 69.8)] });
  const remote = data({ weights: [W('a', '2026-11-01', 70), W('c', '2026-11-03', 69.5)] });
  eq(ids(cloud.mergeRecords(base, local, remote), 'weights'), ['a', 'b', 'c']);
});
test('統合: この端末で削除した記録は、GitHub に残っていても消える', () => {
  const base = { jogs: ['a', 'b'] };
  const local = data({ jogs: [J('a', '2026-11-01', 5)] });
  const remote = data({ jogs: [J('a', '2026-11-01', 5), J('b', '2026-11-02', 4)] });
  eq(ids(cloud.mergeRecords(base, local, remote), 'jogs'), ['a']);
});
test('統合: 他の端末で削除した記録は、この端末に残っていても消える', () => {
  const base = { jogs: ['a', 'b'] };
  const local = data({ jogs: [J('a', '2026-11-01', 5), J('b', '2026-11-02', 4), J('n', '2026-11-04', 3)] });
  const remote = data({ jogs: [J('a', '2026-11-01', 5)] });
  eq(ids(cloud.mergeRecords(base, local, remote), 'jogs'), ['a', 'n']);
});
test('統合: 両方にある記録は、この端末の内容を優先', () => {
  const base = { weights: ['a'] };
  const local = data({ weights: [W('a', '2026-11-01', 69)] });
  const remote = data({ weights: [W('a', '2026-11-01', 70)] });
  eq(cloud.mergeRecords(base, local, remote).weights[0].weightKg, 69);
});
test('統合: 体重は 1 日 1 件（同じ日付が重なったらこの端末を残す）', () => {
  const local = data({ weights: [W('l', '2026-11-05', 68.9)] });
  const remote = data({ weights: [W('r', '2026-11-05', 69.1)] });
  eq(cloud.mergeRecords({}, local, remote).weights.map((x) => x.id), ['l']);
});
test('統合: base が空なら両方を全部残す（「両方を合わせる」）', () => {
  const local = data({ jogs: [J('a', '2026-11-01', 5)] });
  const remote = data({ jogs: [J('b', '2026-11-02', 4)] });
  eq(ids(cloud.mergeRecords({}, local, remote), 'jogs'), ['a', 'b']);
});
test('統合: 種目は両方を合わせる', () => {
  const local = data({ exercises: ['ベンチプレス', 'レッグプレス'] });
  const remote = data({ exercises: ['ベンチプレス', 'ディップス'] });
  eq(cloud.mergeRecords({}, local, remote).exercises.slice().sort(), ['ディップス', 'ベンチプレス', 'レッグプレス'].sort());
});

/* ---------- 暗号化 ---------- */
test('暗号化: 同じ合言葉で戻せる、違う合言葉では開けない', async () => {
  const salt = cloud.bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await cloud.deriveKey('correct horse', salt);
  const text = await cloud.encryptJSON(key, salt, { hello: '記録', n: 1 });
  eq(JSON.parse(text).format, 'stride-enc');
  eq(text.includes('記録'), false, '平文が含まれない');
  eq(await cloud.decryptJSON(await cloud.deriveKey('correct horse', salt), text), { hello: '記録', n: 1 });
  let failed = false;
  try { await cloud.decryptJSON(await cloud.deriveKey('wrong pass', salt), text); } catch (_) { failed = true; }
  eq(failed, true, '違う合言葉');
});
test('Base64: 大きなデータも往復できる', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(60000));
  const back = cloud.b64ToBytes(cloud.bytesToB64(bytes));
  eq(back.length, bytes.length);
  eq(back.every((b, i) => b === bytes[i]), true);
});

/* ---------- 同期の流れ（GitHub の代わりの受け口を使う） ---------- */
function fakeGitHub({ isPrivate = true } = {}) {
  const files = new Map(); // path -> { sha, text }
  let n = 0;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    if (!opts.headers || opts.headers.Authorization !== 'Bearer test-token') return json(401, { message: 'Bad credentials' });
    const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(?:\/contents\/(.+))?$/);
    if (!m || m[1] !== 'me/stride-backup') return json(404, { message: 'Not Found' });
    if (!m[2]) return json(200, { private: isPrivate });
    const path = m[2];
    if (!opts.method || opts.method === 'GET') {
      const f = files.get(path);
      if (!f) return json(404, { message: 'Not Found' });
      return json(200, { sha: f.sha, content: cloud.bytesToB64(new TextEncoder().encode(f.text)) });
    }
    if (opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      const cur = files.get(path);
      if ((cur && body.sha !== cur.sha) || (!cur && body.sha)) return json(409, { message: 'does not match' });
      const sha = `sha${++n}`;
      files.set(path, { sha, text: new TextDecoder().decode(cloud.b64ToBytes(body.content)) });
      return json(200, { content: { sha } });
    }
    return json(405, {});
  };
  return { files, fetchFn };
}

async function keyFor(gh) {
  const salt = JSON.parse(gh.files.get('data/records.enc.json').text).kdf.salt;
  return { salt, key: await cloud.deriveKey('passphrase1', salt) };
}

// localStorage を共有するので、退避して順番に実行し、最後に戻す
const KEYS = ['fitlog.v1', 'stride.cloud', 'stride.cloud.state', 'taskBoard.data'];
const saved = {};
const gh = fakeGitHub();

testSeq('同期の準備（端末のデータを退避）', async () => {
  for (const k of KEYS) { saved[k] = localStorage.getItem(k); localStorage.removeItem(k); }
});
testSeq('同期: 公開リポジトリは拒否する', async () => {
  globalThis.__strideFetch = fakeGitHub({ isPrivate: false }).fetchFn;
  let msg = '';
  try { await cloud.inspect({ repo: 'me/stride-backup', token: 'test-token', passphrase: 'passphrase1' }); } catch (e) { msg = e.message; }
  eq(msg.includes('非公開'), true);
});
testSeq('同期: 初回接続で、端末の記録が暗号化されて GitHub に置かれる', async () => {
  globalThis.__strideFetch = gh.fetchFn;
  localStorage.setItem('fitlog.v1', JSON.stringify(data({ weights: [W('a', '2026-11-01', 70)] })));
  const found = await cloud.inspect({ repo: 'me/stride-backup', token: 'test-token', passphrase: 'passphrase1' });
  eq(found.remoteRecords, null);
  const st = await cloud.connect(found, { includeTasks: false, mode: 'local' });
  eq(st.status, 'ok');
  const f = gh.files.get('data/records.enc.json');
  eq(Boolean(f), true);
  eq(f.text.includes('weightKg'), false, '平文が GitHub にない');
});
testSeq('同期: 端末で追加した記録が GitHub に送られる', async () => {
  const d = JSON.parse(localStorage.getItem('fitlog.v1'));
  d.weights.push(W('b', '2026-11-02', 69.6));
  localStorage.setItem('fitlog.v1', JSON.stringify(d));
  cloud.markLocalChange();
  await cloud.syncNow();
  const { key } = await keyFor(gh);
  const remote = await cloud.decryptJSON(key, gh.files.get('data/records.enc.json').text);
  eq(remote.weights.map((x) => x.id).sort(), ['a', 'b']);
});
testSeq('同期: 他の端末の追加と、この端末の追加が両方残る（競合の統合）', async () => {
  const { key, salt } = await keyFor(gh);
  // 他の端末（PC）が先にジョギングを追加して書き込んだ
  const other = await cloud.decryptJSON(key, gh.files.get('data/records.enc.json').text);
  other.jogs.push(J('pc1', '2026-11-03', 5));
  gh.files.set('data/records.enc.json', { sha: 'sha-other', text: await cloud.encryptJSON(key, salt, other) });
  // この端末（iPhone）は体重を追加
  const d = JSON.parse(localStorage.getItem('fitlog.v1'));
  d.weights.push(W('c', '2026-11-04', 69.4));
  localStorage.setItem('fitlog.v1', JSON.stringify(d));
  cloud.markLocalChange();
  await cloud.syncNow();
  const remote = await cloud.decryptJSON(key, gh.files.get('data/records.enc.json').text);
  eq([remote.weights.map((x) => x.id).sort(), remote.jogs.map((x) => x.id)], [['a', 'b', 'c'], ['pc1']]);
  const local = JSON.parse(localStorage.getItem('fitlog.v1'));
  eq(local.jogs.map((x) => x.id), ['pc1'], 'PC の追加が端末にも反映');
  eq(cloud.getState().dirty, false);
});
testSeq('同期: 他の端末だけが変更したときは、端末に読み込まれる', async () => {
  const { key, salt } = await keyFor(gh);
  const other = await cloud.decryptJSON(key, gh.files.get('data/records.enc.json').text);
  other.jogs.push(J('pc2', '2026-11-04', 6));
  gh.files.set('data/records.enc.json', { sha: 'sha-other2', text: await cloud.encryptJSON(key, salt, other) });
  await cloud.syncNow();
  eq(JSON.parse(localStorage.getItem('fitlog.v1')).jogs.map((x) => x.id).sort(), ['pc1', 'pc2']);
});
testSeq('同期: アイコンを削除して入れ直した想定（端末が空）でも、GitHub から記録を戻せる', async () => {
  localStorage.removeItem('fitlog.v1');
  localStorage.removeItem('stride.cloud');
  localStorage.removeItem('stride.cloud.state');
  const found = await cloud.inspect({ repo: 'me/stride-backup', token: 'test-token', passphrase: 'passphrase1' });
  eq(found.remoteRecords.weights.length, 3);
  await cloud.connect(found, { includeTasks: false, mode: 'remote' });
  const local = JSON.parse(localStorage.getItem('fitlog.v1'));
  eq([local.weights.length, local.jogs.length], [3, 2]);
});
testSeq('同期: 合言葉が違うと接続できない', async () => {
  let msg = '';
  try { await cloud.inspect({ repo: 'me/stride-backup', token: 'test-token', passphrase: 'wrong-pass' }); } catch (e) { msg = e.message; }
  eq(msg.includes('合言葉が違います'), true);
});
testSeq('同期: トークンが無効なら、その旨を表示する', async () => {
  const cfg = JSON.parse(localStorage.getItem('stride.cloud'));
  localStorage.setItem('stride.cloud', JSON.stringify({ ...cfg, token: 'expired' }));
  const st = await cloud.syncNow();
  eq([st.status, (st.lastError || '').includes('トークン')], ['error', true]);
  localStorage.setItem('stride.cloud', JSON.stringify(cfg));
});
testSeq('同期: 電波がないときは送信待ちのまま残り、つながったら送られる', async () => {
  const d = JSON.parse(localStorage.getItem('fitlog.v1'));
  d.jogs.push(J('off1', '2026-11-05', 3));
  localStorage.setItem('fitlog.v1', JSON.stringify(d));
  globalThis.__strideFetch = async () => { throw new TypeError('Failed to fetch'); };
  cloud.markLocalChange();
  const st = await cloud.syncNow();
  eq([st.status, cloud.getState().dirty], ['offline', true]);
  globalThis.__strideFetch = gh.fetchFn;
  const st2 = await cloud.syncNow();
  eq([st2.status, cloud.getState().dirty], ['ok', false]);
  const { key } = await keyFor(gh);
  const remote = await cloud.decryptJSON(key, gh.files.get('data/records.enc.json').text);
  eq(remote.jogs.some((x) => x.id === 'off1'), true);
});
testSeq('同期: タスクを保存する設定なら、タスクも暗号化して置かれる（設定しなければ置かれない）', async () => {
  localStorage.setItem('taskBoard.data', JSON.stringify({ app: 'task-board', version: 3, tasks: [{ id: 't1', title: '見積書' }], templates: [], settings: {} }));
  await cloud.syncNow();
  eq(gh.files.has('data/tasks.enc.json'), false, '設定なし');
  cloud.setIncludeTasks(true);
  await cloud.syncNow();
  const f = gh.files.get('data/tasks.enc.json');
  eq([Boolean(f), f.text.includes('見積書')], [true, false]);
});
testSeq('同期の後片付け（端末のデータを元に戻す）', async () => {
  await new Promise((r) => setTimeout(r, 3500)); // 予約された自動送信を待つ
  delete globalThis.__strideFetch;
  for (const k of KEYS) { if (saved[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, saved[k]); }
});
