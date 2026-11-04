// 設定画面: プロフィール・目標、種目、データの入出力、危険な操作
import { ACTIVITY_LEVELS, daysBetween, todayStr } from '../calc.js';
import { defaultData, exportCSV, exportJSON, normalize } from '../storage.js';
import { generateSample } from '../sample.js';
import { confirmDialog, field, fmtDateLong, h, toast } from '../ui.js';

const BACKUP_REMIND_DAYS = 14;

export function render(root, app) {
  root.append(profileCard(app), exerciseCard(app), dataCard(app), dangerCard(app), aboutCard());
}

/* ---------- プロフィール・目標 ---------- */

function profileCard(app) {
  const s = app.data.settings;
  const n = (name, value, attrs = {}) => h('input', { type: 'number', name, value: value == null ? '' : String(value), inputmode: 'decimal', ...attrs });
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'row-2' },
      field('身長 (cm)', n('heightCm', s.heightCm, { step: '0.1', min: '100', max: '250', required: true })),
      field('年齢', n('age', s.age, { step: '1', min: '1', max: '120', inputmode: 'numeric', required: true })),
    ),
    h('div', { class: 'row-2' },
      field('目標体重 (kg)', n('targetWeightKg', s.targetWeightKg, { step: '0.1', min: '20', max: '300', placeholder: '未設定' })),
      field('目標達成日', h('input', { type: 'date', name: 'targetDate', value: s.targetDate || '' }), '任意'),
    ),
    h('div', { class: 'row-2' },
      field('週の運動目標日数',
        h('select', { name: 'weeklyGoalDays' },
          [1, 2, 3, 4, 5, 6, 7].map((d) => h('option', { value: String(d), text: `週 ${d} 日`, selected: d === s.weeklyGoalDays })),
        ),
      ),
      field('1 日の歩数目標', n('stepGoal', s.stepGoal, { step: '500', min: '1000', max: '50000', inputmode: 'numeric' })),
    ),
    h('p', { class: 'card-note', text: '以下は基礎代謝とカロリーの目安の計算に使います。' }),
    h('div', { class: 'row-2' },
      field('性別',
        h('select', { name: 'sex' },
          [['', '未設定'], ['male', '男性'], ['female', '女性']].map(([v, l]) => h('option', { value: v, text: l, selected: (s.sex || '') === v })),
        ),
      ),
      field('活動レベル',
        h('select', { name: 'activityLevel' },
          ACTIVITY_LEVELS.map(([v, l]) => h('option', { value: v, text: l.replace(/（.*）/, ''), selected: s.activityLevel === v })),
        ),
      ),
    ),
    h('ul', { class: 'level-help' }, ACTIVITY_LEVELS.map(([, l]) => h('li', { text: l }))),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary btn-lg', text: '設定を保存' })),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const heightCm = Number(f.get('heightCm'));
    const age = Number(f.get('age'));
    const tw = f.get('targetWeightKg') === '' ? null : Number(f.get('targetWeightKg'));
    const td = f.get('targetDate') || null;
    if (!(heightCm >= 100 && heightCm <= 250)) return toast('身長は 100〜250cm で入力してください');
    if (!(age >= 1 && age <= 120)) return toast('年齢は 1〜120 で入力してください');
    if (tw != null && !(tw >= 20 && tw <= 300)) return toast('目標体重は 20〜300kg で入力してください');
    if (td && td <= todayStr()) return toast('目標達成日は明日以降の日付を入力してください');
    const stepGoal = Math.round(Number(f.get('stepGoal')));
    if (!(stepGoal >= 1000 && stepGoal <= 50000)) return toast('歩数目標は 1,000〜50,000 歩で入力してください');
    app.update((d) => {
      Object.assign(d.settings, {
        heightCm, age, targetWeightKg: tw, targetDate: td, weeklyGoalDays: Number(f.get('weeklyGoalDays')),
        stepGoal, sex: f.get('sex') || null, activityLevel: f.get('activityLevel') || 'normal',
      });
    });
    toast('設定を保存しました');
  });
  return h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'プロフィール・目標' }), form);
}

/* ---------- 種目 ---------- */

