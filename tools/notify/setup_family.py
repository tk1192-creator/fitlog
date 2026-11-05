"""STRIDE 家族の部屋の準備（管理者が 1 回だけ実行する）

使い方（PowerShell などで。GitHub CLI の gh にログイン済みであること）:
    python tools/notify/setup_family.py tk1192-creator/stride-family tk1192-creator/stride-backup tk1192-creator/stride-wife
    （1 つ目が家族の部屋、2 つ目以降が家族それぞれの保存先）

行うこと:
  1. 家族の部屋（非公開リポジトリ）がなければ作る
  2. 通知用の鍵（VAPID）を 1 組作り、家族の部屋と各保存先のすべてに同じ鍵を設定する
     （家族のメッセージの通知と、入力忘れのお知らせを、同じ端末の登録で受け取れるようにするため）
     ※ 秘密鍵は画面にもファイルにも残さない（gh に標準入力で渡すだけ）
  3. 家族の部屋に、メッセージの通知の仕組み（.github/workflows/family.yml・.github/scripts/family.mjs）を置く
  4. 各保存先の、入力忘れのお知らせの仕組みを最新にする

注意: 鍵を作り直すので、すでに通知を受け取っている端末は、設定画面で
     「この端末の通知を止める」→「この端末で通知を受け取る」をやり直す必要があります。
必要なもの: Python 3、cryptography（pip install cryptography）、gh（repo・workflow の権限）
"""
import json
import pathlib
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from setup_notify import FILES as MEMBER_FILES, b64url, gh, put_file  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
FAMILY_FILES = {
    ".github/workflows/family.yml": HERE / "family.yml",
    ".github/scripts/family.mjs": HERE / "family.mjs",
}


def ensure_private_repo(repo: str):
    try:
        info = json.loads(gh("api", f"repos/{repo}"))
    except RuntimeError:
        gh("repo", "create", repo, "--private", "--description", "STRIDE 家族の部屋（メッセージ・応援。家族の合言葉で暗号化）")
        print(f"{repo}: 非公開リポジトリを作りました")
        return
    if not info.get("private"):
        raise SystemExit(f"{repo} は公開リポジトリです。中止しました（非公開のリポジトリを指定してください）")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if len(args) < 2 or any("/" not in r for r in args):
        print(__doc__)
        sys.exit(1)
    family, members = args[0], args[1:]
    print("この操作で、通知の鍵を作り直します（家族の部屋と、次の保存先すべてに同じ鍵を設定します）:")
    for r in [family, *members]:
        print(f"  - {r}")
    print("通知を受け取っている端末は、あとで設定画面から通知の登録をやり直す必要があります。")
    if "--yes" not in sys.argv and input("続けますか？ [y/N] ").strip().lower() != "y":
        print("中止しました")
        return

    ensure_private_repo(family)
    for r in members:
        if not json.loads(gh("api", f"repos/{r}")).get("private"):
            raise SystemExit(f"{r} は公開リポジトリです。中止しました")

    key = ec.generate_private_key(ec.SECP256R1())
    priv = b64url(key.private_numbers().private_value.to_bytes(32, "big"))
    pub = b64url(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    for r in [family, *members]:
        gh("secret", "set", "VAPID_PRIVATE_KEY", "--repo", r, input_text=priv)
        gh("secret", "set", "VAPID_PUBLIC_KEY", "--repo", r, input_text=pub)
        put_file(r, "notify/vapid-public.txt", pub, "STRIDE 通知の公開鍵を設定（家族で共通）")
        files = FAMILY_FILES if r == family else MEMBER_FILES
        for dest, src in files.items():
            put_file(r, dest, src.read_text(encoding="utf-8"), "STRIDE 通知の仕組みを設定")
        print(f"{r}: 鍵と通知の仕組みを設定しました")
    del priv

    print()
    print("完了しました。次の 2 つを行ってください:")
    print(f"  1. GitHub のトークンの画面で、家族それぞれのトークンの対象リポジトリに {family} を追加する（Contents: Read and write）")
    print("  2. 各端末の STRIDE で「設定 → この端末の通知を止める → この端末で通知を受け取る」をやり直し、")
    print("     「設定 → 家族の部屋」に家族の部屋の名前と家族の合言葉を入れる")


if __name__ == "__main__":
    main()
