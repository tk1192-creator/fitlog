// ホーム画面の「家族」カードと、やりとりの一覧（下から出るシート）（v2.10.0）
import { STAMPS, cachedMessages, familyConfig, markSeen, sendMessage, unread } from '../family.js';
import { h, toast } from '../ui.js';

const state = { open: false, nav: null, focus: false, draft: '' };

function timeLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function bubble(m, me) {
  const mine = m.from === me;
  return h('li', { class: `fm${mine ? ' mine' : ''}${m.kind === 'stamp' ? ' stamp' : ''}` },
    h('span', { class: 'fm-meta', text: `${mine ? '自分' : m.name}　${timeLabel(m.at)}` }),
    m.kind === 'stamp'
      ? h('span', { class: 'fm-stamp', text: m.stamp, 'aria-label': `${m.name} から応援スタンプ ${m.stamp}` })
      : h('span', { class: 'fm-text', text: m.text }),
  );
}

async function send(app, payload, btn) {
  if (btn) btn.disabled = true;
  try {
    await sendMessage(payload);
    if (payload.text) state.draft = '';
    app.render();
  } catch (e) {
    toast(e.message || '送れませんでした。電波を確認してください');
    if (btn) btn.disabled = false;
  }
}

function stampRow(app) {
  return h('div', { class: 'stamp-row', role: 'group', 'aria-label': '応援スタンプを送る' },
    STAMPS.map((s) => h('button', {
      type: 'button', class: 'stamp-btn', text: s, 'aria-label': `${s} を送る`,
      onclick: (e) => send(app, { stamp: s }, e.currentTarget),
    })));
}

/** ホームの「家族」カード（家族の部屋に接続していなければ出さない） */
export function familyCard(app) {
  const fc = familyConfig();
  if (!fc) return null;
  const sheetOpen = state.open && state.nav === app.navCount;
  if (sheetOpen) markSeen({ silent: true }); // 開いている一覧に出ているものは読んだことにする
  const list = cachedMessages();
  const n = unread();
  const card = h('section', { class: 'card family-card' },
    h('div', { class: 'family-head' },
      h('h2', { class: 'card-title', text: '家族' }),
      n ? h('span', { class: 'unread-badge', text: `新着 ${n}`, 'aria-label': `まだ読んでいないメッセージ ${n} 件` }) : null,
    ),
  );
  if (list.length) {
    card.append(h('ul', { class: 'fm-list compact' }, list.slice(-3).map((m) => bubble(m, fc.member))));
  } else {
    card.append(h('p', { class: 'card-note', text: 'まだメッセージはありません。スタンプやひとことを送ってみましょう。' }));
  }
  card.append(stampRow(app),
    h('button', { type: 'button', class: 'btn btn-primary btn-block', text: n ? `メッセージを読む・送る（新着 ${n}）` : 'メッセージを読む・送る', onclick: () => { openFamilySheet(app); app.render(); } }));

  if (sheetOpen) return [card, familySheet(app, fc)];
  state.open = false;
  return card;
}

export function openFamilySheet(app) {
  state.open = true;
  state.nav = app.navCount;
  state.focus = true;
}

function familySheet(app, fc) {
  const close = () => { state.open = false; app.render(); };
  const closeBtn = h('button', { type: 'button', class: 'sheet-close', 'aria-label': '閉じる', text: '×', onclick: close });
  const list = cachedMessages();
  const ta = h('textarea', { rows: '2', maxlength: '500', placeholder: 'ひとこと（例：今日ジム行く？）', 'aria-label': '送るメッセージ' });
  ta.value = state.draft;
  ta.addEventListener('input', () => { state.draft = ta.value; });
  const sendBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: '送る' });
  const form = h('form', { class: 'fm-form' }, ta, sendBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ta.value.trim()) return toast('メッセージを入れてください');
    send(app, { text: ta.value }, sendBtn);
  });
  const thread = h('ul', { class: 'fm-list' }, list.map((m) => bubble(m, fc.member)));
  const panel = h('div', { class: `sheet${state.focus ? ' enter' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': '家族とのやりとり' },
    h('div', { class: 'sheet-head' }, h('span', { class: 'sheet-grip', 'aria-hidden': 'true' }), closeBtn),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: `家族とのやりとり（${fc.name || '自分'}）` }),
      list.length ? thread : h('p', { class: 'card-note', text: 'まだメッセージはありません。' }),
      h('p', { class: 'card-note', text: '3 か月より前のメッセージは自動で消えます。' }),
      stampRow(app), form,
    ),
  );
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, panel);
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => {
    thread.lastElementChild?.scrollIntoView({ block: 'end' });
    if (state.focus) { state.focus = false; closeBtn.focus({ preventScroll: true }); }
  });
  return backdrop;
}
