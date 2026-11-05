// 設定画面: プロフィール・目標、種目、データの入出力、危険な操作
import { ACTIVITY_LEVELS, daysBetween, todayStr } from '../calc.js';
import { LINK_MAX, defaultData, exportCSV, exportJSON, newId, normalize, normalizeLinks } from '../storage.js';
import { REST_SCOPES, restAlertSettings } from '../plans.js';
import { generateSample } from '../sample.js';
import { clearAllTasks, clearDoneTasks, countDoneTasks, exportTasksJSON, loadTasks } from './home-tasks.js';
import { choiceDialog, confirmDialog, field, fmtDateLong, h, toast } from '../ui.js';
import * as cloud from '../cloud.js';
import { connectFamily, disconnectFamily, familyConfig, setFamilyName } from '../family.js';

const BACKUP_REMIND_DAYS = 14;
const FAMILY_ROOM_DEFAULT = 'tk1192-creator/stride-family'; // 家族の部屋（v2.10.1。利用者の指定）
const TASK_IMPORT_KEY = 's-task-import'; // タスク画面へ渡すインポート用ファイル（sessionStorage）
const TASK_IMPORT_MAX = 4 * 1024 * 1024; // sessionStorage に収まる大きさ（目安）

let unsubscribeCloud = null;

export function unmount() {
  if (unsubscribeCloud) { unsubscribeCloud(); unsubscribeCloud = null; }
}

export function render(root, app, params = {}) {
  const links = linksCard(app);
  if (params.focus === 'links') requestAnimationFrame(() => links.scrollIntoView({ block: 'start' }));
  root.append(cloudCard(app), familySettingsCard(app), links, habitCard(app), shareCard(app), profileCard(app), exerciseCard(app), lockCard(app), dataCard(app), taskDataCard(app), dangerCard(app), aboutCard());
}

/* ---------- 家族の部屋（v2.10.0。js/family.js） ---------- */

function familySettingsCard(app) {
  const card = h('section', { class: 'card', id: 'family' }, h('h2', { class: 'card-title', text: '家族の部屋（メッセージ・応援）' }));
  if (!cloud.getConfig()) {
    card.append(h('p', { class: 'card-note', text: '先に「記録の保存先（GitHub）」を設定すると使えます。' }));
    return card;
  }
  const fc = familyConfig();
  if (fc) {
    const name = h('input', { type: 'text', value: fc.name, maxlength: '20', 'aria-label': '家族に表示する名前' });
    card.append(
      h('p', { class: 'lock-status on', text: `👪 接続中：${fc.repo}` }),
      h('p', { class: 'card-note', text: 'ホームの「家族」カードで、メッセージと応援スタンプを送り合えます。通知をオンにしている端末には、新しいメッセージが届いたときに通知が届きます。' }),
      h('div', { class: 'inline-form' }, name, h('button', { type: 'button', class: 'btn', text: '名前を保存', onclick: () => { if (!name.value.trim()) return toast('名前を入れてください'); setFamilyName(name.value); toast('名前を変えました'); app.render(); } })),
      h('button', {
        type: 'button', class: 'btn btn-danger btn-block', text: 'この端末で家族の部屋から抜ける',
        onclick: async () => {
          if (!await confirmDialog('この端末で家族の部屋への接続を解除します（GitHub のメッセージは消えません）。もう一度つなぐときは家族の合言葉が必要です。', { title: '家族の部屋から抜ける', okText: '解除する', danger: true })) return;
          disconnectFamily();
          toast('解除しました');
          app.render();
        },
      }),
    );
    return card;
  }
  // 家族の部屋は 1 つだけなので、名前を最初から入れておく（打ち間違いを防ぐ。v2.10.1）
  const repo = h('input', { type: 'text', value: FAMILY_ROOM_DEFAULT, autocapitalize: 'off', spellcheck: 'false' });
  const name = h('input', { type: 'text', maxlength: '20', placeholder: '例：パパ', value: (app.data.settings.share && app.data.settings.share.name) || '' });
  const pass = h('input', { type: 'password', placeholder: '家族で決めた合言葉（8 文字以上）', autocomplete: 'new-password' });
  const pass2 = h('input', { type: 'password', placeholder: 'もう一度', autocomplete: 'new-password' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block', text: '家族の部屋に入る' });
  const form = h('form', { class: 'form' },
    field('家族の部屋（リポジトリ）', repo, 'ふつうはこのままで構いません'),
    field('家族に表示する名前', name),
    h('div', { class: 'row-2' }, field('家族の合言葉', pass), field('家族の合言葉（確認）', pass2)),
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!repo.value.trim().includes('/')) return toast('リポジトリを「ユーザー名/リポジトリ名」で入れてください');
    if (!name.value.trim()) return toast('家族に表示する名前を入れてください');
    if (pass.value.length < 8) return toast('家族の合言葉は 8 文字以上にしてください');
    if (pass.value !== pass2.value) return toast('家族の合言葉が一致しません');
    btn.disabled = true;
    btn.textContent = '接続しています…';
    try {
      const r = await connectFamily({ repo: repo.value, passphrase: pass.value, name: name.value });
      toast(r.created ? '家族の部屋を始めました。家族にも同じ合言葉で入ってもらってください' : '家族の部屋に入りました');
      app.render();
    } catch (err) {
      toast(err.message || '接続できませんでした');
      btn.disabled = false;
      btn.textContent = '家族の部屋に入る';
    }
  });
  card.append(
    h('p', { class: 'card-note', text: '家族どうしでメッセージと応援スタンプを送り合えます。メッセージは家族の合言葉で暗号化され、個人の記録（体重など）は共有されません。準備は管理者の作業が必要です（手引きの「家族の部屋」）。' }),
    form,
    h('p', { class: 'card-note', text: '家族の合言葉は、家族全員で同じものを使います。忘れると過去のメッセージは読めなくなります。' }),
  );
  return card;
}

