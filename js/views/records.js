// 記録画面: 体重・筋トレ・ジョギングの入力、一覧、編集、削除
import { bmi, energyPlan, epley1RM, fmtInt, fmtNum, formatDuration, formatPace, latestWeight, paceSecPerKm, sortByDate, todayStr } from '../calc.js';
import { newId } from '../storage.js';
import { confirmDialog, field, fmtDateShort, h, segmented, toast } from '../ui.js';
import { afterSave } from '../hooks.js';

const TYPES = [['weight', '体重'], ['strength', '筋トレ'], ['jog', 'ジョギング'], ['daily', '食事・歩数']];
const LIST_KEY = { weight: 'weights', strength: 'strength', jog: 'jogs', daily: 'daily' };
const PAGE = 30;

// 画面をまたいで保持する状態
const state = { type: 'weight', editingId: null, shown: PAGE, lastExercise: null, presetDate: null };

export function render(root, app, params) {
  if (params.type) {
    state.type = params.type;
    state.editingId = null;
    state.shown = PAGE;
  }
  // カレンダーから「この日の記録を追加」で来たときは、その日付を初期値にする
  state.presetDate = params.date || null;
  if (params.editId) {
    state.type = params.type || state.type;
    state.editingId = params.editId;
  }

  root.append(
    segmented(TYPES, state.type, (t) => {
      state.type = t;
      state.editingId = null;
      state.shown = PAGE;
      app.render();
    }, '記録の種類'),
  );

  const list = app.data[LIST_KEY[state.type]];
  const editing = state.editingId ? list.find((x) => x.id === state.editingId) : null;
  if (state.editingId && !editing) state.editingId = null;

  const form = state.type === 'weight' ? weightForm(app, editing)
    : state.type === 'strength' ? strengthForm(app, editing)
      : state.type === 'jog' ? jogForm(app, editing)
        : dailyForm(app, editing);
  root.append(h('section', { class: 'card' + (editing ? ' editing' : '') },
    h('h2', { class: 'card-title', text: editing ? `記録を編集（${fmtDateShort(editing.date)}）` : '新しい記録' }),
    form,
  ));

  root.append(listSection(app, list));
}

/* ---------- 共通 ---------- */

function dateInput(value) {
  return h('input', { type: 'date', name: 'date', required: true, value: value || state.presetDate || todayStr(), max: todayStr() });
}

function numberInput(name, value, { step = '0.1', min = '0', placeholder = '', required = false, inputmode = 'decimal' } = {}) {
  return h('input', {
    type: 'number', name, step, min, placeholder, inputmode, required,
    value: value == null ? '' : String(value),
  });
}

function memoInput(value) {
  return h('input', { type: 'text', name: 'memo', value: value || '', placeholder: '任意', maxlength: '200' });
}

function formActions(app, editing, kind) {
  return h('div', { class: 'form-actions' },
    h('button', { type: 'submit', class: 'btn btn-primary btn-lg', text: editing ? '更新する' : '保存する' }),
    editing ? h('button', {
      type: 'button', class: 'btn', text: 'キャンセル',
      onclick: () => { state.editingId = null; app.render(); },
    }) : null,
    editing ? h('button', {
      type: 'button', class: 'btn btn-danger', text: '削除',
      onclick: () => removeRecord(app, kind, editing),
    }) : null,
  );
}

async function removeRecord(app, kind, rec) {
  const ok = await confirmDialog(`${fmtDateShort(rec.date)} の${labelOf(kind)}記録を削除します。\nこの操作は元に戻せません。`, { okText: '削除する', danger: true });
  if (!ok) return;
  state.editingId = null;
  app.update((d) => {
    d[LIST_KEY[kind]] = d[LIST_KEY[kind]].filter((x) => x.id !== rec.id);
  });
  toast('削除しました');
}

function labelOf(kind) {
  return TYPES.find(([k]) => k === kind)[1];
}

/** 保存の共通処理: 追加 or 更新して、後処理（自己ベスト判定など）を呼ぶ */
function commit(app, kind, rec, editing) {
  const key = LIST_KEY[kind];
  state.editingId = null;
  app.update((d) => {
    if (editing) d[key] = d[key].map((x) => (x.id === rec.id ? rec : x));
    else d[key].push(rec);
  });
  const handled = afterSave(app, kind, rec, Boolean(editing));
  if (!handled) toast(editing ? '更新しました' : '保存しました');
}

/* ---------- 体重 ---------- */

