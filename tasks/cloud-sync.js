/*
 * Task Board — claude.ai 版の同期（cloud-sync.js）
 *
 * claude.ai のアーティファクトとして開いたときだけ動き、ローカル（index.html を直接開いた場合）では何もしない。
 *
 * 役割
 *   1. タスクを claude.ai のデータベース（db 機能）に保存し、PC と iPhone の Claude アプリで同じデータを使えるようにする
 *      - タスク 1 件 = 1 文書（tasks/<ID>）、テンプレートと設定 = 1 文書（meta/board）
 *      - 画面の操作は app.js が先にこの端末へ保存し、その差分をここで claude.ai に送る（送れなかったら画面に表示）
 *      - 別の端末で変わった内容は、リアルタイムに受け取って画面に反映する
 *   2. ファイルの保存（JSON・CSV）を claude.ai の downloads 機能で行う（claude.ai 内では普通のダウンロードが使えないため）
 *   3. Claude に聞く機能（sample）で、文章からのタスク入力と、手順（チェックリスト）の提案を行う
 *
 * app.js とは window.TaskBoardHost を通じてやり取りする。
 */
'use strict';

(function () {
  // ローカルで開いた場合（window.claude がない）は何もしない
  if (!window.claude || typeof window.claude.use !== 'function') return;

  const TASKS = 'tasks';
  const META_DOC = 'meta/board';
  const SYNCED_KEY = 'taskBoard.cloud.syncedIds'; // この端末で claude.ai と一致していたタスクの ID（削除の判定に使う）
  const ALLOWED_DOC_ID = /[^A-Za-z0-9_\-.:@+]/g;

  let api = null;
  let db = null;
  let initialized = false;
  const remote = { tasks: new Map(), meta: null, tasksLoaded: false, metaLoaded: false };
  const queue = [];
  let running = false;
  let pendingRemote = false;
  let failedOps = 0;
  let lastSavedAt = null;

  // ---------- 小さな道具 ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad2 = (n) => String(n).padStart(2, '0');

  /** タスク ID を文書 ID に使える文字だけにする（使えない文字は ~十六進~ に置き換える） */
  function docId(id) {
    return id.replace(ALLOWED_DOC_ID, (c) => `~${c.codePointAt(0).toString(16)}~`);
  }

  /** キーの順番に左右されない JSON 文字列（同じ内容かどうかの比較に使う） */
  function canon(value) {
    if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${canon(value[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function metaOf(data) {
    return { version: data.version, templates: data.templates, settings: data.settings };
  }

  function loadSyncedIds() {
    try {
      const list = JSON.parse(window.localStorage.getItem(SYNCED_KEY) || '[]');
      return new Set(Array.isArray(list) ? list : []);
    } catch (err) {
      return new Set();
    }
  }

  function saveSyncedIds(ids) {
    try {
      window.localStorage.setItem(SYNCED_KEY, JSON.stringify(Array.from(ids)));
    } catch (err) {
      /* 保存できない環境では、次回の起動時に claude.ai 側を正とする */
    }
  }

  // ---------- 同期の状態表示（ヘッダーのボタン） ----------
  function setStatus(kind, text, title) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.hidden = false;
    el.dataset.state = kind;
    el.textContent = text;
    el.title = title || text;
    el.disabled = kind !== 'error';
  }

  function savedText() {
    const d = lastSavedAt || new Date();
    return `claude.ai に保存済み ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function errorText(err) {
    const code = err && err.code;
    if (code === 'quota_exceeded') return 'claude.ai の保存容量の上限に達しました。不要なタスクを削除してください';
    if (code === 'invalid_argument') return 'claude.ai に保存できないデータがありました（1件のタスクが大きすぎる可能性があります）';
    if (code === 'resource_exhausted') return '短時間に多くの変更があったため、claude.ai への保存を一時停止しました';
    if (code === 'revoked' || code === 'not_granted') return 'claude.ai への保存が許可されていません';
    return 'claude.ai に保存できませんでした。通信状態を確認してください';
  }

  // ---------- claude.ai からデータを受け取る ----------
  /** claude.ai の内容から、app.js が読み込める形のデータを作る（壊れたタスクは除く） */
  function buildRemoteData() {
    const local = api.getData();
    const meta = remote.meta || metaOf(local);
    const tasks = [];
    let skipped = 0;
    for (const task of remote.tasks.values()) {
      const check = api.validate({ version: 3, tasks: [task] });
      if (check.ok) tasks.push(task);
      else skipped++;
    }
    tasks.sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    const raw = { app: 'task-board', version: 3, tasks, templates: meta.templates || [], settings: meta.settings };
    // app.js と同じ形に整えてから比べる（整える前の形のままだと、毎回「変わった」と判定してしまう）
    const full = api.validate(raw);
    return { data: full.ok ? full.data : raw, skipped };
  }

  function sameAsLocal(data) {
    const local = api.getData();
    if (canon(metaOf({ ...local, version: 3 })) !== canon(metaOf(data))) return false;
    if (local.tasks.length !== data.tasks.length) return false;
    const map = new Map(local.tasks.map((t) => [t.id, canon(t)]));
    return data.tasks.every((t) => map.get(t.id) === canon(t));
  }

  function onRemoteChange() {
    if (!initialized) {
      if (remote.tasksLoaded && remote.metaLoaded) initialSync();
      return;
    }
    // 自分の送信中は、送り終わってからまとめて反映する
    if (running || queue.length) {
      pendingRemote = true;
      return;
    }
    reconcile('別の端末での変更を反映しました');
  }

  function reconcile(message) {
    const { data, skipped } = buildRemoteData();
    saveSyncedIds(new Set(data.tasks.map((t) => t.id)));
    if (!sameAsLocal(data)) {
      const result = api.applyRemote(data, message);
      if (!result.ok) {
        setStatus('error', 'claude.ai のデータを読み込めませんでした', (result.errors || []).join('\n'));
        return;
      }
    }
    if (skipped) setStatus('error', `claude.ai のタスクのうち ${skipped}件を読み込めませんでした`);
    else if (!failedOps) setStatus('ok', savedText());
  }

  /**
   * 最初の同期。この端末の控えと claude.ai の内容を、タスクごとに新しい方でまとめる。
   * - claude.ai にだけあるタスク：取り込む
   * - この端末にだけあるタスク：前回 claude.ai と一致していたもの（＝別の端末で削除）は捨て、それ以外は送る
   * - 両方にあるタスク：更新日時が新しい方を使う
   */
  function initialSync() {
    initialized = true;
    const local = api.getData();
    const synced = loadSyncedIds();
    const merged = new Map(remote.tasks);
    const uploads = [];
    for (const task of local.tasks) {
      const r = remote.tasks.get(task.id);
      if (!r) {
        if (!synced.has(task.id)) {
          merged.set(task.id, task);
          uploads.push(task);
        }
      } else if ((Date.parse(task.updatedAt) || 0) > (Date.parse(r.updatedAt) || 0)) {
        merged.set(task.id, task);
        uploads.push(task);
      }
    }
    const metaUpload = !remote.meta;
    remote.tasks = merged;
    if (metaUpload) remote.meta = metaOf({ ...local, version: 3 });

    const { data } = buildRemoteData();
    if (!sameAsLocal(data)) {
      const result = api.applyRemote(data, remote.tasks.size && !uploads.length ? 'claude.ai に保存されているタスクを読み込みました' : null);
      if (!result.ok) {
        setStatus('error', 'claude.ai のデータを読み込めませんでした', (result.errors || []).join('\n'));
        return;
      }
    }
    for (const task of uploads) enqueue({ type: 'set', id: task.id, path: `${TASKS}/${docId(task.id)}`, data: task });
    if (metaUpload) enqueue({ type: 'set', path: META_DOC, data: remote.meta });
    if (queue.length) run();
    else {
      saveSyncedIds(new Set(data.tasks.map((t) => t.id)));
      setStatus('ok', savedText());
    }
  }

  // ---------- claude.ai へ送る ----------
  /** 同じ文書への未送信の書き込みは、新しい方だけ残す */
  function enqueue(op) {
    for (let i = queue.length - 1; i >= 1; i--) {
      if (queue[i].path === op.path) queue.splice(i, 1); // 0 番目は送信中の可能性があるので残す
    }
    queue.push(op);
  }

  function enqueueDiff(prev, next) {
    const prevMap = new Map(prev.tasks.map((t) => [t.id, t]));
    const nextMap = new Map(next.tasks.map((t) => [t.id, t]));
    for (const [id, task] of nextMap) {
      const before = prevMap.get(id);
      if (!before || canon(before) !== canon(task)) enqueue({ type: 'set', id, path: `${TASKS}/${docId(id)}`, data: task });
    }
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id)) enqueue({ type: 'delete', id, path: `${TASKS}/${docId(id)}` });
    }
    if (canon(metaOf(prev)) !== canon(metaOf(next))) enqueue({ type: 'set', path: META_DOC, data: metaOf(next) });
    run();
  }

  async function run() {
    if (running || !db) return;
    running = true;
    failedOps = 0;
    let firstError = null;
    while (queue.length) {
      setStatus('busy', `claude.ai に保存中…（${queue.length}件）`);
      const op = queue[0];
      try {
        const ref = db.doc(op.path);
        if (op.type === 'delete') await ref.delete();
        else await ref.set(JSON.parse(JSON.stringify(op.data)));
        queue.shift();
        if (op.id) {
          const ids = loadSyncedIds();
          if (op.type === 'delete') ids.delete(op.id);
          else ids.add(op.id);
          saveSyncedIds(ids);
        }
      } catch (err) {
        if (err && err.code === 'unavailable' && !op.retried) {
          op.retried = true; // 一時的な不調は、少し待って 1 回だけ送り直す
          await sleep(600 + Math.random() * 900);
          continue;
        }
        queue.shift();
        failedOps++;
        if (!firstError) firstError = err;
      }
    }
    running = false;
    if (firstError) {
      setStatus('error', `${errorText(firstError)}（押すと送り直します）`, 'この端末には保存済みです。押すと claude.ai へ送り直します。');
      api.toast(`${errorText(firstError)}。この端末には保存されています。`, 'error');
    } else {
      lastSavedAt = new Date();
      setStatus('ok', savedText());
    }
    if (pendingRemote && !firstError) {
      pendingRemote = false;
      reconcile('別の端末での変更を反映しました');
    }
  }

  /** 送れなかった変更を送り直す：claude.ai の内容とこの端末の内容の差分をすべて送る */
  function resend() {
    if (!db || running) return;
    const local = api.getData();
    const { data } = buildRemoteData();
    enqueueDiff({ ...data, version: 3 }, { ...local, version: 3 });
    if (!queue.length) setStatus('ok', savedText());
  }

  // ---------- 起動 ----------
  async function start() {
    setStatus('busy', 'claude.ai に接続中…');
    document.getElementById('sync-status').addEventListener('click', resend);

    const [dbNs, downloads, sample] = await Promise.all([
      window.claude.use('db'),
      window.claude.use('downloads'),
      window.claude.use('sample'),
    ]);

    // ファイル保存（JSON・CSV）。.ics は claude.ai 内では保存できない
    hostSaveFile = async (fileName, content) => {
      if (!downloads) {
        api.toast('この画面ではファイルを保存できません。ローカル版の Task Board をお使いください', 'error');
        return false;
      }
      try {
        await downloads.save({ filename: fileName, data: content });
        return true;
      } catch (err) {
        if (err && err.code === 'declined') return false;
        if (err && err.code === 'rejected_extension') {
          api.toast('この形式のファイルは claude.ai からは保存できません', 'error');
          return false;
        }
        api.toast('ファイルを保存できませんでした', 'error');
        return false;
      }
    };
    api.setIcsAvailable(false);

    if (sample) api.setAi(buildAi(sample));

    if (!dbNs) {
      setStatus('offline', 'claude.ai に保存できません（この端末だけに保存）', 'Claude アプリまたは claude.ai で開くと、端末をまたいで同期します。');
      return;
    }
    db = dbNs;
    db.collection(TASKS).onSnapshot(
      (snap) => {
        const map = new Map();
        for (const doc of snap.docs) {
          const value = doc.exists ? doc.data() : null;
          if (value && typeof value.id === 'string') map.set(value.id, value);
        }
        remote.tasks = map;
        remote.tasksLoaded = true;
        onRemoteChange();
      },
      (err) => setStatus('error', `${errorText(err)}（再読み込みしてください）`)
    );
    db.doc(META_DOC).onSnapshot(
      (snap) => {
        remote.meta = snap.exists ? snap.data() : null;
        remote.metaLoaded = true;
        onRemoteChange();
      },
      (err) => setStatus('error', `${errorText(err)}（再読み込みしてください）`)
    );
  }

  // ---------- Claude に聞く ----------
  function sampleErrorText(err) {
    const code = err && err.code;
    if (code === 'not_granted' || code === 'sampling_disabled') return 'Claude を使う許可がないため、この機能は使えません';
    if (code === 'rate_limited') return 'Claude の利用が混み合っています。少し時間をおいてお試しください';
    if (code === 'session_expired') return 'claude.ai に再度ログインしてください';
    if (code === 'invalid_json' || code === 'empty_completion') return 'Claude の回答を読み取れませんでした。文章を短くして、もう一度お試しください';
    if (code === 'refused') return 'Claude がこの内容への回答を控えました。文章を変えてお試しください';
    return 'Claude から回答を得られませんでした。もう一度お試しください';
  }

  function dateHints(today) {
    const [y, m, d] = today.split('-').map(Number);
    const wd = ['日', '月', '火', '水', '木', '金', '土'];
    const lines = [];
    for (let i = 0; i < 28; i++) {
      const dt = new Date(y, m - 1, d + i);
      lines.push(`${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}（${wd[dt.getDay()]}）`);
    }
    return lines.join(', ');
  }

  function buildAi(sample) {
    const call = async (prompt) => {
      try {
        return await sample.json(prompt, { modelTier: 'quick', cache: false });
      } catch (err) {
        throw new Error(sampleErrorText(err));
      }
    };
    return {
      /** 文章からタスク 1 件分の項目を取り出す */
      async parseTask(text, ctx) {
        const prompt = [
          'あなたはタスク管理ツールの入力補助です。次の文章から、タスク1件の情報を取り出してください。',
          `今日は ${ctx.today} です。日付の早見表：${dateHints(ctx.today)}`,
          `登録済みの担当者：${ctx.assignees.join('、') || '（なし）'}（利用者自身は「${ctx.myName || '自分'}」）`,
          `登録済みの案件名：${ctx.projects.join('、') || '（なし）'}`,
          `登録済みのタグ：${ctx.tags.join('、') || '（なし）'}`,
          '返答は次の形の JSON オブジェクト1つだけにしてください：',
          '{"title": "タスク名", "project": "案件名", "assignee": "担当者", "startDate": "YYYY-MM-DD または空文字", "due": "YYYY-MM-DD または空文字", "priority": "high | medium | low", "tags": ["タグ"], "description": "詳細説明", "checklist": ["手順"]}',
          'ルール：文章にないことは空文字か空配列にする。担当者が「自分」「私」なら利用者自身の名前にする。担当者や案件名は、登録済みのものと同じ人・案件なら同じ書き方にそろえる。',
          '「来週火曜」などの日付は早見表で YYYY-MM-DD にする。「急ぎ」「至急」「最優先」は high、「いつでも」「余裕があれば」は low、それ以外は medium。',
          'checklist は、文章に作業の手順が書かれているときだけ入れる。title は短く具体的にする。',
          '文章：',
          '<<<',
          text.slice(0, 2000),
          '>>>',
        ].join('\n');
        const result = await call(prompt);
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Claude の回答を読み取れませんでした');
        return result;
      },
      /** タスクを進めるための手順を提案する */
      async suggestChecklist(task) {
        const prompt = [
          'あなたは仕事の段取りを手伝うアシスタントです。次のタスクを終わらせるための具体的な作業手順を、3〜8個に分けてください。',
          `タスク名：${task.title}`,
          `案件名：${task.project || '（なし）'}`,
          `詳細説明：${(task.description || '（なし）').slice(0, 2000)}`,
          `登録済みの手順（重複させない）：${task.existing.join('、') || '（なし）'}`,
          '各手順は日本語で 40 文字以内、「〜を確認する」のように動詞で終える。',
          '返答は手順の文字列だけを並べた JSON 配列1つにしてください。例：["事前確認の項目を洗い出す", "レビューを依頼する"]',
        ].join('\n');
        const result = await call(prompt);
        if (!Array.isArray(result)) throw new Error('Claude の回答を読み取れませんでした');
        return result;
      },
    };
  }

  // ---------- app.js との接続口 ----------
  let hostSaveFile = null;
  window.TaskBoardHost = {
    attach(appApi) {
      api = appApi;
      start().catch(() => setStatus('error', 'claude.ai に接続できませんでした（この端末だけに保存）'));
    },
    afterCommit(prev, next) {
      if (!db || !initialized) return; // 接続前の変更は、最初の同期でまとめて送る
      enqueueDiff(prev, next);
    },
    saveFile(fileName, content, type) {
      if (!hostSaveFile) {
        if (api) api.toast('claude.ai に接続中です。少し待ってからお試しください', 'info');
        return Promise.resolve(false);
      }
      return hostSaveFile(fileName, content, type);
    },
  };
})();
