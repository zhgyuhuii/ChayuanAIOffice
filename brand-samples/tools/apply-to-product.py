#!/usr/bin/env python3
"""37 号家族 → 产品资产：
1. cand-1 logo → 方圆去背 → apps/shell/src/renderer/src/assets/logo.png（1024 画布，内容 88%）
2. 8 文件图标 → 方圆去背 256px → shell renderer assets（file-docx/xlsx/pptx/md/pdf/html/dwg/mind.png）
3. 菜单图标 16/32px → apps/shell/src/main/assets/menu-{docx,xlsx,pptx,pdf,md,html}{,@2x}.png
4. boot-logo 256px → docs/slides/markdown/html/pdf renderer assets + apps/web/src/assets/
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path("/Users/zyh/work/chayuan-office")
SRC = ROOT / "brand-samples/icons-v2/37-wps-mix"
SHELL_ASSETS = ROOT / "apps/shell/src/renderer/src/assets"
MAIN_ASSETS = ROOT / "apps/shell/src/main/assets"

def detect_bbox(im: Image.Image):
    """非背景（非四角色）像素的包围盒"""
    px = im.convert("RGB").load()
    w, h = im.size
    bg = px[2, 2]
    def is_fg(x, y):
        r, g, b = px[x, y]
        return abs(r-bg[0]) + abs(g-bg[1]) + abs(b-bg[2]) > 60
    left = next((x for x in range(w) if any(is_fg(x, y) for y in range(0, h, 4))), 0)
    right = next((x for x in range(w-1, -1, -1) if any(is_fg(x, y) for y in range(0, h, 4))), w-1)
    top = next((y for y in range(h) if any(is_fg(x, y) for x in range(0, w, 4))), 0)
    bottom = next((y for y in range(h-1, -1, -1) if any(is_fg(x, y) for x in range(0, w, 4))), h-1)
    return left, top, right + 1, bottom + 1

def squircle_rgba(path: Path, size: int) -> Image.Image:
    """裁出方圆主体、按圆角半径做透明 alpha，返回 RGBA"""
    im = Image.open(path).convert("RGB")
    bbox = detect_bbox(im)
    im = im.crop(bbox)
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w-side)//2, (h-side)//2, (w-side)//2 + side, (h-side)//2 + side))
    radius = round(side * 0.225)  # 标准 app icon squircle 比例
    ss = 4
    mask = Image.new("L", (side*ss, side*ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, side*ss-1, side*ss-1], radius=radius*ss, fill=255)
    mask = mask.resize((side, side), Image.LANCZOS)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out.resize((size, size), Image.LANCZOS)

# 1. logo 母图：1024 画布、内容 88%
logo = squircle_rgba(SRC / "logo.jpg", 892)
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
canvas.paste(logo, ((1024-892)//2, (1024-892)//2), logo)
canvas.save(SHELL_ASSETS / "logo.png")
print("logo.png written (1024, content 892)")

# 2. 文件图标 256px
members = {"doc": "file-docx.png", "xls": "file-xlsx.png", "ppt": "file-pptx.png", "md": "file-md.png",
           "pdf": "file-pdf.png", "html": "file-html.png", "mind": "file-mind.png", "dwg": "file-dwg.png"}
for slug, name in members.items():
    squircle_rgba(SRC / f"{slug}.jpg", 256).save(SHELL_ASSETS / name)
    print(name, "written")

# 3. 菜单图标 16/@2x32
for slug, menu in [("doc", "docx"), ("xls", "xlsx"), ("ppt", "pptx"), ("pdf", "pdf"), ("md", "md"), ("html", "html")]:
    icon = squircle_rgba(SRC / f"{slug}.jpg", 32)
    icon.resize((16, 16), Image.LANCZOS).save(MAIN_ASSETS / f"menu-{menu}.png")
    icon.save(MAIN_ASSETS / f"menu-{menu}@2x.png")
    print(f"menu-{menu}(.png/@2x) written")

# 4. boot-logo 256px
boot = squircle_rgba(SRC / "logo.jpg", 256)
targets = [
    ROOT / "apps/docs/src/renderer/assets",
    ROOT / "apps/slides/src/renderer/assets",
    ROOT / "apps/markdown/src/renderer/assets",
    ROOT / "apps/html/src/renderer/assets",
    ROOT / "apps/pdf/src/renderer/assets",
    ROOT / "apps/web/src/assets",
]
for t in targets:
    t.mkdir(parents=True, exist_ok=True)
    boot.save(t / "boot-logo.png")
    print(t / "boot-logo.png", "written")
print("DONE")
