// グラフ画面: 体重・筋トレ・ジョギングの推移
import {
  dailyStrengthStats, dayIndex, dayIndexToStr, energyPlan, filterByPeriod, fmtInt, fmtNum, formatPace,
  latestWeight, monthlyJogStats, movingAverage, sortByDate, todayStr,
} from '../calc.js';
import { fmtDateShort, h, segmented } from '../ui.js';
import { renderBestList } from './bests.js';

const KINDS = [['weight', '体重'], ['strength', '筋トレ'], ['jog', 'ジョギング'], ['daily', '食事・歩数'], ['bests', '自己ベスト']];
const PERIODS = [['1m', '1か月'], ['3m', '3か月'], ['1y', '1年'], ['all', '全期間']];

const state = { kind: 'weight', period: '3m', exercise: null };
let instances = [];

export function unmount() {
  instances.forEach((c) => c.destroy());
  instances = [];
}

export function render(root, app, params) {
  if (params.kind) state.kind = params.kind;
  root.append(segmented(KINDS, state.kind, (k) => { state.kind = k; app.render(); }, 'グラフの種類'));

  if (state.kind === 'bests') {
    renderBestList(root, app);
    return;
  }
  root.append(h('div', { class: 'period-row' },
    segmented(PERIODS, state.period, (p) => { state.period = p; app.render(); }, '表示期間'),
  ));

  if (state.kind === 'weight') renderWeight(root, app);
  else if (state.kind === 'strength') renderStrength(root, app);
  else if (state.kind === 'daily') renderDaily(root, app);
  else renderJog(root, app);
}

/* ---------- 共通 ---------- */

/** CSS 変数から配色を読む（ライト / ダークで切り替わる） */
function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    s1: v('--series-1'), s2: v('--series-2'), text: v('--text-secondary'), muted: v('--text-muted'),
    grid: v('--grid'), surface: v('--surface-1'), ink: v('--text-primary'),
  };
}

function chartCard(title, note) {
  const canvas = h('canvas', { role: 'img', 'aria-label': title });
  const card = h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: title }),
    note ? h('p', { class: 'card-note', text: note }) : null,
    h('div', { class: 'chart-box' }, canvas),
  );
  return { card, canvas };
}

function emptyCard(title, message) {
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: title }),
    h('p', { class: 'empty', text: message }),
  );
}

/** 表で見る（グラフの代替） */
function tableDetails(headers, rows) {
  return h('details', { class: 'table-view' },
    h('summary', { text: '表で見る' }),
    h('div', { class: 'table-scroll' },
      h('table', {},
        h('thead', {}, h('tr', {}, headers.map((x) => h('th', { text: x })))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', { text: c }))))),
      ),
    ),
  );
}

function baseOptions(t, { xIsDay = true, yTitle = '', reverseY = false, yTick = null, legend = true } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    layout: { padding: { right: 8 } },
    plugins: {
      legend: { display: legend, position: 'top', align: 'start', labels: { color: t.text, boxWidth: 14, boxHeight: 2, padding: 12 } },
      tooltip: {
        callbacks: xIsDay ? { title: (items) => (items.length ? fmtDateShort(dayIndexToStr(items[0].parsed.x)) : '') } : {},
      },
    },
    scales: {
      x: xIsDay
        ? {
          type: 'linear',
          grid: { color: t.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: t.text, maxTicksLimit: 6, padding: 6, callback: (v) => { const s = dayIndexToStr(Math.round(v)); return `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`; } },
        }
        : { grid: { display: false }, border: { color: t.grid }, ticks: { color: t.text } },
      y: {
        reverse: reverseY,
        grid: { color: t.grid, drawTicks: false },
        border: { display: false },
        title: yTitle ? { display: true, text: yTitle, color: t.text } : undefined,
        ticks: { color: t.text, padding: 6, maxTicksLimit: 6, ...(yTick ? { callback: yTick } : {}) },
      },
    },
  };
}

