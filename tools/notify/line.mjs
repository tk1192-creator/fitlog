// LINE Messaging API で送る（保存先リポジトリの GitHub Actions で使う。.github/scripts/line.mjs として置く）
// 鍵（チャネルアクセストークン）は Actions のシークレット LINE_CHANNEL_ACCESS_TOKEN から受け取り、ログには出さない。
// 無料のコミュニケーションプランは月 200 通まで（送る相手の人数 × 通数で数える）。

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

export const lineReady = () => Boolean(TOKEN);

async function call(path, body) {
  const r = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const reason = (await r.text()).slice(0, 300);
    throw new Error(`LINE への送信に失敗しました（${r.status}）${reason ? ` 理由: ${reason}` : ''}`);
  }
}

/** 1 人に送る（LINE のユーザー ID が必要） */
export function linePush(userId, text) {
  return call('push', { to: userId, messages: [{ type: 'text', text: text.slice(0, 4900) }] });
}

/** 友だち全員（家族）に送る */
export function lineBroadcast(text) {
  return call('broadcast', { messages: [{ type: 'text', text: text.slice(0, 4900) }] });
}