function weightForm(app, editing) {
  const { heightCm } = app.data.settings;
  const bmiOut = h('output', { class: 'live' });
  const weight = numberInput('weightKg', editing?.weightKg, { placeholder: '例: 70.5', required: true, min: '20' });
  const updateBmi = () => {
    const v = bmi(Number(weight.value), heightCm);
    bmiOut.textContent = !heightCm ? '設定で身長を入れると、BMI を自動で計算します'
      : v ? `BMI ${v}（身長 ${heightCm}cm で計算）` : `BMI は身長 ${heightCm}cm で自動計算します`;
  };
  weight.addEventListener('input', updateBmi);
  updateBmi();

  const form = h('form', { class: 'form', novalidate: true },
    field('日付', dateInput(editing?.date)),
    field('体重 (kg)', weight),
    bmiOut,
    field('体脂肪率 (%)', numberInput('bodyFatPct', editing?.bodyFatPct, { placeholder: '任意', max: '80' })),
    field('メモ', memoInput(editing?.memo)),
    formActions(app, editing, 'weight'),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const date = f.get('date');
    const weightKg = Number(f.get('weightKg'));
    const bf = f.get('bodyFatPct') === '' ? null : Number(f.get('bodyFatPct'));
    if (!date) return toast('日付を入力してください');
    if (date > todayStr()) return toast('未来の日付は入力できません');
    if (!(weightKg >= 20 && weightKg <= 300)) return toast('体重は 20〜300kg の範囲で入力してください');
    if (bf != null && !(bf > 0 && bf < 80)) return toast('体脂肪率は 0〜80% の範囲で入力してください');

    // 1 日 1 件: 同じ日付の別の記録があれば上書きを確認する
    const dup = app.data.weights.find((x) => x.date === date && x.id !== editing?.id);
    if (dup) {
      const ok = await confirmDialog(`${fmtDateShort(date)} の体重はすでに記録されています（${fmtNum(dup.weightKg)}kg）。\n上書きしますか？`, { okText: '上書きする' });
      if (!ok) return;
      app.data.weights = app.data.weights.filter((x) => x.id !== dup.id);
    }
    const rec = { id: editing?.id || newId(), date, weightKg, bodyFatPct: bf, memo: String(f.get('memo') || '').trim() };
    commit(app, 'weight', rec, editing);
  });
  return form;
}

/* ---------- 筋トレ ---------- */

function strengthForm(app, editing) {
  const exercises = app.data.exercises;
  const selected = editing?.exercise || state.lastExercise || exercises[0];
  const options = exercises.includes(selected) || !selected ? exercises : [selected, ...exercises];
  const select = h('select', { name: 'exercise', required: true },
    options.map((ex) => h('option', { value: ex, text: ex, selected: ex === selected })),
  );
  const weight = numberInput('weightKg', editing?.weightKg, { step: '0.5', placeholder: '例: 60', required: true });
  const reps = numberInput('reps', editing?.reps, { step: '1', min: '1', placeholder: '例: 10', required: true, inputmode: 'numeric' });
  const sets = numberInput('sets', editing?.sets ?? 3, { step: '1', min: '1', placeholder: '例: 3', required: true, inputmode: 'numeric' });
  const ormOut = h('output', { class: 'live' });
  const updateOrm = () => {
    const v = epley1RM(Number(weight.value), Number(reps.value));
    ormOut.textContent = v ? `推定 1RM ${fmtNum(v)}kg（Epley 式）` : '推定 1RM は重量と回数から自動計算します';
  };
  weight.addEventListener('input', updateOrm);
  reps.addEventListener('input', updateOrm);
  updateOrm();

  const form = h('form', { class: 'form', novalidate: true },
    field('日付', dateInput(editing?.date)),
    exercises.length ? field('種目', select) : h('p', { class: 'notice', text: '種目がありません。設定画面で種目を追加してください。' }),
    h('div', { class: 'row-3' },
      field('重量 (kg)', weight),
      field('回数', reps),
      field('セット数', sets),
    ),
    ormOut,
    field('メモ', memoInput(editing?.memo)),
    formActions(app, editing, 'strength'),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const rec = {
      id: editing?.id || newId(),
      date: f.get('date'),
      exercise: String(f.get('exercise') || '').trim(),
      weightKg: Number(f.get('weightKg')),
      reps: Math.round(Number(f.get('reps'))),
      sets: Math.round(Number(f.get('sets'))),
      memo: String(f.get('memo') || '').trim(),
    };
    if (!rec.date) return toast('日付を入力してください');
    if (rec.date > todayStr()) return toast('未来の日付は入力できません');
    if (!rec.exercise) return toast('種目を選んでください');
    if (!(rec.weightKg > 0 && rec.weightKg <= 500)) return toast('重量は 0〜500kg の範囲で入力してください');
    if (!(rec.reps >= 1 && rec.reps <= 100)) return toast('回数は 1〜100 で入力してください');
    if (!(rec.sets >= 1 && rec.sets <= 50)) return toast('セット数は 1〜50 で入力してください');
    state.lastExercise = rec.exercise;
    commit(app, 'strength', rec, editing);
  });
  return form;
}

