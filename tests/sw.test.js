import { test, eq } from './harness.js';

// sw.js の SW_VERSION と js/version.js の APP_VERSION がそろっているか（そろっていないと、端末に更新が届かない）
test('公開: sw.js のバージョンと js/version.js のバージョンが同じ', async () => {
  const sw = await (await fetch('../sw.js', { cache: 'reload' })).text();
  const ver = await (await fetch('../js/version.js', { cache: 'reload' })).text();
  const a = (sw.match(/const SW_VERSION = '([^']+)'/) || [])[1];
  const b = (ver.match(/APP_VERSION = '([^']+)'/) || [])[1];
  eq(Boolean(a && b), true, 'バージョンの書き方が見つからない');
  eq(a, b, 'sw.js の SW_VERSION を js/version.js と同じ値にする');
});