function exerciseCard(app) {
  const list = h('ul', { class: 'chip-list' },
    app.data.exercises.map((ex) => h('li', { class: 'chip' },
      h('span', { text: ex }),
      h('button', {
        type: 'button', class: 'chip-del', 'aria-label': `${ex} を削除`, text: '×',
        onclick: async () => {
          const count = app.data.strength.filter((r) => r.exercise === ex).length;
          const msg = count
            ? `「${ex}」を種目の選択肢から削除します。\nこれまでの記録（${count}件）は残り、グラフにも表示されます。`
            : `「${ex}」を種目の選択肢から削除します。`;
          if (!(await confirmDialog(msg, { okText: '削除する', danger: true }))) return;
          app.update((d) => { d.exercises = d.exercises.filter((x) => x !== ex); });
          toast(`「${ex}」を削除しました`);
        },
      }),
    )),
  );
  const input = h('input', { type: 'text', name: 'exercise', placeholder: '例: レッグプレス', maxlength: '30' });
  const form = h('form', { class: 'inline-form', novalidate: true },
    input,
    h('button', { type: 'submit', class: 'btn btn-primary', text: '追加' }),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return toast('種目名を入力してください');
    if (app.data.exercises.includes(name)) return toast('同じ名前の種目があります');
    app.update((d) => { d.exercises.push(name); });
    toast(`「${name}」を追加しました`);
  });
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: '筋トレの種目' }),
    list,
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '種目を追加' }), form),
  );
}

/* ---------- データの入出力 ---------- */

function dataCard(app) {
  const last = app.data.settings.lastExportAt;
  const total = app.data.weights.length + app.data.strength.length + app.data.jogs.length;
  const days = last ? daysBetween(last.slice(0, 10), todayStr()) : null;
  const remind = total > 0 && (days == null || days >= BACKUP_REMIND_DAYS);

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', 'aria-label': 'バックアップファイルを選ぶ' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let next;
    try {
      next = normalize(JSON.parse(await file.text()));
    } catch (err) {
      toast(`読み込めませんでした: ${err.message}`);
      return;
    }
    const n = next.weights.length + next.strength.length + next.jogs.length;
    const ok = await confirmDialog(
      `「${file.name}」の記録 ${n} 件を読み込みます。\n今のデータ（${total} 件）はすべて置き換わります。`,
      { okText: '読み込む', danger: true },
    );
    if (!ok) return;
    app.replaceData(next);
    toast('読み込みました');
  });

  return h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: 'データのバックアップ' }),
    h('p', { class: 'card-note', text: 'データはこの端末のブラウザ内にだけ保存されています。機種変更や PC への受け渡しには JSON を使ってください。' }),
    h('p', { class: remind ? 'notice notice-warn' : 'card-note' },
      last ? `最後にエクスポートした日: ${fmtDateLong(last.slice(0, 10))}（${days}日前）` : 'まだエクスポートしていません。',
      remind ? '　定期的なバックアップをおすすめします。' : '',
    ),
    h('div', { class: 'btn-grid' },
      h('button', {
        type: 'button', class: 'btn btn-primary', text: 'JSON でエクスポート',
        onclick: () => {
          app.update((d) => { d.settings.lastExportAt = new Date().toISOString(); });
          exportJSON(app.data);
          toast('エクスポートしました');
        },
      }),
      h('button', { type: 'button', class: 'btn', text: 'JSON をインポート', onclick: () => fileInput.click() }),
      h('button', { type: 'button', class: 'btn', text: 'CSV で出力', onclick: () => { exportCSV(app.data); toast('CSV を出力しました'); } }),
    ),
    fileInput,
  );
}

/* ---------- 危険な操作 ---------- */

function dangerCard(app) {
  return h('details', { class: 'card danger-zone' },
    h('summary', { text: '危険な操作（サンプルデータ・全削除）' }),
    h('p', { class: 'card-note', text: 'ここでの操作は元に戻せません。必要に応じて先にエクスポートしてください。' }),
    h('div', { class: 'btn-grid' },
      h('button', {
        type: 'button', class: 'btn', text: 'サンプルデータを生成',
        onclick: async () => {
          const ok = await confirmDialog('動作確認用に、約 3 か月分のサンプルデータを作ります。\n今の記録はすべてサンプルに置き換わります（設定は残ります）。', { okText: '生成する', danger: true });
          if (!ok) return;
          const sample = generateSample(todayStr());
          app.replaceData({
            ...sample,
            settings: { ...app.data.settings, targetWeightKg: app.data.settings.targetWeightKg ?? sample.settings.targetWeightKg },
            exercises: [...new Set([...app.data.exercises, ...sample.exercises])],
          });
          toast('サンプルデータを生成しました');
        },
      }),
      h('button', {
        type: 'button', class: 'btn btn-danger', text: 'すべてのデータを削除',
        onclick: async () => {
          const ok = await confirmDialog('すべての記録と設定を削除し、初期状態に戻します。\nこの操作は元に戻せません。', { title: '全データの削除', okText: 'すべて削除する', danger: true });
          if (!ok) return;
          app.replaceData(defaultData());
          toast('すべてのデータを削除しました');
        },
      }),
    ),
  );
}

function aboutCard() {
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: 'このアプリについて' }),
    h('p', { class: 'card-note', text: `fitlog バージョン ${self.APP_VERSION || '-'}` }),
    h('p', { class: 'card-note', text: '記録はサーバーに送信されません。グラフは Chart.js（MIT License）、紙吹雪は canvas-confetti（ISC License）を使用しています。' }),
  );
}
