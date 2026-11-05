// 目標までの進み具合を 400m トラックの絵で表す（v2.8.0）
// スタート地点（手前の直線の左端）から反時計回りに、進んだ割合の位置にランナーを置く。
// 開いたときに 1 回だけ、スタートから今の位置まで走る（「動きを減らす」設定の端末では走らない）。
const NS = 'http://www.w3.org/2000/svg';
// トラックの中心線（直線 160・半径 55 の競技場形。手前の直線を右へ → 右のカーブ → 奥の直線を左へ → 左のカーブ）
const PATH = 'M 80 135 L 240 135 A 55 55 0 0 0 240 25 L 80 25 A 55 55 0 0 0 80 135 Z';
const RUN_MS = 1400;
const RUN_KEY = 'stride.trackRun'; // この起動ですでに走ったか（sessionStorage）

function el(name, attrs = {}) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * @param {number} progress 0〜100
 * @param {{title: string, value: string, sub: string}} label 内側に書く文字
 */
export function trackGraphic(progress, label) {
  const p = Math.max(0, Math.min(100, progress)) / 100;
  const svg = el('svg', { viewBox: '0 0 320 160', class: 'track-svg', role: 'img', 'aria-label': `目標までの進み具合 ${Math.round(p * 100)}%` });

  // レーン：白 → 赤を幅を変えて重ねると、赤の上に白い線が並ぶ
  for (const [w, cls] of [[38, 'tk-line'], [36, 'tk-lane'], [25, 'tk-line'], [24, 'tk-lane'], [13, 'tk-line'], [12, 'tk-lane']]) {
    svg.append(el('path', { d: PATH, class: cls, 'stroke-width': String(w) }));
  }
  // フィニッシュライン（スタート地点）
  svg.append(el('line', { x1: '80', y1: '116', x2: '80', y2: '154', class: 'tk-finish' }));
  // 走った分の軌跡とランナー
  const trail = el('path', { d: PATH, class: 'tk-trail', 'stroke-dasharray': '0 1000' });
  const runner = el('circle', { r: '8', class: 'tk-runner' });
  svg.append(trail, runner);
  // 内側（フィールド）の文字
  const text = el('text', { x: '160', y: '62', class: 'tk-title', 'text-anchor': 'middle' });
  text.textContent = label.title;
  const value = el('text', { x: '160', y: '92', class: 'tk-value', 'text-anchor': 'middle' });
  value.textContent = label.value;
  const sub = el('text', { x: '160', y: '108', class: 'tk-sub', 'text-anchor': 'middle' });
  sub.textContent = label.sub;
  svg.append(text, value, sub);

  // 画面に入ってから長さを測って位置を決める
  requestAnimationFrame(() => {
    if (!svg.isConnected) return;
    const len = trail.getTotalLength();
    const place = (t) => {
      const pt = trail.getPointAtLength(len * t);
      runner.setAttribute('cx', pt.x.toFixed(1));
      runner.setAttribute('cy', pt.y.toFixed(1));
      trail.setAttribute('stroke-dasharray', `${(len * t).toFixed(1)} ${len.toFixed(1)}`);
    };
    let ran = false;
    try { ran = sessionStorage.getItem(RUN_KEY) === '1'; } catch (_) { /* 使えなければ毎回走る */ }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (ran || reduce || p === 0) { place(p); return; }
    try { sessionStorage.setItem(RUN_KEY, '1'); } catch (_) { /* 無視 */ }
    const t0 = performance.now();
    const step = (now) => {
      if (!svg.isConnected) return;
      const k = Math.min(1, (now - t0) / RUN_MS);
      place(p * (1 - (1 - k) ** 3)); // だんだんゆっくり止まる
      if (k < 1) requestAnimationFrame(step);
    };
    place(0);
    requestAnimationFrame(step);
  });
  return svg;
}
