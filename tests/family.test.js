import { test, testSeq, eq } from './harness.js';
import * as cloud from '../js/cloud.js';
import * as family from '../js/family.js';

/* ---------- 純粋関数 ---------- */
test('家族: 読みにいく月は今月から 90 日前の月まで', () => {
  eq(family.monthsToRead(new Date(2026, 10, 6)), ['2026-11', '2026-10', '2026-09', '2026-08']);
});
test('家族: 3 か月より前と重複を除き、時刻順に並べる', () => {
  const now = new Date('2026-11-06T00:00:00Z');
  const r = family.pruneMessages([
    { id: 'b', at: '2026-11-05T10:00:00Z' }, { id: 'old', at: '2026-07-01T00:00:00Z' },
    { id: 'a', at: '2026-11-01T10:00:00Z' }, { id: 'b', at: '2026-11-05T10:00:00Z' },
  ], now);
  eq(r.map((m) => m.id), ['a', 'b']);
});
test('家族: 未読は自分以外から、最後に読んだ時刻より後のもの', () => {
  const list = [{ from: 'me', at: '2026-11-05T01' }, { from: 'you', at: '2026-11-05T02' }, { from: 'you', at: '2026-11-05T03' }];
  eq([family.unreadCount(list, 'me', ''), family.unreadCount(list, 'me', '2026-11-05T02'), family.unreadCount(list, 'you', '')], [2, 1, 1]);
});
test('家族: ファイル名は月のフォルダと時刻（名前順＝時刻順）', () => {
  eq(family.messagePath('2026-11-06T09:30:15.123Z', 'ab12'), 'messages/2026-11/2026-11-06T09-30-15-123Z-ab12.json');
});

/* ---------- GitHub とのやりとり（偽の GitHub で確認） ---------- */
function fakeGitHub(repos) {
  const files = new Map(); // "repo:path" -> { sha, text }
  const commits = [];
  let n = 0;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    if (!opts.headers || opts.headers.Authorization !== 'Bearer test-token') return json(401, { message: 'Bad credentials' });
    const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(?:\/contents\/(.+))?$/);
    if (!m || !(m[1] in repos)) return json(404, { message: 'Not Found' });
    if (!m[2]) return json(200, { private: repos[m[1]] });
    const key = `${m[1]}:${decodeURIComponent(m[2])}`;
    if (!opts.method || opts.method === 'GET') {
      const f = files.get(key);
      if (f) return json(200, { sha: f.sha, content: cloud.bytesToB64(new TextEncoder().encode(f.text)) });
      const items = new Map();
      for (const k of files.keys()) {
        if (!k.startsWith(`${key}/`)) continue;
        const rest = k.slice(key.length + 1);
        const name = rest.split('/')[0];
        const path = `${key.split(':')[1]}/${name}`;
        if (rest.includes('/')) items.set(name, { type: 'dir', name, path });
        else items.set(name, { type: 'file', name, path, sha: files.get(k).sha });
      }
      return items.size ? json(200, [...items.values()]) : json(404, { message: 'Not Found' });
    }
    const body = JSON.parse(opts.body);
    if (opts.method === 'DELETE') { files.delete(key); return json(200, {}); }
    if (opts.method === 'PUT') {
      const sha = `sha${++n}`;
      files.set(key, { sha, text: new TextDecoder().decode(cloud.b64ToBytes(body.content)) });
      commits.push(body.message);
      return json(200, { content: { sha } });
    }
    return json(405, {});
  };
  return { files, commits, fetchFn };
}

const KEYS = ['stride.cloud', 'stride.cloud.state', 'stride.family', 'stride.family.messages', 'stride.family.seen', 'stride.family.cleanedAt'];
const saved = {};
let gh;
const useMember = (repo) => localStorage.setItem('stride.cloud', JSON.stringify({ repo, token: 'test-token', key: 'AAAA', salt: 'AAAA' }));

testSeq('家族: 準備（端末のデータを退避）', async () => {
  for (const k of KEYS) { saved[k] = localStorage.getItem(k); localStorage.removeItem(k); }
  gh = fakeGitHub({ 'me/stride-family': true, 'me/stride-open': false });
  globalThis.__strideFetch = gh.fetchFn;
  useMember('me/stride-backup');
});
testSeq('家族: 公開リポジトリ・見つからない部屋には入れない', async () => {
  let msg = '';
  try { await family.connectFamily({ repo: 'me/stride-open', passphrase: 'family-pass', name: 'パパ' }); } catch (e) { msg = e.message; }
  eq(msg.includes('非公開'), true, msg);
  try { await family.connectFamily({ repo: 'me/nothing', passphrase: 'family-pass', name: 'パパ' }); } catch (e) { msg = e.message; }
  eq(msg.includes('見つかりません'), true, msg);
});
testSeq('家族: 最初の人が部屋を始め、メッセージは暗号化して置く（名前・種類・スタンプは読める）', async () => {
  const r = await family.connectFamily({ repo: 'me/stride-family', passphrase: 'family-pass', name: 'パパ' });
  eq(r.created, true);
  eq(family.familyConfig().member, 'me/stride-backup');
  await family.sendMessage({ text: '今日ジム行く？' });
  await family.sendMessage({ stamp: '👏' });
  const msgFiles = [...gh.files.entries()].filter(([k]) => k.includes(':messages/'));
  eq(msgFiles.length, 2);
  const raw = msgFiles.map(([, v]) => v.text).join('\n');
  eq(raw.includes('今日ジム行く？'), false, '本文は暗号化されている');
  eq(raw.includes('パパ') && raw.includes('👏'), true, '名前とスタンプは通知のために読める');
  eq(gh.commits.filter((c) => c.startsWith(family.COMMIT_PREFIX)).length, 2, '通知の仕組みが動く説明でコミットする');
  eq(family.unread(), 0, '自分のメッセージは未読にならない');
});
testSeq('家族: 合言葉が違うと入れない', async () => {
  family.disconnectFamily();
  useMember('me/stride-wife');
  let msg = '';
  try { await family.connectFamily({ repo: 'me/stride-family', passphrase: 'wrong-pass', name: 'ママ' }); } catch (e) { msg = e.message; }
  eq(msg, '家族の合言葉が違います');
  eq(family.familyConfig(), null);
});
testSeq('家族: もう一人が同じ合言葉で入ると、メッセージを読めて未読が数えられる', async () => {
  const r = await family.connectFamily({ repo: 'me/stride-family', passphrase: 'family-pass', name: 'ママ' });
  eq(r.created, false);
  const list = family.cachedMessages();
  eq(list.map((m) => [m.name, m.kind, m.text || m.stamp]), [['パパ', 'text', '今日ジム行く？'], ['パパ', 'stamp', '👏']]);
  eq(family.unread(), 2);
  family.markSeen();
  eq(family.unread(), 0);
  await family.sendMessage({ text: '行く！' });
  eq(family.cachedMessages().length, 3);
});
testSeq('家族: 3 か月より前の月のフォルダは整理で消える', async () => {
  gh.files.set('me/stride-family:messages/2026-01/old.json', { sha: 'x', text: '{}' });
  localStorage.removeItem('stride.family.cleanedAt');
  await family.syncFamily();
  eq([...gh.files.keys()].some((k) => k.includes('messages/2026-01/')), false);
  eq([...gh.files.keys()].filter((k) => k.includes(':messages/')).length, 3, '新しいメッセージは残る');
});
testSeq('家族: 後片付け（端末のデータを元に戻す）', async () => {
  delete globalThis.__strideFetch;
  for (const k of KEYS) { if (saved[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, saved[k]); }
});