/* ---------- ジョギング ---------- */

function jogForm(app, editing) {
  const dur = editing?.durationSec;
  const distance = numberInput('distanceKm', editing?.distanceKm, { step: '0.01', placeholder: '例: 5.0', required: true });
  const min = numberInput('min', dur != null ? Math.floor(dur / 60) : '', { step: '1', placeholder: '分', required: true, inputmode: 'numeric' });
  const sec = numberInput('sec', dur != null ? dur % 60 : '', { step: '1', max: '59', placeholder: '秒', inputmode: 'numeric' });
  const paceOut = h('output', { class: 'live' });
  const updatePace = () => {
    const total = Number(min.value || 0) * 60 + Number(sec.value || 0);
    const p = paceSecPerKm(total, Number(distance.value));
    paceOut.textContent = p ? `ペース ${formatPace(p)} /km` : 'ペースは距離と時間から自動計算します';
  };
  [distance, min, sec].forEach((el) => el.addEventListener('input', updatePace));
  updatePace();

  const form = h('form', { class: 'form', novalidate: true },
    field('日付', dateInput(editing?.date)),
    field('距離 (km)', distance),
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: '時間' }),
      h('div', { class: 'time-inputs' },
        min, h('span', { class: 'unit', text: '分' }), sec, h('span', { class: 'unit', text: '秒' }),
      ),
    ),
    paceOut,
    field('メモ', memoInput(editing?.memo)),
    formActions(app, editing, 'jog'),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const m = Number(f.get('min') || 0);
    const s = Number(f.get('sec') || 0);
    const rec = {
      id: editing?.id || newId(),
      date: f.get('date'),
      distanceKm: Number(f.get('distanceKm')),
      durationSec: Math.round(m * 60 + s),
      memo: String(f.get('memo') || '').trim(),
    };
    if (!rec.date) return toast('日付を入力してください');
    if (rec.date > todayStr()) return toast('未来の日付は入力できません');
    if (!(rec.distanceKm > 0 && rec.distanceKm <= 300)) return toast('距離は 0〜300km の範囲で入力してください');
    if (!(s >= 0 && s < 60)) return toast('秒は 0〜59 で入力してください');
    if (!(rec.durationSec > 0)) return toast('時間を入力してください');
    commit(app, 'jog', rec, editing);
  });
  return form;
}

/* ---------- 食事・歩数 ---------- */

