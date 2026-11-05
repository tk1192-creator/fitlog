// 記録を保存した後の処理: 自己ベスト・体重の節目・バッジの判定とお祝い表示、家族への報告（LINE）
import { evaluateSave } from './pb.js';
import { celebrate } from './celebrate.js';
import { pbReportText, queueReport, shareSettings, shareablePb } from './share.js';
import { getConfig as cloudConfig } from './cloud.js';
import { earnedBadgeIds, evaluateBadges, milestoneState } from './badges.js';
import { fmtNum } from './calc.js';

const LIST_KEY = { weight: 'weights', strength: 'strength', jog: 'jogs', daily: 'daily' };

/** 体重の節目とバッジで、新しく届いたもの（純粋関数）。celebrated が null なら、保存前の記録で届いていた分はお祝い済みとみなす */
export function newAchievements(data, kind, recId) {
  const before = { ...data, [LIST_KEY[kind]]: (data[LIST_KEY[kind]] || []).filter((x) => x.id !== recId) };
  const done = data.settings.celebrated || {
    milestones: milestoneState(before)?.reached || [],
    badges: earnedBadgeIds(before),
  };
  const ms = milestoneState(data);
  const newMilestones = ms ? ms.reached.filter((v) => !done.milestones.includes(v)) : [];
  const newBadges = evaluateBadges(data).filter((b) => b.earned && !done.badges.includes(b.id));
  const messages = [];
  // 一度に複数の節目を越えたときは、いちばん目標に近いものだけを伝える
  if (newMilestones.length) {
    const v = ms.dir === 'loss' ? Math.min(...newMilestones) : Math.max(...newMilestones);
    messages.push({ type: 'milestone', text: `🎯 節目の ${fmtNum(v)}kg を${ms.dir === 'loss' ? '下回りました' : '超えました'}！（7 日平均 ${fmtNum(ms.current, 1)}kg）` });
  }
  for (const b of newBadges) messages.push({ type: 'badge', text: `${b.icon} バッジ獲得：${b.name}` });
  return {
    messages,
    celebrated: {
      milestones: [...new Set([...done.milestones, ...newMilestones])],
      badges: [...new Set([...done.badges, ...newBadges.map((b) => b.id)])],
    },
    changed: !data.settings.celebrated || newMilestones.length > 0 || newBadges.length > 0,
  };
}

/**
 * 新規保存のときだけ判定する（編集時は判定しない。入力ミスの修正でお祝いが出ないように）。
 * @returns {boolean} お祝い表示をした場合は true（呼び出し側の「保存しました」を省く）
 */
export function afterSave(app, kind, rec, isEdit) {
  if (isEdit) return false;
  const pbMessages = evaluateSave(kind, rec, app.data);
  let extra = { messages: [], changed: false };
  try {
    extra = newAchievements(app.data, kind, rec.id);
  } catch (e) {
    console.warn('バッジ・節目の判定に失敗しました', e); // 記録の保存には影響させない
  }
  if (extra.changed) app.update((d) => { d.settings.celebrated = extra.celebrated; });

  const messages = [...pbMessages, ...extra.messages];
  if (!messages.length) return false;
  celebrate(messages);

  // 家族への報告（LINE）：設定がオンで、GitHub への保存を設定済みのときだけ。送信は次の同期で行う
  const s = shareSettings(app.data);
  if (s.enabled && s.pb && cloudConfig()) {
    for (const m of pbMessages) {
      if (shareablePb(kind, m, s)) queueReport(pbReportText(app.data, m.text));
    }
  }
  return true;
}
