// 設定画面: プロフィール・目標、種目、データの入出力、危険な操作
import { ACTIVITY_LEVELS, daysBetween, todayStr } from '../calc.js';
import { defaultData, exportCSV, exportJSON, normalize } from '../storage.js';
import { generateSample } from '../sample.js';
import { clearAllTasks, clearDoneTasks, countDoneTasks, exportTasksJSON, loadTasks } from './home-tasks.js';
import { choiceDialog, confirmDialog, field, fmtDateLong, h, toast } from '../ui.js';
import * as cloud from '../cloud.js';

const BACKUP_REMIND_DAYS = 14;
const TASK_IMPORT_KEY = 's-task-import'; // タスク画面へ渡すインポート用ファイル（sessionStorage）
const TASK_IMPORT_MAX = 4 * 1024 * 1024; // sessionStorage に収まる大きさ（目安）

let unsubscribeCloud = null;

export function unmount() {
  if (unsubscribeCloud) { unsubscribeCloud(); unsubscribeCloud = null; }
}

export function render(root, app) {
  root.append(cloudCard(app), profileCard(app), exerciseCard(app), lockCard(app), dataCard(app), taskDataCard(app), dangerCard(app), aboutCard());
}

/* ---------- 記録の保存先（GitHub の非公開リポジトリ。js/cloud.js） ---------- */

function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function countOf(data) {
  return (data.weights?.length || 0) + (data.strength?.length || 0) + (data.jogs?.length || 0) + (data.daily?.length || 0);
}