function dailyForm(app, editing) {
  const s = app.data.settings;
  const latest = latestWeight(app.data.weights);
  const plan = latest ? energyPlan({ ...s, weightKg: latest.weightKg, today: todayStr() }) : null;
  const kcal = numberInput('intakeKcal', editing?.intakeKcal, { step: '1', min: '0', placeholder: '例: 1800', inputmode: 'numeric' });
  const steps = numberInput('steps', editing?.steps, { step: '1', min: '0', placeholder: '例: 8000', inputmode: 'numeric' });
  const out = h('output', { class: 'live' });
  const update = () => {
    const parts = [];
    const target = plan?.intakeTarget ?? plan?.tdee;
    if (target) {
      const k = Number(kcal.value);
      parts.push(k > 0 ? `摂取 ${fmtInt(k)} / 目安 ${fmtInt(target)}kcal（${k <= target ? `あと ${fmtInt(target - k)}` : `${fmtInt(k - target)} 超過`}）` : `摂取の目安 ${fmtInt(target)}kcal`);
    } else {
      parts.push('設定で性別を入れると、摂取の目安を表示します');
    }
    const st = Number(steps.value);
    if (st > 0) parts.push(`歩数 目標 ${fmtInt(s.stepGoal)} 歩の ${Math.round((st / s.stepGoal) * 100)}%`);
    out.textContent = parts.join('　');
  };
  kcal.addEventListener('input', update);
  steps.addEventListener('input', update);
  update();

  const form = h('form', { class: 'form', novalidate: true },
    field('日付', dateInput(editing?.date)),
    h('div', { class: 'row-2' },
      field('摂取カロリー (kcal)', kcal, '1 日の合計'),
      field('歩数', steps),
    ),
    out,
    field('メモ', memoInput(editing?.memo)),
    formActions(app, editing, 'daily'),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const date = f.get('date');
    const k = f.get('intakeKcal') === '' ? null : Math.round(Number(f.get('intakeKcal')));
    const st = f.get('steps') === '' ? null : Math.round(Number(f.get('steps')));
    if (!date) return toast('日付を入力してください');
    if (date > todayStr()) return toast('未来の日付は入力できません');
    if (k == null && st == null) return toast('摂取カロリーか歩数のどちらかを入力してください');
    if (k != null && !(k > 0 && k <= 10000)) return toast('摂取カロリーは 1〜10,000kcal で入力してください');
    if (st != null && !(st >= 0 && st <= 100000)) return toast('歩数は 0〜100,000 歩で入力してください');

    const dup = app.data.daily.find((x) => x.date === date && x.id !== editing?.id);
    if (dup) {
      const ok = await confirmDialog(`${fmtDateShort(date)} の食事・歩数はすでに記録されています。
上書きしますか？`, { okText: '上書きする' });
      if (!ok) return;
      app.data.daily = app.data.daily.filter((x) => x.id !== dup.id);
    }
    const rec = { id: editing?.id || newId(), date, intakeKcal: k, steps: st, memo: String(f.get('memo') || '').trim() };
    commit(app, 'daily', rec, editing);
  });
  return form;
}

/* ---------- 一覧 ---------- */

function listSection(app, list) {
  const sorted = sortByDate(list).reverse();
  const section = h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: `${labelOf(state.type)}の記録一覧（${list.length}件）` }),
  );
  if (!sorted.length) {
    section.append(h('p', { class: 'empty', text: 'まだ記録がありません。' }));
    return section;
  }
  const ul = h('ul', { class: 'record-list' });
  for (const rec of sorted.slice(0, state.shown)) {
    ul.append(h('li', {},
      h('button', {
        type: 'button', class: 'record-item' + (rec.id === state.editingId ? ' active' : ''),
        'aria-label': `${fmtDateShort(rec.date)} の記録を編集`,
        onclick: () => {
          state.editingId = rec.id;
          app.render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
      },
      h('span', { class: 'record-date', text: fmtDateShort(rec.date) }),
      h('span', { class: 'record-main' }, ...describe(app, rec)),
      ),
    ));
  }
  section.append(ul);
  if (sorted.length > state.shown) {
    section.append(h('button', {
      type: 'button', class: 'btn btn-block', text: `さらに表示（残り ${sorted.length - state.shown} 件）`,
      onclick: () => { state.shown += PAGE; app.render(); },
    }));
  }
  return section;
}

function describe(app, rec) {
  const memo = rec.memo ? h('span', { class: 'record-memo', text: rec.memo }) : null;
  if (state.type === 'weight') {
    const b = bmi(rec.weightKg, app.data.settings.heightCm);
    return [
      h('strong', { text: `${fmtNum(rec.weightKg)}kg` }),
      h('span', { class: 'record-sub', text: [rec.bodyFatPct != null ? `体脂肪 ${fmtNum(rec.bodyFatPct)}%` : null, b ? `BMI ${b}` : null].filter(Boolean).join('　') }),
      memo,
    ];
  }
  if (state.type === 'strength') {
    return [
      h('strong', { text: rec.exercise }),
      h('span', { class: 'record-sub', text: `${fmtNum(rec.weightKg)}kg × ${rec.reps}回 × ${rec.sets}セット　1RM ${fmtNum(epley1RM(rec.weightKg, rec.reps))}kg` }),
      memo,
    ];
  }
  if (state.type === 'daily') {
    return [
      h('strong', { text: [rec.intakeKcal != null ? `${fmtInt(rec.intakeKcal)}kcal` : null, rec.steps != null ? `${fmtInt(rec.steps)}歩` : null].filter(Boolean).join('　') }),
      memo,
    ];
  }
  return [
    h('strong', { text: `${fmtNum(rec.distanceKm, 2)}km` }),
    h('span', { class: 'record-sub', text: `${formatDuration(rec.durationSec)}　${formatPace(paceSecPerKm(rec.durationSec, rec.distanceKm))}/km` }),
    memo,
  ];
}