/** 目標ラインの右端に文字を描くプラグイン */
const targetLabelPlugin = {
  id: 'targetLabel',
  afterDatasetsDraw(chart, _args, opts) {
    if (opts.value == null) return;
    const { ctx, chartArea, scales } = chart;
    const y = scales.y.getPixelForValue(opts.value);
    if (y < chartArea.top || y > chartArea.bottom) return;
    ctx.save();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = opts.color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(opts.text, chartArea.right - 4, y - 4);
    ctx.restore();
  },
};

function makeChart(canvas, config) {
  const c = new window.Chart(canvas, config);
  instances.push(c);
  return c;
}

/* ---------- 体重 ---------- */

function renderWeight(root, app) {
  const today = todayStr();
  const all = sortByDate(app.data.weights);
  const ma = movingAverage(all.map((w) => ({ date: w.date, value: w.weightKg })), 7);
  const inPeriod = filterByPeriod(all, state.period, today);
  const maIn = filterByPeriod(ma, state.period, today);
  const target = app.data.settings.targetWeightKg;

  if (!inPeriod.length) {
    root.append(emptyCard('体重の推移', 'この期間の体重記録がありません。'));
    return;
  }
  const t = theme();
  const xs = inPeriod.map((w) => dayIndex(w.date));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs, xMin + 1);
  const datasets = [
    {
      label: '体重', data: inPeriod.map((w) => ({ x: dayIndex(w.date), y: w.weightKg })),
      borderColor: t.s1, backgroundColor: t.s1, borderWidth: 1.5, pointRadius: 4, pointHoverRadius: 6,
      pointBorderColor: t.surface, pointBorderWidth: 2, tension: 0,
    },
    {
      label: '7日移動平均', data: maIn.map((p) => ({ x: dayIndex(p.date), y: p.value })),
      borderColor: t.s2, backgroundColor: t.s2, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.3,
    },
  ];
  if (target) {
    datasets.push({
      label: `目標 ${fmtNum(target)}kg`, data: [{ x: xMin, y: target }, { x: xMax, y: target }],
      borderColor: t.text, backgroundColor: t.text, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 0,
    });
  }
  const opts = baseOptions(t, { yTitle: 'kg' });
  opts.scales.y.grace = '8%';
  opts.scales.x.min = xMin;
  opts.scales.x.max = xMax;
  opts.plugins.targetLabel = target ? { value: target, text: `目標 ${fmtNum(target)}kg`, color: t.text } : {};
  opts.plugins.tooltip.filter = (item) => item.dataset.label !== datasets[2]?.label;
  opts.plugins.tooltip.callbacks.label = (item) => `${item.dataset.label}: ${fmtNum(item.parsed.y, 2)}kg`;

  const { card, canvas } = chartCard('体重の推移', '点は実測値、オレンジの線は 7 日移動平均です。');
  card.append(tableDetails(['日付', '体重(kg)', '7日平均(kg)', '体脂肪率(%)'],
    [...inPeriod].reverse().map((w) => {
      const m = ma.find((p) => p.date === w.date);
      return [fmtDateShort(w.date), fmtNum(w.weightKg), fmtNum(m?.value, 2), w.bodyFatPct != null ? fmtNum(w.bodyFatPct) : '-'];
    })));
  root.append(card);
  makeChart(canvas, { type: 'line', data: { datasets }, options: opts, plugins: [targetLabelPlugin] });

  // 体脂肪率（記録がある場合のみ）
  const bf = inPeriod.filter((w) => w.bodyFatPct != null);
  if (bf.length) {
    const c2 = chartCard('体脂肪率の推移');
    root.append(c2.card);
    const o2 = baseOptions(t, { yTitle: '%', legend: false });
    o2.scales.x.min = xMin;
    o2.scales.x.max = xMax;
    o2.plugins.tooltip.callbacks.label = (item) => `体脂肪率: ${fmtNum(item.parsed.y)}%`;
    makeChart(c2.canvas, {
      type: 'line',
      data: { datasets: [{ label: '体脂肪率', data: bf.map((w) => ({ x: dayIndex(w.date), y: w.bodyFatPct })), borderColor: t.s1, backgroundColor: t.s1, borderWidth: 2, pointRadius: 4, pointBorderColor: t.surface, pointBorderWidth: 2 }] },
      options: o2,
    });
  }
}

