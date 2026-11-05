// 記録を保存した後の処理: 自己ベスト判定とお祝い表示、家族への報告（LINE）
import { evaluateSave } from './pb.js';
import { celebrate } from './celebrate.js';
import { pbReportText, queueReport, shareSettings, shareablePb } from './share.js';
import { getConfig as cloudConfig } from './cloud.js';

/**
 * 新規保存のときだけ判定する（編集時は判定しない。入力ミスの修正でお祝いが出ないように）。
 * @returns {boolean} お祝い表示をした場合は true（呼び出し側の「保存しました」を省く）
 */
export function afterSave(app, kind, rec, isEdit) {
  if (isEdit) return false;
  const messages = evaluateSave(kind, rec, app.data);
  if (!messages.length) return false;
  celebrate(messages);

  // 家族への報告（LINE）：設定がオンで、GitHub への保存を設定済みのときだけ。送信は次の同期で行う
  const s = shareSettings(app.data);
  if (s.enabled && s.pb && cloudConfig()) {
    for (const m of messages) {
      if (shareablePb(kind, m, s)) queueReport(pbReportText(app.data, m.text));
    }
  }
  return true;
}