function cloudCard(app) {
  const card = h('section', { class: 'card', id: 'cloud-card' },
    h('h2', { class: 'card-title', text: '記録の保存先（GitHub）' }),
  );
  const cfg = cloud.getConfig();

  if (!cfg) {
    const user = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : 'ユーザー名';
    const repo = h('input', { type: 'text', value: `${user}/stride-backup`, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
    const token = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
    const pass = h('input', { type: 'password', placeholder: '8 文字以上', autocomplete: 'new-password' });
    const pass2 = h('input', { type: 'password', placeholder: 'もう一度', autocomplete: 'new-password' });
    const withTasks = h('input', { type: 'checkbox' });
    const go = h('button', { type: 'button', class: 'btn btn-primary btn-block', text: '接続して保存を始める' });

    go.addEventListener('click', async () => {
      if (!repo.value.trim().includes('/')) return toast('リポジトリは「ユーザー名/リポジトリ名」で入力してください');
      if (!token.value.trim()) return toast('トークンを入力してください');
      if (pass.value.length < 8) return toast('合言葉は 8 文字以上にしてください');
      if (pass.value !== pass2.value) return toast('合言葉（確認）が一致しません');
      if (withTasks.checked) {
        const ok = await confirmDialog('タスクも暗号化して GitHub に保存します。\nお客様情報を含むタスクを外部に保存してよいかは、会社の規定を確認してください。', { title: 'タスクも保存する', okText: '保存する' });
        if (!ok) return;
      }
      go.disabled = true;
      go.textContent = '確認しています…';
      try {
        const found = await cloud.inspect({ repo: repo.value, token: token.value, passphrase: pass.value });
        const local = app.data;
        let mode = 'local';
        if (found.remoteRecords) {
          const choice = await choiceDialog(
            `GitHub に記録があります（${countOf(found.remoteRecords)} 件、${fmtDateTime(found.remoteSavedAt)} 保存）。\nこの端末の記録は ${countOf(local)} 件です。どうしますか？`,
            {
              title: 'GitHub の記録',
              choices: [
                { value: 'remote', label: 'GitHub の記録を使う（この端末の記録は置き換え）', kind: countOf(local) ? '' : 'primary' },
                { value: 'merge', label: '両方を合わせる', kind: countOf(local) ? 'primary' : '' },
                { value: 'local', label: 'この端末の記録で GitHub を上書きする', kind: 'danger' },
              ],
            },
          );
          if (!choice) throw new Error('キャンセルしました');
          mode = choice;
        }
        let restoreTasks = false;
        if (found.remoteTasks && Array.isArray(found.remoteTasks.tasks) && found.remoteTasks.tasks.length) {
          const localTasks = loadTasks() || [];
          restoreTasks = await confirmDialog(
            `GitHub にタスクのバックアップがあります（${found.remoteTasks.tasks.length} 件）。この端末に戻しますか？${localTasks.length ? `\nこの端末のタスク（${localTasks.length} 件）は置き換わります。` : ''}`,
            { title: 'タスクのバックアップ', okText: '戻す', cancelText: '戻さない' },
          );
        }
        const st = await cloud.connect(found, { includeTasks: withTasks.checked, mode, restoreTasks });
        toast(st.status === 'ok' ? 'GitHub への保存を始めました' : `接続しました（${st.label}）`);
        app.render();
      } catch (e) {
        toast(e.message === 'キャンセルしました' ? 'キャンセルしました'
          : e.status === 401 ? 'トークンが正しくありません'
            : e.status === 404 ? 'リポジトリが見つかりません（名前と、トークンの対象リポジトリを確認してください）'
              : e instanceof TypeError ? '通信できませんでした。電波を確認してください'
                : (e.message || '接続できませんでした'));
        go.disabled = false;
        go.textContent = '接続して保存を始める';
      }
    });

    card.append(
      h('p', { class: 'notice notice-warn', text: '⚠ 未設定：記録はこの端末の中にしかありません。ホーム画面のアイコンを削除すると記録も消えます。' }),
      h('p', { class: 'card-note', text: '記録を暗号化して、あなたの GitHub の非公開リポジトリに自動で保存します。アプリを入れ直しても、PC からでも、同じ記録を使えます。' }),
      h('ol', { class: 'cloud-steps' },
        h('li', {}, 'GitHub で ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener', text: 'トークンを作る' }), '（Fine-grained token）。対象リポジトリは「stride-backup だけ」、権限は「Contents：Read and write」、期限は 1 年まで'),
        h('li', { text: '下の欄にリポジトリ名・トークン・合言葉を入れて「接続して保存を始める」を押す' }),
        h('li', { text: '合言葉は忘れないように控えておく（忘れると GitHub の記録を開けません）' }),
      ),
      h('div', { class: 'form' },
        field('リポジトリ（ユーザー名/リポジトリ名）', repo),
        field('トークン', token, 'この端末にだけ保存されます'),
        h('div', { class: 'row-2' }, field('合言葉', pass), field('合言葉（確認）', pass2)),
        h('label', { class: 'check-row' }, withTasks, h('span', { text: 'タスクも暗号化して保存する（お客様情報を含む場合は会社の規定を確認）' })),
        go,
      ),
    );
    return card;
  }

  // ---- 接続済み ----
  const statusRow = h('p', { class: 'cloud-status' }, h('span', { class: 'dot' }), h('span', { class: 'label' }));
  const detail = h('p', { class: 'card-note' });
  const errorRow = h('p', { class: 'notice notice-warn', hidden: true });
  unsubscribeCloud = cloud.onStatus((s) => {
    statusRow.dataset.status = s.status;
    statusRow.querySelector('.label').textContent = `GitHub に保存：${s.label}`;
    detail.textContent = `最後に同期：${fmtDateTime(s.lastSyncAt)}　／　リポジトリ：${cfg.repo}`;
    errorRow.hidden = !s.lastError;
    errorRow.textContent = s.lastError ? `⚠ ${s.lastError}` : '';
  });

  const withTasks = h('input', { type: 'checkbox', checked: Boolean(cfg.includeTasks) });
  withTasks.addEventListener('change', async () => {
    if (withTasks.checked) {
      const ok = await confirmDialog('タスクも暗号化して GitHub に保存します。\nお客様情報を含むタスクを外部に保存してよいかは、会社の規定を確認してください。', { title: 'タスクも保存する', okText: '保存する' });
      if (!ok) { withTasks.checked = false; return; }
    }
    cloud.setIncludeTasks(withTasks.checked);
    toast(withTasks.checked ? 'タスクも GitHub に保存します' : 'タスクは GitHub に保存しません（これまでの分は GitHub に残ります）');
  });

  card.append(
    statusRow, detail, errorRow,
    h('p', { class: 'card-note', text: '記録を変えると数秒後に暗号化して保存します。電波がないときは、つながったときに送ります。' }),
    h('label', { class: 'check-row' }, withTasks, h('span', { text: 'タスクも暗号化して保存する' })),
    h('div', { class: 'btn-grid' },
      h('button', {
        type: 'button', class: 'btn btn-primary', text: '今すぐ同期',
        onclick: async () => {
          const s = await cloud.syncNow();
          toast(s.status === 'ok' ? '同期しました' : s.lastError || s.label);
        },
      }),
      h('button', {
        type: 'button', class: 'btn btn-danger', text: 'この端末の接続を解除',
        onclick: async () => {
          const ok = await confirmDialog('この端末のトークンと合言葉の鍵を消して、GitHub への保存をやめます。\nGitHub の記録と、この端末の記録はどちらも残ります。', { title: '接続の解除', okText: '解除する', danger: true });
          if (!ok) return;
          cloud.disconnect();
          toast('接続を解除しました');
          app.render();
        },
      }),
    ),
  );
  return card;
}