/* ---------- よく使うリンク（v2.9.3）。ホームに表示する ---------- */

function linksCard(app) {
  const card = h('section', { class: 'card', id: 'links' }, h('h2', { class: 'card-title', text: 'よく使うリンク' }));
  const links = app.data.settings.links || [];
  card.append(h('p', { class: 'card-note', text: `ホームの記録ボタンの下に表示します（${LINK_MAX} 件まで）。登録したリンクは記録と一緒に暗号化して保存し、ほかの端末にも同期します。` }));
  if (links.length) {
    card.append(h('ul', { class: 'habit-edit-list' }, links.map((l, i) => h('li', { class: 'link-edit' },
      h('span', { class: 'link-edit-text' }, h('strong', { text: l.title }), h('small', { text: l.url })),
      h('button', {
        type: 'button', class: 'btn btn-sm btn-danger', text: '削除',
        onclick: async () => {
          if (!await confirmDialog(`「${l.title}」をホームから外します。`, { title: 'リンクを削除', okText: '削除する', danger: true })) return;
          app.update((d) => { d.settings.links = d.settings.links.filter((_, j) => j !== i); });
          toast('削除しました');
        },
      }),
    ))));
  }
  const title = h('input', { type: 'text', maxlength: '20', placeholder: '例：ジムの会員ページ' });
  const url = h('input', { type: 'url', inputmode: 'url', placeholder: 'https://…', autocapitalize: 'off', spellcheck: 'false' });
  const form = h('form', { class: 'form' },
    field('名前', title),
    field('URL（https で始まるもの）', url),
    h('button', { type: 'submit', class: 'btn btn-primary btn-block', text: '＋ リンクを追加' }),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = normalizeLinks([{ title: title.value, url: url.value }]);
    if (!next.length) return toast('https:// で始まる URL を入れてください');
    if (links.length >= LINK_MAX) return toast(`リンクは ${LINK_MAX} 件までです`);
    app.update((d) => { d.settings.links = [...(d.settings.links || []), next[0]]; });
    toast(`「${next[0].title}」をホームに追加しました`);
  });
  card.append(form);
  return card;
}

