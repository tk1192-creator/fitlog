// 自己ベスト一覧
import { fmtNum, formatPace } from '../calc.js';
import { computeBests, PACE_MIN_KM } from '../pb.js';
import { fmtDateShort, h } from '../ui.js';

function row(label, value, sub) {
  return h('div', { class: 'best-row' },
    h('span', { class: 'best-label', text: label }),
    h('span', { class: 'best-value', text: value }),
    h('span', { class: 'best-sub', text: sub || '' }),
  );
}

export function renderBestList(root, app) {
  const b = computeBests(app.data);

  // 筋トレ（設定の種目順 → それ以外）
  const names = [...app.data.exercises.filter((e) => b.strength[e]), ...Object.keys(b.strength).filter((e) => !app.data.exercises.includes(e))];
  const st = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: '筋トレ' }));
  if (!names.length) st.append(h('p', { class: 'empty', text: 'まだ記録がありません。' }));
  for (const ex of names) {
    const s = b.strength[ex];
    st.append(h('div', { class: 'best-group' },
      h('h3', { class: 'best-name', text: ex }),
      row('最大重量', `${fmtNum(s.maxWeight.value)}kg`, `${fmtDateShort(s.maxWeight.date)}（${s.maxWeight.reps}回）`),
      row('推定1RM', `${fmtNum(s.max1RM.value)}kg`, `${fmtDateShort(s.max1RM.date)}（${fmtNum(s.max1RM.weightKg)}kg×${s.max1RM.reps}回）`),
    ));
  }

  const jg = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'ジョギング' }));
  if (!b.jog.longest) jg.append(h('p', { class: 'empty', text: 'まだ記録がありません。' }));
  else {
    jg.append(row('最長距離', `${fmtNum(b.jog.longest.value, 2)}km`, fmtDateShort(b.jog.longest.date)));
    jg.append(b.jog.fastest
      ? row('最速ペース', `${formatPace(b.jog.fastest.value)}/km`, `${fmtDateShort(b.jog.fastest.date)}（${fmtNum(b.jog.fastest.distanceKm, 2)}km）`)
      : row('最速ペース', '-', `${PACE_MIN_KM}km 以上の記録が対象`));
  }

  const wt = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: '体重' }));
  if (!b.weight.lowest) wt.append(h('p', { class: 'empty', text: 'まだ記録がありません。' }));
  else {
    wt.append(row('最低体重', `${fmtNum(b.weight.lowest.value)}kg`, fmtDateShort(b.weight.lowest.date)));
    if (b.weight.target) {
      wt.append(row(`目標 ${fmtNum(b.weight.target)}kg`, b.weight.goalAchieved ? '達成 🏆' : '未達成',
        b.weight.goalAchieved ? `${fmtDateShort(b.weight.goalAchieved.date)}（${fmtNum(b.weight.goalAchieved.value)}kg）` : ''));
    }
  }

  root.append(
    h('p', { class: 'card-note', text: '記録全体から計算しています。記録を編集・削除すると自動で更新されます。' }),
    st, jg, wt,
  );
}
