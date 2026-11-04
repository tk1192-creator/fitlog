import { test, eq } from './harness.js';
import { summarizeTasks } from '../js/views/home-tasks.js';

const T = (id, due, status = 'todo', extra = {}) => ({ id, title: id, due, status, ...extra });

test('今日のタスク: 期限切れ・今日が期限・作業中を数える（完了は除く）', () => {
  const s = summarizeTasks([
    T('a', '2026-11-01'), T('b', '2026-11-03', 'doing'), T('c', '2026-11-04'), T('d', '2026-11-04', 'done'),
    T('e', '2026-11-10', 'doing'), T('f', '2026-10-01', 'done'),
  ], '2026-11-04');
  eq([s.overdue, s.dueToday, s.doing, s.openCount], [2, 1, 2, 4]);
});
test('今日のタスク: 表示順は 期限切れ（古い順）→ 今日が期限 → 今日やる、重複なし', () => {
  const s = summarizeTasks([
    T('later', '2026-11-20', 'todo', { myDay: '2026-11-04' }), T('today', '2026-11-04', 'todo', { myDay: '2026-11-04' }),
    T('old2', '2026-11-02'), T('old1', '2026-10-30'),
  ], '2026-11-04');
  eq(s.list.map((t) => t.id), ['old1', 'old2', 'today', 'later']);
  eq(s.myDay, 2);
});
test('今日のタスク: 期限のない不正なデータは無視する', () => {
  const s = summarizeTasks([null, { id: 'x', status: 'todo' }, T('ok', '2026-11-04')], '2026-11-04');
  eq([s.openCount, s.dueToday], [1, 1]);
});
