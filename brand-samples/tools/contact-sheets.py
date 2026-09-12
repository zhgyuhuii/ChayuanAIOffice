#!/usr/bin/env python3
"""group-*/NN.jpg → contact-sheets/group-XX.png 九宫格速览图（3×3，组名标题+序号标注）"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
THUMB = 340
PAD = 12
LABEL_H = 40
TITLE_H = 56

GROUP_LABELS = {
    "01": "渐变几何·三件套",
    "02": "字母 C monogram",
    "03": "对话气泡×文档",
    "04": "扁平徽章印章",
    "05": "3D 玻璃陶瓷",
    "06": "极简线条",
    "07": "茶园彩蛋·茶芽",
    "08": "复古丝网印刷",
    "09": "深色霓虹",
    "10": "折纸构成",
}

FONT_PATHS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]

def font(size):
    for p in FONT_PATHS:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

def main():
    icons_dir = ROOT / "icons"
    out_dir = ROOT / "contact-sheets"
    out_dir.mkdir(exist_ok=True)
    title_font = font(30)
    num_font = font(24)
    for group_dir in sorted(icons_dir.iterdir()):
        if not group_dir.is_dir():
            continue
        files = sorted(group_dir.glob("*.jpg"))
        if len(files) < 9:
            print(f"skip {group_dir.name}: {len(files)}/9 imgs")
            continue
        cols, rows = 3, 3
        W = cols * THUMB + (cols + 1) * PAD
        H = TITLE_H + rows * (THUMB + LABEL_H) + (rows + 1) * PAD
        sheet = Image.new("RGB", (W, H), "#f5f5f7")
        draw = ImageDraw.Draw(sheet)
        zh = GROUP_LABELS.get(group_dir.name[:2], "")
        title = f"{group_dir.name[:2]}  {zh}"
        draw.text((PAD + 4, 12), title, fill="#111", font=title_font)
        for i, f in enumerate(files):
            r, c = divmod(i, cols)
            x = PAD + c * (THUMB + PAD)
            y = TITLE_H + PAD + r * (THUMB + LABEL_H + PAD)
            im = Image.open(f).convert("RGB").resize((THUMB, THUMB), Image.LANCZOS)
            sheet.paste(im, (x, y))
            draw.rectangle([x, y, x + THUMB - 1, y + THUMB - 1], outline="#d0d0d5", width=1)
            draw.text((x + 8, y + THUMB + 6), f"#{i+1:02d}", fill="#333", font=num_font)
        out = out_dir / f"{group_dir.name}.png"
        sheet.save(out)
        print(f"sheet {out.name}: {len(files)} imgs")

if __name__ == "__main__":
    main()
