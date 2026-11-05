// ホーム画面の「先週のふりかえり」カード（v2.6.0）。月〜水曜だけ表示し、× で閉じるとその週は出さない
import { fmtNum, todayStr } from '../calc.js';
import { lastWeekReview, shouldShowReview } from '../review.js';
import { h } from '../ui.js';
import { signed, stat } from './home-goal.js';

const md = (str) => { const [, m, d] = str.split('-').map(Number); return `${m}/${d}`; };

export function reviewCard(app) {
  const today = todayStr();
  const r = lastWeekReview(app.data, today);
  if (!shouldShowReview(app.data, today, r)) return null;

  const diffDays = r.days - r.prevDays;
  const stats = [
    stat('運動した日', `${r.days} 日`, r.achieved ? `目標 ${r.goal} 日 達成🎉` : `目標 ${r.goal} 日まであと ${r.goal - r.days} 日`),
    stat('前の週と比べて', diffDays === 0 ? '同じ' : `${diffDays > 0 ? '+' : ''}${diffDays} 日`, `前の週は ${r.prevDays} 日`),
  ];
  if (r.strengthDays || r.jogKm) {
    stats.push(stat('筋トレ', `${r.strengthDays} 日`), stat('ジョギング', `${fmtNum(r.jogKm, 1)} km`));
  }
  if (r.weightAvg != null) {
    stats.push(stat('体重（週の平均）', `${fmtNum(r.weightAvg, 1)}kg`, r.weightDiff == null ? '' : `前の週と比べて ${signed(r.weightDiff)}kg`));
  }

  const card = h('section', { class: 'card review-card' },
    h('div', { class: 'review-head' },
      h('h2', { class: 'card-title', text: `先週のふりかえり（${md(r.weekStart)}〜${md(r.weekEnd)}）` }),
      h('button', {
        type: 'button', class: 'review-close', 'aria-label': '先週のふりかえりを閉じる', text: '×',
        onclick: () => app.update((d) => { d.settings.reviewDismissed = r.weekStart; }),
      }),
    ),
    h('div', { class: 'stats' }, stats),
  );

  const highlights = [
    ...r.pbs.slice(-3).map((e) => `🎉 ${e.text}`),
    ...r.badges.map((b) => `${b.icon} バッジ獲得：${b.name}`),
  ];
  if (r.pbs.length > 3) highlights.unshift(`🎉 自己ベスト更新 ${r.pbs.length} 件（最近の 3 件）`);
  if (highlights.length) card.append(h('ul', { class: 'review-list' }, highlights.map((t) => h('li', { text: t }))));

  card.append(h('p', { class: 'review-message', text: r.achieved
    ? `いいペースです！ 今週も ${r.goal} 日を目指しましょう。`
    : r.days > 0 ? `先週は ${r.days} 日。今週は ${r.goal} 日を目指しましょう。` : `今週は 1 日から。予定を決めておくと続けやすくなります。` }));
  if (r.badges.length) {
    card.append(h('button', { type: 'button', class: 'btn btn-block', text: 'バッジを見る', onclick: () => app.navigate('charts', { kind: 'bests' }) }));
  }
  return card;
}