/* ---------- タスクのデータ（タスク画面の「バックアップ・補助操作」を移したもの） ---------- */

/** タスク画面を開いて、Task Board 本体の機能（CSV・予定表など）を実行する */
function runOnTaskPage(action) {
  location.href = `./tasks/#do=${action}`;
}

function taskDataCard(app) {
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', 'aria-label': 'タスクのバックアップファイルを選ぶ' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > TASK_IMPORT_MAX) {
      toast('ファイルが大きすぎます（4MB まで）');
      return;
    }
    try {
      sessionStorage.setItem(TASK_IMPORT_KEY, JSON.stringify({ name: file.name, type: file.type || 'application/json', text: await file.text() }));
    } catch (_) {
      toast('ファイルを読み込めませんでした');
      return;
    }
    // 中身の確認と置き換えの確認は、タスク画面（Task Board 本体）で行う
    runOnTaskPage('import');
  });

  const tasks = loadTasks();
  const count = tasks === null ? '-' : tasks.length;
  const btn = (text, onclick, cls = 'btn') => h('button', { type: 'button', class: cls, text, onclick });

  return h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: 'タスクのデータ' }),
    h('p', { class: 'card-note', text: `タスク ${count} 件。タスクのデータもこの端末の中だけに保存されています。機種変更や PC への受け渡しには JSON を使ってください。` }),
    h('div', { class: 'btn-grid' },
      btn('JSON をエクスポート', () => {
        const n = exportTasksJSON();
        toast(n === null ? 'タスクのデータを読み取れませんでした' : `タスク ${n} 件をエクスポートしました`);
      }, 'btn btn-primary'),
      btn('JSON をインポート', () => fileInput.click()),
      btn('CSV（Excel）で出力', () => runOnTaskPage('csv')),
      btn('予定表（.ics）で出力', () => runOnTaskPage('ics')),
      btn('テンプレートの管理', () => runOnTaskPage('templates')),
      btn('サンプルタスクを追加', () => runOnTaskPage('sample')),
      btn('完了したタスクを削除', async () => {
        const done = countDoneTasks();
        if (done === null) return toast('タスクのデータを読み取れませんでした');
        if (!done) return toast('完了したタスクはありません');
        const ok = await confirmDialog(
          `完了したタスク ${done} 件を削除します（未完了のタスクは残ります）。\nこの操作は元に戻せません。必要なら先に「JSON をエクスポート」してください。`,
          { title: '完了したタスクの削除', okText: `${done} 件を削除する`, danger: true },
        );
        if (!ok) return;
        const n = clearDoneTasks();
        if (n === null) return toast('削除できませんでした');
        app.render();
        toast(`完了したタスク ${n} 件を削除しました`);
      }, 'btn btn-danger'),
    ),
    h('p', { class: 'card-note', text: 'インポート・CSV・予定表・テンプレート・サンプルは、タスク画面に切り替わって実行します。CSV と予定表は、タスク画面で表示中（絞り込み中ならその条件）のタスクが対象です（予定表は未完了のみ）。' }),
    fileInput,
  );
}

/* ---------- Face ID でロック（js/lock.js の window.StrideLock を使う） ---------- */

const RELOCK_OPTIONS = [[0, 'すぐ'], [1, '1 分後'], [5, '5 分後'], [15, '15 分後']];