/* ---------- 筋トレ ---------- */

function renderStrength(root, app) {
  const used = [...new Set(app.data.strength.map((r) => r.exercise))];
  const choices = [...app.data.exercises.filter((e) => used.includes(e)), ...used.filter((e) => !app.data.exercises.includes(e))];
  if (!choices.length) {
    root.append(emptyCard('筋トレの推移', 'まだ筋トレの記録がありません。'));
    return;
  }
  if (!choices.includes(state.exercise)) state.exercise = choices[0];

  const select = h('select', { 'aria-label': '種目', onchange: (e) => { state.exercise = e.target.value; app.render(); } },
    choices.map((ex) => h('option', { value: ex, text: ex, selected: ex === state.exercise })),
  );
  root.append(h('div', { class: 'card card-compact' }, h('label', { class: 'field' }, h('span', { class: 'field-label', text: '種目' }), select)));

  const stats = filterByPeriod(dailyStrengthStats(app.data.strength, state.exercise), state.period, todayStr());
  if (!stats.length) {
    root.append(emptyCard(`${state.exercise} の推移`, 'この期間の記録がありません。'));
    return;
  }
  const t = theme();
  const xs = stats.map((s) => dayIndex(s.date));
  const opts = baseOptions(t, { yTitle: 'kg' });
  opts.scales.x.min = Math.min(...xs);
  opts.scales.x.max = Math.max(...xs, Math.min(...xs) + 1);
  opts.plugins.tooltip.callbacks.label = (item) => `${item.dataset.label}: ${fmtNum(item.parsed.y)}kg`;

  const { card, canvas } = chartCard(`${state.exercise} の推移`, '各日の最大重量と、推定 1RM（Epley 式）の最大値です。');
  card.append(tableDetails(['日付', '最大重量(kg)', '推定1RM(kg)'],
    [...stats].reverse().map((s) => [fmtDateShort(s.date), fmtNum(s.maxWeight), fmtNum(s.max1RM)])));
  root.append(card);
  makeChart(canvas, {
    type: 'line',
    data: {
      datasets: [
        { label: '最大重量', data: stats.map((s) => ({ x: dayIndex(s.date), y: s.maxWeight })), borderColor: t.s1, backgroundColor: t.s1, borderWidth: 2, pointRadius: 4, pointBorderColor: t.surface, pointBorderWidth: 2 },
        { label: '推定1RM', data: stats.map((s) => ({ x: dayIndex(s.date), y: s.max1RM })), borderColor: t.s2, backgroundColor: t.s2, borderWidth: 2, pointRadius: 4, pointBorderColor: t.surface, pointBorderWidth: 2 },
      ],
    },
    options: opts,
  });
}

/* ---------- ジョギング ---------- */

