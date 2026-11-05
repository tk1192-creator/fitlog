// STRIDE 家族の部屋：新しいメッセージを、送った人以外の端末に通知する（.github/scripts/family.mjs として置く）
//
// 読むもの（家族の部屋のリポジトリの中）
//   messages/YYYY-MM/*.json … アプリが置いたメッセージ。名前・種類・スタンプ・時刻だけを読む（本文は暗号化されていて読めない）
//   notify/sub-*.json      … 家族の端末の通知先（アプリが置く。member＝だれの端末か）
// 秘密の値（VAPID の秘密鍵）は Actions のシークレットから受け取り、ログには出さない。
import { readFileSync } from 'node:fs';
import webpush from 'web-push';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const test = String(process.env.TEST) === 'true';

function api(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
}
async function readJSON(path) {
  const r = await api(path);
  if (!r.ok) return null;
  const j = await r.json();
  return JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
}

// 今回の push で追加されたメッセージのファイル
// アプリは GitHub の API でファイルを置くため、push の情報（commits[].added）には追加したファイルが入らないことがある。
// そこで、コミットごとに GitHub に詳細を問い合わせて、追加されたファイルを調べる。
const event = JSON.parse(readFileSync(process.env.EVENT_PATH, 'utf8'));
const MSG_RE = /^messages\/\d{4}-\d{2}\/[\w.-]+\.json$/;
const added = new Set();
const shas = new Set([...(event.commits || []).map((c) => c.id), event.head_commit && event.head_commit.id].filter(Boolean));
for (const sha of shas) {
  const r = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!r.ok) { console.log(`コミット ${sha.slice(0, 7)} を読めませんでした（${r.status}）`); continue; }
  for (const f of (await r.json()).files || []) if (f.status === 'added' && MSG_RE.test(f.filename)) added.add(f.filename);
}
console.log(`追加されたメッセージ ${added.size} 件`);
const messages = [];
for (const p of added) {
  const m = await readJSON(p);
  if (m && m.format === 'stride-family-message') messages.push(m);
}
if (!test && !messages.length) { console.log('通知するメッセージはありません'); process.exit(0); }

// 家族の端末の通知先
const lr = await api('notify');
const list = lr.ok ? await lr.json() : [];
const subs = [];
for (const f of (Array.isArray(list) ? list : []).filter((x) => /^sub-[\w-]+\.json$/.test(x.name))) {
  const d = await readJSON(`notify/${f.name}`);
  if (d && d.subscription) subs.push({ ...d, file: f.name, sha: f.sha });
}
if (!subs.length) { console.log('家族の部屋に通知先が登録されていません'); process.exit(0); }

webpush.setVapidDetails('https://tk1192-creator.github.io/fitlog/', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

async function push(sub, title, body) {
  const payload = JSON.stringify({ title, body, tag: 'stride-family', url: './#family' });
  try {
    await webpush.sendNotification(sub.subscription, payload, { TTL: 12 * 3600, urgency: 'high' });
    console.log(`${sub.device || '端末'}（${sub.file}）: 送信しました`);
    return true;
  } catch (e) {
    const reason = typeof e.body === 'string' ? e.body.slice(0, 300) : '';
    console.log(`${sub.device || '端末'}（${sub.file}）: 送信できませんでした（${e.statusCode || e.message}）${reason ? ` 理由: ${reason}` : ''}`);
    // 404・410 は端末側で無効になった通知先。消す（この削除では通知の仕組みは動かない）
    if (e.statusCode === 404 || e.statusCode === 410) {
      await api(`notify/${sub.file}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'STRIDE 無効になった通知先を削除', sha: sub.sha }) });
    }
    return false;
  }
}

let delivered = 0;
if (test) {
  for (const s of subs) if (await push(s, 'STRIDE 家族（テスト）', '家族の部屋の通知のテストです。届いていれば設定は完了です。')) delivered++;
} else {
  for (const m of messages) {
    const body = m.kind === 'stamp' ? `${m.name} から ${m.stamp} が届きました` : `${m.name} からメッセージが届きました`;
    // 送った人の端末には送らない
    for (const s of subs.filter((x) => x.member !== m.from)) if (await push(s, 'STRIDE 家族', body)) delivered++;
  }
}
console.log(`送信 ${delivered} 件 / メッセージ ${messages.length} 件・通知先 ${subs.length} 件${test ? '（テスト）' : ''}`);