/* ---------- 休みのお知らせ・習慣チェック（v2.7.0。js/plans.js） ---------- */

const HABIT_MAX = 10;

function habitCard(app) {
  const card = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: '休みのお知らせ・習慣' }));

  // 休みのお知らせ
  const r = restAlertSettings(app.data);
  const enabled = h('input', { type: 'checkbox', checked: r.enabled });
  const days = h('select', {}, [2, 3, 4, 5, 7].map((n) => h('option', { value: String(n), text: `${n} 日`, selected: n === r.days })));
  const scope = h('select', {}, REST_SCOPES.map(([v, l]) => h('option', { value: v, text: l, selected: v === r.scope })));
  const saveRest = h('button', { type: 'button', class: 'btn btn-primary btn-block', text: '休みのお知らせを保存' });
  saveRest.addEventListener('click', () => {
    app.update((d) => { d.settings.restAlert = { enabled: enabled.checked, days: Number(days.value), scope: scope.value }; });
    toast(enabled.checked ? `${days.value} 日続けて休んだら知らせます` : '休みのお知らせをオフにしました');
  });
  card.append(
    h('h3', { class: 'notify-title', text: '休みのお知らせ' }),
    h('p', { class: 'card-note', text: '続けて休んだ日数が設定に届くと、ホームに表示し、夜 21 時ごろの通知（通知をオンにした端末）でも知らせます。' }),
    h('label', { class: 'check-row' }, enabled, h('span', { text: '続けて休んだら知らせる' })),
    h('div', { class: 'row-2' }, field('何日休んだら', days), field('数える記録', scope)),
    saveRest,
  );

  // 習慣チェックの項目
  const habits = app.data.habits || [];
  const list = h('ul', { class: 'habit-edit-list' }, habits.map((x) => {
    const name = h('input', { type: 'text', value: x.name, maxlength: '20', 'aria-label': `習慣「${x.name}」の名前` });
    return h('li', { class: 'habit-edit' },
      name,
      h('button', {
        type: 'button', class: 'btn btn-sm', text: '名前を保存',
        onclick: () => {
          const v = name.value.trim();
          if (!v) return toast('名前を入れてください');
          app.update((d) => { d.habits = d.habits.map((y) => (y.id === x.id ? { ...y, name: v.slice(0, 20) } : y)); });
          toast('名前を変えました');
        },
      }),
      h('button', {
        type: 'button', class: 'btn btn-sm btn-danger', text: '削除',
        onclick: async () => {
          const n = (app.data.habitLogs || []).filter((l) => l.habitId === x.id).length;
          const ok = await confirmDialog(`習慣「${x.name}」を削除します。${n ? `\nこれまでのチェック ${n} 日分も消えます。` : ''}`, { title: '習慣を削除', okText: '削除する', danger: true });
          if (!ok) return;
          app.update((d) => {
            d.habits = d.habits.filter((y) => y.id !== x.id);
            d.habitLogs = d.habitLogs.filter((l) => l.habitId !== x.id);
          });
          toast('削除しました');
        },
      }),
    );
  }));
  const newName = h('input', { type: 'text', maxlength: '20', placeholder: '例：ストレッチ、水を 2L、23 時までに寝る' });
  const add = h('form', { class: 'inline-form' },
    newName,
    h('button', { type: 'submit', class: 'btn btn-primary', text: '追加' }),
  );
  add.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = newName.value.trim();
    if (!v) return toast('習慣の名前を入れてください');
    if (habits.length >= HABIT_MAX) return toast(`習慣は ${HABIT_MAX} 個までです`);
    if (habits.some((x) => x.name === v)) return toast('同じ名前の習慣があります');
    app.update((d) => { d.habits.push({ id: newId(), name: v.slice(0, 20) }); });
    toast(`「${v}」を追加しました。ホームの「今日の予定・習慣」でチェックできます`);
  });
  card.append(
    h('h3', { class: 'notify-title', text: '習慣チェックの項目' }),
    h('p', { class: 'card-note', text: '毎日続けたいことを登録すると、ホームでチェックでき、続いた日数（🔥）を表示します。運動した日数には数えません。' }),
    habits.length ? list : h('p', { class: 'empty', text: 'まだ項目がありません。' }),
    add,
  );
  return card;
}

