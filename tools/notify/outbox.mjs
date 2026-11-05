// STRIDE 自己ベストの報告を LINE で家族に送る（保存先リポジトリの GitHub Actions で実行。.github/scripts/outbox.mjs）
// アプリが outbox/event-*.json（送る文章）を置くと動き、送ったファイルは消す。
import { lineReady, lineBroadcast } from './line.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

function api(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
}

const lr = await api('outbox');
const list = lr.ok ? await lr.json() : [];
const files = (Array.isArray(list) ? list : []).filter((f) => /^event-[\w-]+\.json$/.test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
if (!files.length) { console.log('送る報告はありません'); process.exit(0); }
if (!lineReady()) { console.log('LINE の鍵が設定されていないため送りません（報告は残します）'); process.exit(0); }

for (const f of files) {
  const r = await api(`outbox/${f.name}`);
  if (!r.ok) continue;
  const j = await r.json();
  let text = '';
  try { text = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')).text || ''; } catch (_) { /* 読めないものは消すだけ */ }
  if (text) {
    try {
      await lineBroadcast(text);
      console.log(`${f.name}: 送信しました`);
    } catch (e) {
      console.log(`${f.name}: ${e.message}`);
      continue; // 送れなかったものは残して、次の機会に送る
    }
  }
  // GitHub Actions の鍵（GITHUB_TOKEN）による削除は、この仕組みを再び動かさない
  await api(`outbox/${f.name}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'STRIDE 報告を送信済み', sha: j.sha }),
  });
}