function lockCard(app) {
  const card = h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: 'Face ID でロック' }),
    h('p', { class: 'card-note', text: 'アプリを開いたときと、しばらく離れて戻ったときに Face ID（またはパスコード）での解除を求めます。設定はこの端末だけに適用されます。' }),
  );
  const body = h('div', {});
  card.append(body);
  const lock = window.StrideLock;
  if (!lock) {
    body.append(h('p', { class: 'notice', text: 'ロック機能を読み込めませんでした。' }));
    return card;
  }

  lock.isSupported().then((ok) => {
    const c = lock.getConfig();
    if (!ok) {
      body.append(h('p', { class: 'notice', text: 'この端末・ブラウザでは使えません（Face ID・Touch ID・Windows Hello などの本人確認が必要です）。' }));
      return;
    }
    const relock = h('select', { 'aria-label': 'ロックするまでの時間', onchange: (e) => { lock.setRelockMinutes(Number(e.target.value)); toast('ロックするまでの時間を変更しました'); } },
      RELOCK_OPTIONS.map(([v, l]) => h('option', { value: String(v), text: l, selected: (c.enabled ? c.relockMin : 5) === v })));

    if (c.enabled) {
      body.append(
        h('p', { class: 'lock-status on', text: '🔒 オン（この端末）' }),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'アプリから離れて、ロックするまでの時間' }), relock),
        h('div', { class: 'btn-grid' },
          h('button', { type: 'button', class: 'btn', text: '今すぐロック', onclick: () => lock.lockNow() }),
          h('button', {
            type: 'button', class: 'btn btn-danger', text: 'ロックをオフにする',
            onclick: async () => {
              try {
                await lock.disable();
                toast('ロックをオフにしました');
                app.render();
              } catch (_) {
                toast('本人確認ができなかったため、オフにしませんでした');
              }
            },
          }),
        ),
      );
    } else {
      body.append(
        h('p', { class: 'lock-status', text: '🔓 オフ' }),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'アプリから離れて、ロックするまでの時間' }), relock),
        h('button', {
          type: 'button', class: 'btn btn-primary btn-block', text: 'Face ID でロックをオンにする',
          onclick: async () => {
            const ok2 = await confirmDialog(
              'この端末に STRIDE 専用のパスキーを作り、Face ID でロックします。\nパスキーは iPhone の「パスワード」（iCloud キーチェーン）に保存されます。記録データは送信しません。\nこの画面ロックはのぞき見を防ぐためのもので、データの暗号化は行いません。',
              { title: 'Face ID でロック', okText: '続ける' },
            );
            if (!ok2) return;
            try {
              await lock.enable(Number(relock.value));
              toast('Face ID でのロックをオンにしました');
              app.render();
            } catch (_) {
              toast('パスキーを作成できませんでした（キャンセル、または非対応）');
            }
          },
        }),
      );
    }
  });
  return card;
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
    h('summary', { text: '危険な操作（サンプルデータ・削除）' }),
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
        type: 'button', class: 'btn btn-danger', text: 'タスクをすべて削除',
        onclick: async () => {
          const tasks = loadTasks();
          if (tasks === null) return toast('タスクのデータを読み取れませんでした。タスク画面で確認してください');
          if (!tasks.length) return toast('削除するタスクはありません');
          const ok = await confirmDialog(
            `タスク ${tasks.length} 件をすべて削除します（完了したタスクも含みます）。\nタスク画面の設定・テンプレートと、運動・体重・食事の記録は残ります。\nこの操作は元に戻せません。必要ならタスク画面で先に「JSONをエクスポート」してください。`,
            { title: 'タスクの削除', okText: `${tasks.length} 件を削除する`, danger: true },
          );
          if (!ok) return;
          if (!clearAllTasks()) return toast('削除できませんでした。タスク画面で確認してください');
          app.render();
          toast(`タスク ${tasks.length} 件を削除しました`);
        },
      }),
      h('button', {
        type: 'button', class: 'btn btn-danger', text: '運動・体重・食事の記録をすべて削除',
        onclick: async () => {
          const ok = await confirmDialog('運動・体重・食事の記録と設定をすべて削除し、初期状態に戻します（タスクは残ります）。\nこの操作は元に戻せません。', { title: '記録の削除', okText: 'すべて削除する', danger: true });
          if (!ok) return;
          app.replaceData(defaultData());
          toast('運動・体重・食事の記録をすべて削除しました');
        },
      }),
    ),
  );
}

function aboutCard() {
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: 'このアプリについて' }),
    h('p', { class: 'card-note', text: `STRIDE バージョン ${self.APP_VERSION || '-'}` }),
    h('p', { class: 'card-note', text: '記録はサーバーに送信されません。グラフは Chart.js（MIT License）、紙吹雪は canvas-confetti（ISC License）を使用しています。' }),
  );
}
