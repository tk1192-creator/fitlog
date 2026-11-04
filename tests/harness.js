// 最小限のテスト実行器（ブラウザ用）
const results = [];

export function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
  }
}

export function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} 期待値 ${b} / 実際 ${a}`);
}

export function report() {
  const ul = document.getElementById('results');
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = `${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ' — ' + r.msg}`;
    ul.append(li);
  }
  const failed = results.filter((r) => !r.ok).length;
  const s = document.getElementById('summary');
  s.textContent = failed ? `失敗 ${failed} 件 / 全 ${results.length} 件` : `すべて成功（${results.length} 件）`;
  s.className = failed ? 'fail' : 'pass';
  document.title = failed ? `FAIL ${failed}` : `PASS ${results.length}`;
}
