// 画面部品の共通処理（要素生成・トースト・確認ダイアログ）

/**
 * 要素を作る。h('div', {class: 'x', onclick: fn}, '文字', 子要素...)
 * attrs の特別なキー: class, text, html(使わない), dataset, on<イベント名>
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** 画面下部に短いメッセージを出す */
let toastTimer = null;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/**
 * 確認ダイアログ（<dialog> を使用。ブラウザ標準の confirm は使わない）
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, { title = '確認', okText = 'OK', cancelText = 'キャンセル', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('dialog');
    dlg.replaceChildren(
      h('form', { method: 'dialog', class: 'dialog-body' },
        h('h2', { class: 'dialog-title', text: title }),
        ...String(message).split('\n').map((line) => h('p', { text: line })),
        h('div', { class: 'dialog-actions' },
          h('button', { value: 'cancel', class: 'btn', text: cancelText }),
          h('button', { value: 'ok', class: danger ? 'btn btn-danger' : 'btn btn-primary', text: okText }),
        ),
      ),
    );
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve(dlg.returnValue === 'ok');
    };
    dlg.returnValue = '';
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}

/** 曜日つき日付: "11/4(火)" */
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function fmtDateShort(str) {
  const [y, m, d] = str.split('-').map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${wd})`;
}

export function fmtDateLong(str) {
  const [y, m, d] = str.split('-').map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日(${wd})`;
}

/** ラベル付き入力欄 */
export function field(label, input, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    input,
    hint ? h('span', { class: 'field-hint', text: hint }) : null,
  );
}

/** セグメント切替（タブ風ボタン群） */
export function segmented(options, current, onChange, ariaLabel) {
  return h('div', { class: 'segmented', role: 'tablist', 'aria-label': ariaLabel },
    options.map(([value, label]) =>
      h('button', {
        type: 'button', role: 'tab', class: value === current ? 'seg active' : 'seg',
        'aria-selected': String(value === current), text: label,
        onclick: () => onChange(value),
      }),
    ),
  );
}

/**
 * 選択肢つきダイアログ。押したボタンの value を返す（キャンセルは null）
 * @param {{value: string, label: string, kind?: 'primary'|'danger'}[]} choices
 */
export function choiceDialog(message, { title = '確認', choices = [], cancelText = 'キャンセル' } = {}) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('dialog');
    dlg.replaceChildren(
      h('form', { method: 'dialog', class: 'dialog-body' },
        h('h2', { class: 'dialog-title', text: title }),
        ...String(message).split('\n').map((line) => h('p', { text: line })),
        h('div', { class: 'dialog-choices' },
          choices.map((c) => h('button', { value: c.value, class: `btn btn-block ${c.kind === 'primary' ? 'btn-primary' : c.kind === 'danger' ? 'btn-danger' : ''}`, text: c.label })),
          h('button', { value: '', class: 'btn btn-block', text: cancelText }),
        ),
      ),
    );
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve(dlg.returnValue || null);
    };
    dlg.returnValue = '';
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}
