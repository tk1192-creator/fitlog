// 自己ベスト一覧（段階②で実装）
import { h } from '../ui.js';

export function renderBestList(root) {
  root.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: '自己ベスト一覧' }),
    h('p', { class: 'empty', text: '準備中です（段階②で追加します）。' }),
  ));
}
