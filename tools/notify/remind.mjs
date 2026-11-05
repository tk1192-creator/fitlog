// STRIDE 入力忘れのお知らせを送る（保存先リポジトリの GitHub Actions で実行。.github/scripts/remind.mjs として置く）
//
// 読むもの（すべて保存先リポジトリの中）
//   notify/status.json  … アプリが書く「最後に体重を記録した日付」（記録の値は含まない）
//   notify/sub-*.json   … 通知を受け取る端末の購読情報（アプリが書く）
//   notify/sent.json    … このスクリプトが書く「最後に送った日付」（1 日 1 回にするため）
// 秘密の値（VAPID の秘密鍵）は Actions のシークレットから受け取り、ログには出さない。
import webpush from 'web-push';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const test = String(process.env.TEST) === 'true';

function api(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
}

async function readJSON(path) {
  const r = await api(path);
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(`${path} を読めませんでした（${r.status}）`);
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}

async function writeJSON(path, obj, sha) {
  const r = await api(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `STRIDE お知らせ送信 ${new Date().toISOString()}`,
      content: Buffer.from(JSON.stringify(obj)).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!r.ok) throw new Error(`${path} を書けませんでした（${r.status}）`);
}

// 日本時間の今日と、今の時刻
const jst = new Date(Date.now() + 9 * 3600 * 1000);
const today = jst.toISOString().slice(0, 10);
const hour = jst.getUTCHours();

const status = (await readJSON('notify/status.json')).data || {};
const sent = await readJSON('notify/sent.json');

if (!test) {
  if (hour < 21) { console.log('21 時前のため送りません'); process.exit(0); }
  if (status.lastWeightDate === today) { console.log('今日の体重は記録済みのため送りません'); process.exit(0); }
  if (sent.data && sent.data.lastSentDate === today) { console.log('今日はすでに送信済みです'); process.exit(0); }
}

const lr = await api('notify');
const list = lr.ok ? await lr.json() : [];
const subs = (Array.isArray(list) ? list : []).filter((f) => /^sub-[\w-]+\.json$/.test(f.name));
if (!subs.length) { console.log('通知を受け取る端末が登録されていません'); process.exit(0); }

webpush.setVapidDetails('https://tk1192-creator.github.io/fitlog/', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const payload = JSON.stringify(test
  ? { title: 'STRIDE（テスト）', body: '通知のテストです。届いていれば設定は完了です。', tag: 'stride-test', url: './' }
  : { title: 'STRIDE', body: '今日の体重がまだ記録されていません。寝る前に記録しましょう。', tag: 'stride-remind', url: './#records' });

let delivered = 0;
for (const f of subs) {
  const { data, sha } = await readJSON(`notify/${f.name}`);
  if (!data || !data.subscription) continue;
  try {
    await webpush.sendNotification(data.subscription, payload, { TTL: 6 * 3600, urgency: 'normal' });
    delivered++;
    console.log(`${data.device || '端末'}（${f.name}）: 送信しました`);
  } catch (e) {
    console.log(`${data.device || '端末'}（${f.name}）: 送信できませんでした（${e.statusCode || e.message}）`);
    // 404・410 は、端末側で通知が無効になった（アプリの削除など）。購読情報を消す
    if (e.statusCode === 404 || e.statusCode === 410) {
      await api(`notify/${f.name}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'STRIDE 無効になった通知先を削除', sha }),
      });
    }
  }
}

if (!test && delivered) await writeJSON('notify/sent.json', { lastSentDate: today }, sent.sha);
console.log(`送信 ${delivered} 件 / 登録 ${subs.length} 件${test ? '（テスト）' : ''}`);
