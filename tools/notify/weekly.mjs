// STRIDE 今週のふりかえりを LINE で家族に送る（保存先リポジトリの GitHub Actions で実行。.github/scripts/weekly.mjs）
// 読むもの：notify/weekly.json（アプリが書く、送る文章そのもの）／書くもの：notify/weekly-sent.json（同じ週に 2 回送らないため）
import { lineReady, lineBroadcast } from './line.mjs';

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
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(`${path} を読めませんでした（${r.status}）`);
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}

if (!lineReady()) { console.log('LINE の鍵が設定されていません'); process.exit(0); }

// 日本時間の今週の月曜日
const jst = new Date(Date.now() + 9 * 3600 * 1000);
const dow = (jst.getUTCDay() + 6) % 7;
const monday = new Date(jst.getTime() - dow * 86400 * 1000).toISOString().slice(0, 10);

const weekly = (await readJSON('notify/weekly.json')).data;
if (!weekly) { console.log('ふりかえりの文章がありません（家族への報告がオフ）'); process.exit(0); }
const sent = await readJSON('notify/weekly-sent.json');
if (!test && sent.data && sent.data.weekStart === monday) { console.log('今週はすでに送信済みです'); process.exit(0); }

const text = weekly.weekStart === monday
  ? weekly.text
  : `【STRIDE 今週のふりかえり】\n${weekly.name || 'STRIDE'}\n・今週の記録はまだありません`;
await lineBroadcast(test ? `【テスト】\n${text}` : text);
console.log('LINE（家族）: 送信しました');

if (!test) {
  const r = await api('notify/weekly-sent.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `STRIDE ふりかえり送信 ${new Date().toISOString()}`,
      content: Buffer.from(JSON.stringify({ weekStart: monday })).toString('base64'),
      ...(sent.sha ? { sha: sent.sha } : {}),
    }),
  });
  if (!r.ok) console.log(`送信済みの記録を書けませんでした（${r.status}）`);
}
