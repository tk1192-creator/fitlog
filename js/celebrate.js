// お祝い表示: 紙吹雪（canvas-confetti）とメッセージ
import { h } from './ui.js';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function burst(options) {
  if (typeof window.confetti !== 'function' || reduceMotion()) return;
  window.confetti({ disableForReducedMotion: true, zIndex: 200, ...options });
}

/** 自己ベスト用の紙吹雪 */
function confettiPB() {
  burst({ particleCount: 110, spread: 75, origin: { y: 0.65 } });
}

/** 目標達成用の特別な紙吹雪（左右から 2.5 秒間） */
function confettiGoal() {
  if (typeof window.confetti !== 'function' || reduceMotion()) return;
  const end = Date.now() + 2500;
  const colors = ['#eda100', '#eb6834', '#2a78d6', '#e87ba4', '#ffffff'];
  (function frame() {
    burst({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors });
    burst({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  setTimeout(() => burst({ particleCount: 180, spread: 120, startVelocity: 45, origin: { y: 0.5 }, colors, scalar: 1.2 }), 400);
}

/**
 * メッセージを表示する。
 * @param {{type: 'pb'|'first'|'goal', text: string}[]} messages
 */
export function celebrate(messages) {
  const hasGoal = messages.some((m) => m.type === 'goal');
  const hasPB = messages.some((m) => m.type === 'pb');

  if (hasGoal) confettiGoal();
  else if (hasPB) confettiPB();

  const title = hasGoal ? '目標達成！' : hasPB ? '自己ベスト更新！' : '初記録！';
  const icon = hasGoal ? '🏆' : hasPB ? '🎉' : '📝';

  document.querySelector('.celebrate')?.remove();
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };
  const el = h('div', { class: `celebrate${hasGoal ? ' celebrate-goal' : ''}`, role: 'alertdialog', 'aria-live': 'assertive', 'aria-label': title, onclick: close },
    h('div', { class: 'celebrate-card', onclick: (e) => e.stopPropagation() },
      h('div', { class: 'celebrate-icon', 'aria-hidden': 'true', text: icon }),
      h('h2', { class: 'celebrate-title', text: title }),
      h('ul', { class: 'celebrate-list' }, messages.map((m) => h('li', { class: `msg-${m.type}`, text: m.text }))),
      h('button', { type: 'button', class: 'btn btn-primary btn-block', text: hasGoal ? 'やったー！' : 'OK', onclick: close }),
    ),
  );
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  el.querySelector('button').focus();
}
