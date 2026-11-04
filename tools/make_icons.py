"""fitlog のアプリアイコンを生成する。
使い方: python tools/make_icons.py icons   （要 Pillow: pip install pillow）
- icon-512.png / icon-192.png : 通常アイコン（角丸は OS 側で付く前提で全面塗り）
- icon-maskable-512.png       : Android のマスク用（図柄を中央 80% の安全領域に収める）
- apple-touch-icon.png (180)  : iPhone のホーム画面用
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024  # 高解像度で描いてから縮小（アンチエイリアスのため）


def gradient(size):
    """左上 #0c2040 → 右下 #2a78d6 の斜めグラデーション"""
    a = (0x0C, 0x20, 0x40)
    b = (0x2A, 0x78, 0xD6)
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return img


def draw_icon(scale):
    """scale: 図柄の大きさ（1.0 = 通常、0.78 = マスク用の安全領域）"""
    img = gradient(S).convert("RGBA")
    d = ImageDraw.Draw(img)
    c = S / 2

    def p(x, y):  # 図柄座標（-0.5〜0.5）→ 画素
        return (c + x * S * scale, c + y * S * scale)

    # 斜めのライン装飾（右上）
    deco = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dd = ImageDraw.Draw(deco)
    for k in range(-6, 7):
        off = k * 70
        dd.line([(S * 0.55 + off, -50), (S + 50 + off, S * 0.45)], fill=(255, 255, 255, 22), width=14)
    img = Image.alpha_composite(img, deco)
    d = ImageDraw.Draw(img)

    # 右肩上がりのグラフ線（白）
    pts = [p(-0.34, 0.20), p(-0.12, 0.02), p(0.04, 0.12), p(0.30, -0.18)]
    w = round(S * scale * 0.075)
    d.line(pts, fill="white", width=w, joint="curve")
    r = w / 2
    for q in pts[:-1]:
        d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill="white")
    # 終点の矢印
    tip = p(0.36, -0.25)
    d.polygon([tip, p(0.17, -0.22), p(0.33, -0.06)], fill="white")
    # 始点のオレンジの点
    s0 = pts[0]
    R = w * 0.95
    d.ellipse([s0[0] - R, s0[1] - R, s0[0] + R, s0[1] + R], fill="#eb6834", outline="white", width=round(w * 0.35))

    # 下部の「FITLOG」風のバー（3 本の棒グラフ）
    base_y = 0.38
    for i, h in enumerate([0.08, 0.13, 0.18]):
        x0 = -0.30 + i * 0.13
        d.rounded_rectangle([p(x0, base_y - h), p(x0 + 0.08, base_y)], radius=round(S * scale * 0.015), fill=(255, 255, 255, 150))
    return img.convert("RGB")


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    normal = draw_icon(1.0)
    maskable = draw_icon(0.78)
    for name, img, size in [
        ("icon-512.png", normal, 512),
        ("icon-192.png", normal, 192),
        ("apple-touch-icon.png", normal, 180),
        ("icon-maskable-512.png", maskable, 512),
    ]:
        img.resize((size, size), Image.LANCZOS).save(out / name, optimize=True)
        print("wrote", out / name)


if __name__ == "__main__":
    main()
