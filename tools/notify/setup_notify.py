"""STRIDE 入力忘れのお知らせの準備（管理者が 1 回だけ実行する）

使い方（PowerShell などで。GitHub CLI の gh にログイン済みであること）:
    python tools/notify/setup_notify.py tk1192-creator/stride-backup tk1192-creator/stride-wife

行うこと（指定した保存先リポジトリごと）:
  1. 通知用の鍵（VAPID、P-256）を新しく作る
  2. 秘密鍵・公開鍵を、そのリポジトリの Actions のシークレット（VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY）に保存する
     ※ 秘密鍵は画面にもファイルにも残さない（gh に標準入力で渡すだけ）
  3. 公開鍵を notify/vapid-public.txt に置く（アプリが通知を登録するときに読む。公開してよい値）
  4. 送信の仕組み（.github/workflows/remind.yml と .github/scripts/remind.mjs）を置く

2 回目以降は、鍵はそのまま（作り直さない）で、送信の仕組みだけを最新にする。
鍵を作り直したいときだけ --rotate を付ける。作り直すと、各端末で通知の登録をやり直す必要がある
（設定画面で「この端末の通知を止める」→「この端末で通知を受け取る」）。
    python tools/notify/setup_notify.py --rotate tk1192-creator/stride-backup
必要なもの: Python 3、cryptography（pip install cryptography）、gh（repo・workflow の権限）
"""
import base64
import json
import pathlib
import subprocess
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

HERE = pathlib.Path(__file__).resolve().parent
FILES = {
    ".github/workflows/remind.yml": HERE / "remind.yml",
    ".github/scripts/remind.mjs": HERE / "remind.mjs",
}


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def gh(*args, input_text=None):
    r = subprocess.run(["gh", *args], input=input_text, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args[:3])} … に失敗しました: {r.stderr.strip()}")
    return r.stdout


def put_file(repo: str, path: str, text: str, message: str):
    sha = None
    try:
        sha = json.loads(gh("api", f"repos/{repo}/contents/{path}"))["sha"]
    except RuntimeError:
        pass  # まだない
    body = {"message": message, "content": base64.b64encode(text.encode("utf-8")).decode()}
    if sha:
        body["sha"] = sha
    gh("api", "-X", "PUT", f"repos/{repo}/contents/{path}", "--input", "-", input_text=json.dumps(body))


def has_file(repo: str, path: str) -> bool:
    try:
        gh("api", f"repos/{repo}/contents/{path}")
        return True
    except RuntimeError:
        return False


def main():
    args = sys.argv[1:]
    rotate = "--rotate" in args
    repos = [a for a in args if a != "--rotate"]
    if not repos or any("/" not in r for r in repos):
        print(__doc__)
        sys.exit(1)
    for repo in repos:
        info = json.loads(gh("api", f"repos/{repo}"))
        if not info.get("private"):
            print(f"{repo}: 公開リポジトリのため中止しました（非公開のリポジトリを指定してください）")
            continue
        # すでに鍵がある場合は作り直さない（作り直すと、登録済みの端末に通知が届かなくなるため）
        if has_file(repo, "notify/vapid-public.txt") and not rotate:
            for dest, src in FILES.items():
                put_file(repo, dest, src.read_text(encoding="utf-8"), "STRIDE 入力忘れのお知らせの仕組みを更新")
            print(f"{repo}: 鍵はそのままで、送信の仕組みだけを更新しました（鍵を作り直すときは --rotate）")
            continue
        key = ec.generate_private_key(ec.SECP256R1())
        priv = b64url(key.private_numbers().private_value.to_bytes(32, "big"))
        pub = b64url(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        gh("secret", "set", "VAPID_PRIVATE_KEY", "--repo", repo, input_text=priv)
        gh("secret", "set", "VAPID_PUBLIC_KEY", "--repo", repo, input_text=pub)
        del priv
        put_file(repo, "notify/vapid-public.txt", pub, "STRIDE 通知の公開鍵を設定")
        for dest, src in FILES.items():
            put_file(repo, dest, src.read_text(encoding="utf-8"), "STRIDE 入力忘れのお知らせの仕組みを設定")
        print(f"{repo}: 準備しました（鍵をシークレットに保存、送信の仕組みと公開鍵を配置）")
    print("完了しました。各端末の STRIDE で「設定 → この端末で通知を受け取る」を押してください。")


if __name__ == "__main__":
    main()