function renderJog(root, app) {
  const jogs = filterByPeriod(app.data.jogs, state.period, todayStr());
  if (!jogs.length) {
    root.append(emptyCard('ジョギングの推移', 'この期間のジョギング記録がありません。'));
    return;
  }
  const t = theme();
  const months = monthlyJogStats(jogs);
  const labels = months.map((m) => `${m.month.slice(0, 4)}/${Number(m.month.slice(5))}`);

  // 月別の合計距離（棒グラフ）
  const c1 = chartCard('月ごとの合計距離');
  root.append(c1.card);
  const o1 = baseOptions(t, { xIsDay: false, yTitle: 'km', legend: false });
  o1.interaction = { mode: 'index', intersect: false };
  o1.plugins.tooltip.callbacks.label = (item) => `合計距離: ${fmtNum(item.parsed.y, 1)}km`;
  o1.scales.y.beginAtZero = true;
  makeChart(c1.canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: '合計距離', data: months.map((m) => m.distanceKm), backgroundColor: t.s1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36, borderColor: t.surface, borderWidth: { left: 1, right: 1 } }] },
    options: o1,
  });

  // 月別の平均ペース（折れ線。上ほど速い）
  const c2 = chartCard('月ごとの平均ペース', '上にいくほど速いペースです（合計時間 ÷ 合計距離）。');
  c2.card.append(tableDetails(['月', '合計距離(km)', '平均ペース(/km)', '回数'],
    [...months].reverse().map((m) => [labels[months.indexOf(m)], fmtNum(m.distanceKm, 1), formatPace(m.paceSec), String(jogs.filter((j) => j.date.startsWith(m.month)).length)])));
  root.append(c2.card);
  const o2 = baseOptions(t, { xIsDay: false, yTitle: '分/km', reverseY: true, legend: false, yTick: (v) => formatPace(v) });
  o2.interaction = { mode: 'index', intersect: false };
  o2.plugins.tooltip.callbacks.label = (item) => `平均ペース: ${formatPace(item.parsed.y)}/km`;
  makeChart(c2.canvas, {
    type: 'line',
    data: { labels, datasets: [{ label: '平均ペース', data: months.map((m) => m.paceSec), borderColor: t.s1, backgroundColor: t.s1, borderWidth: 2, pointRadius: 4, pointBorderColor: t.surface, pointBorderWidth: 2 }] },
    options: o2,
  });
}

/* ---------- 食事・歩数 ---------- */

/** 日ごとの棒グラフ＋目安の水平線（破線） */
function dailyBarChart(root, t, title, note, items, valueKey, unit, line, lineLabel) {
  const data = items.filter((x) => x[valueKey] != null);
  if (!data.length) {
    root.append(emptyCard(title, 'この期間の記録がありません。'));
    return;
  }
  const labels = data.map((x) => { const [, m, d] = x.date.split('-').map(Number); return `${m}/${d}`; });
  const { card, canvas } = chartCard(title, note);
  card.append(tableDetails(['日付', `${title.replace('の推移', '')}(${unit})`],
    [...data].reverse().map((x) => [fmtDateShort(x.date), fmtInt(x[valueKey])])));
  root.append(card);
  const datasets = [{
    type: 'bar', label: title.replace('の推移', ''), data: data.map((x) => x[valueKey]),
    backgroundColor: t.s1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, order: 2,
  }];
  if (line) {
    datasets.push({
      type: 'line', label: lineLabel, data: data.map(() => line),
      borderColor: t.s2, backgroundColor: t.s2, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 0, order: 1,
    });
  }
  const opts = baseOptions(t, { xIsDay: false, yTitle: unit, legend: Boolean(line) });
  opts.interaction = { mode: 'index', intersect: false };
  opts.scales.y.beginAtZero = true;
  opts.scales.x.ticks.maxTicksLimit = 8;
  opts.scales.x.ticks.autoSkip = true;
  opts.plugins.tooltip.callbacks.label = (item) => `${item.dataset.label}: ${fmtInt(item.parsed.y)}${unit}`;
  makeChart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
}

function renderDaily(root, app) {
  const s = app.data.settings;
  const items = sortByDate(filterByPeriod(app.data.daily, state.period, todayStr()));
  const latest = latestWeight(app.data.weights);
  const plan = latest ? energyPlan({ ...s, weightKg: latest.weightKg, today: todayStr() }) : null;
  const kcalLine = plan ? (plan.intakeTarget ?? plan.tdee) : null;
  const kcalLabel = plan ? (plan.intakeTarget != null ? `摂取の目安 ${fmtInt(kcalLine)}kcal` : `消費の目安 ${fmtInt(kcalLine)}kcal`) : '';
  const t = theme();
  dailyBarChart(root, t, '摂取カロリーの推移',
    plan ? '破線は現在の体重から計算した 1 日の目安です。' : '設定で性別を入力すると、目安の線を表示します。',
    items, 'intakeKcal', 'kcal', kcalLine, kcalLabel);
  dailyBarChart(root, t, '歩数の推移', '破線は 1 日の歩数目標です。', items, 'steps', '歩', s.stepGoal, `目標 ${fmtInt(s.stepGoal)}歩`);
}