/* ---------- LINE で家族に報告（js/share.js。送信は保存先の GitHub Actions） ---------- */

function shareCard(app) {
  const card = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'LINE で家族に報告' }));
  if (!cloud.getConfig()) {
    card.append(h('p', { class: 'card-note', text: '先に「記録の保存先（GitHub）」を設定すると使えます。' }));
    return card;
  }
  const s = { enabled: false, name: '', weekly: true, pb: true, weight: false, ...(app.data.settings.share || {}) };
  const cb = (checked) => h('input', { type: 'checkbox', checked: Boolean(checked) });
  const enabled = cb(s.enabled);
  const weekly = cb(s.weekly);
  const pb = cb(s.pb);
  const weight = cb(s.weight);
  const name = h('input', { type: 'text', value: s.name, placeholder: '例: パパ', maxlength: '20' });
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-block', text: '報告の設定を保存' });
  save.addEventListener('click', async () => {
    if (enabled.checked && !name.value.trim()) return toast('家族に表示する名前を入れてください');
    if (enabled.checked && !s.enabled) {
      const ok = await confirmDialog(
        '運動した日数・自己ベスト' + (weight.checked ? '・体重の増減' : '') + 'を、LINE 公式アカウント「STRIDE」の友だち（家族）に送ります。\n体重そのものは送りません。送った内容は LINE のサーバーを通ります。',
        { title: '家族への報告をオンにする', okText: 'オンにする' },
      );
      if (!ok) return;
    }
    app.update((d) => {
      d.settings.share = { enabled: enabled.checked, name: name.value.trim(), weekly: weekly.checked, pb: pb.checked, weight: weight.checked };
    });
    toast(enabled.checked ? '家族への報告をオンにしました' : '家族への報告をオフにしました');
  });
  card.append(
    h('p', { class: 'card-note' }, 'LINE 公式アカウント「STRIDE」を友だち追加した家族に送ります（準備は ', h('a', { href: './guide/#line', text: '手引きの「LINE で受け取る」' }), '）。'),
    h('label', { class: 'check-row' }, enabled, h('span', { text: '家族に報告する' })),
    field('家族に表示する名前', name),
    h('label', { class: 'check-row' }, weekly, h('span', { text: '今週のふりかえり（日曜の夜：運動した日数・自己ベストの数）' })),
    h('label', { class: 'check-row' }, pb, h('span', { text: '自己ベストを更新したらすぐ報告' })),
    h('label', { class: 'check-row' }, weight, h('span', { text: '体重の増減も含める（「今週 −0.6kg」のように増減だけ。体重そのものは送らない）' })),
    save,
  );
  return card;
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

/** トークンだけを入れ直す（記録・合言葉はそのまま） */
function tokenReplaceBox(app) {
  const input = h('input', { type: 'password', placeholder: 'github_pat_…（新しいトークン）', autocomplete: 'off', 'aria-label': '新しいトークン' });
  const btn = h('button', { type: 'submit', class: 'btn', text: '入れ替える' });
  const form = h('form', { class: 'inline-form' }, input, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return toast('新しいトークンを貼り付けてください');
    btn.disabled = true;
    try {
      await cloud.replaceToken(input.value);
      toast('トークンを入れ替えました');
      app.render();
    } catch (err) {
      toast(err.message || '入れ替えられませんでした');
      btn.disabled = false;
    }
  });
  return h('details', { class: 'token-replace' },
    h('summary', { text: 'トークンを入れ直す（期限切れ・家族の部屋を追加したとき）' }),
    h('p', { class: 'card-note', text: '新しいトークンを貼り付けて「入れ替える」を押します。記録と合言葉はそのままです。' }),
    form,
  );
}

