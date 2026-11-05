"""STRIDE の通知を LINE で受け取る準備（管理者が 1 回だけ実行する）

使い方（PowerShell などで。GitHub CLI の gh にログイン済みであること）:
    python tools/notify/setup_line.py tk1192-creator/stride-backup tk1192-creator/stride-wife

行うこと:
  1. LINE 公式アカウントのチャネルアクセストークン（長期）を入力してもらう（画面には表示しない）
     → LINE に問い合わせて、正しい鍵かを確かめる（公式アカウントの名前を表示）
  2. 指定した保存先リポジトリごとに:
     - 鍵を Actions のシークレット LINE_CHANNEL_ACCESS_TOKEN に保存
     - その保存先の持ち主の LINE ユーザー ID（U で始まる）を聞き、入力されたら LINE_USER_ID に保存
       （入力忘れのお知らせを LINE で 1 対 1 に送るときだけ必要。空欄なら省略）
     - 送信の仕組み（入力忘れ・今週のふりかえり・自己ベストの報告）を最新にする
鍵やユーザー ID はファイルに残さない（gh に標準入力で渡すだけ）。
"""
import getpass
import json
import sys
import urllib.error
import urllib.request

from setup_notify import FILES, gh, put_file


def check_token(token: str) -> str:
    req = urllib.request.Request("https://api.line.me/v2/bot/info", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8")).get("displayName", "(名前なし)")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"LINE の鍵が正しくないようです（{e.code}）。LINE Developers で発行し直してください")


def main():
    repos = sys.argv[1:]
    if not repos or any("/" not in r for r in repos):
        print(__doc__)
        sys.exit(1)
    token = getpass.getpass("LINE のチャネルアクセストークン（長期）を貼り付けて Enter（画面には表示されません）: ").strip()
    if not token:
        raise SystemExit("鍵が入力されませんでした")
    name = check_token(token)
    print(f"LINE 公式アカウント「{name}」の鍵を確認しました")
    for repo in repos:
        info = json.loads(gh("api", f"repos/{repo}"))
        if not info.get("private"):
            print(f"{repo}: 公開リポジトリのため中止しました")
            continue
        gh("secret", "set", "LINE_CHANNEL_ACCESS_TOKEN", "--repo", repo, input_text=token)
        uid = input(f"{repo} の持ち主の LINE ユーザー ID（入力忘れを LINE でも受け取る場合。不要なら空欄で Enter）: ").strip()
        if uid:
            if not (uid.startswith("U") and len(uid) == 33):
                print("  ユーザー ID の形式が違うようです（U で始まる 33 文字）。この保存先では省略しました")
            else:
                gh("secret", "set", "LINE_USER_ID", "--repo", repo, input_text=uid)
        for dest, src in FILES.items():
            put_file(repo, dest, src.read_text(encoding="utf-8"), "STRIDE の通知を LINE でも受け取れるようにする")
        print(f"{repo}: 準備しました")
    del token
    print("完了しました。STRIDE の「設定 → LINE で家族に報告」をオンにすると、家族に報告が届きます。")


if __name__ == "__main__":
    main()
