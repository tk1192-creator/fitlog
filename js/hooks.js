// 記録を保存した後の処理（段階②で自己ベスト判定・お祝い表示を追加する）

/**
 * @returns {boolean} 独自のメッセージを表示した場合は true（呼び出し側の「保存しました」を省く）
 */
export function afterSave(_app, _kind, _rec, _isEdit) {
  return false;
}