function cloudCard(app) {
  const card = h('section', { class: 'card', id: 'cloud-card' },
    h('h2', { class: 'card-title', text: '記録の保存先（GitHub）' }),
  );
  const cfg = cloud.getConfig();

  if (!cfg) {
    const user = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : 'ユーザー名';
    // 家族など複数人で使うため、初期値は入れず記入例だけを示す（他の人の保存先を誤って入れないように）
    const repo = h('input', { type: 'text', placeholder: `例: ${user}/stride-○○`, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
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
      h('p', { class: 'card-note' }, '初めての方は ', h('a', { href: './guide/', text: 'はじめての手引き' }), ' を見ながら設定してください。'),
      h('ol', { class: 'cloud-steps' },
        h('li', { text: 'リポジトリ名とトークンを用意する（家族から受け取ったメモ、または自分で作ったもの）' }),
        h('li', { text: '下の欄にリポジトリ名・トークン・合言葉を入れて「接続して保存を始める」を押す' }),
        h('li', { text: '合言葉は忘れないように紙などに控えておく（忘れると GitHub の記録を開けません）' }),
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
    tokenReplaceBox(app),
    notifySection(app),
    h('p', { class: 'card-note' }, '歩数をヘルスケアから自動で取り込む方法は ', h('a', { href: './guide/#steps', text: '手引きの「歩数の自動取り込み」' }), ' を見てください。'),
  );
  return card;
}

/** 入力忘れのお知らせ（21 時以降、今日の体重がまだなら通知） */
function notifySection(app) {
  const box = h('div', { class: 'notify-box' },
    h('h3', { class: 'notify-title', text: 'お知らせ（朝 7 時ごろ・夜 21 時ごろ）' }),
    h('p', { class: 'card-note', text: '朝：今日の運動の予定があれば知らせます。夜：体重がまだ・予定の運動がまだ記録されていない・休みが続いているときに知らせます。何もなければ届きません（GitHub の混み具合で数分〜数十分遅れることがあります）。' }),
  );
  const sup = cloud.notifySupport();
  if (cloud.isNotifyOn()) {
    box.append(
      h('p', { class: 'lock-status on', text: '🔔 この端末で受け取る：オン' }),
      h('button', {
        type: 'button', class: 'btn btn-block', text: 'この端末の通知を止める',
        onclick: async () => {
          try { await cloud.disableNotify(); toast('通知を止めました'); } catch (_) { toast('止められませんでした。電波を確認してください'); }
          app.render();
        },
      }),
    );
  } else if (!sup.ok) {
    box.append(h('p', { class: 'notice', text: sup.reason }));
  } else {
    const btn = h('button', { type: 'button', class: 'btn btn-primary btn-block', text: 'この端末で通知を受け取る' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '設定しています…';
      try {
        await cloud.enableNotify();
        toast('通知をオンにしました（朝 7 時ごろ・夜 21 時ごろ、知らせることがある日に届きます）');
        app.render();
      } catch (e) {
        toast(e.message || '通知をオンにできませんでした');
        btn.disabled = false;
        btn.textContent = 'この端末で通知を受け取る';
      }
    });
    box.append(h('p', { class: 'lock-status', text: '🔕 この端末で受け取る：オフ' }), btn);
  }
  return box;
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
      field('身長 (cm)', n('heightCm', s.heightCm, { step: '0.1', min: '100', max: '250', required: true, placeholder: '例: 160' })),
      field('年齢', n('age', s.age, { step: '1', min: '1', max: '120', inputmode: 'numeric', required: true, placeholder: '例: 45' })),
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
    h('p', { class: 'card-note' }, h('a', { href: './guide/', text: 'はじめての手引き（使い方・設定のしかた）' })),
    h('p', { class: 'card-note', text: '記録はサーバーに送信されません。グラフは Chart.js（MIT License）、紙吹雪は canvas-confetti（ISC License）を使用しています。' }),
  );
}
