// 運動カレンダー（段階③で実装）
import { h } from '../ui.js';

export function render(root) {
  root.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: '運動カレンダー' }),
    h('p', { class: 'empty', text: '準備中です（段階③で追加します）。' }),
  ));
}
