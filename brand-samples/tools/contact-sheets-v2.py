#!/usr/bin/env python3
"""icons-v2/family-*/ → contact-sheets-v2/family-XX.png 九宫格速览（3×3，成员名标注：logo+8 格式）"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "icons-v2"
OUT = ROOT / "contact-sheets-v2"
THUMB, PAD, LABEL_H, TITLE_H = 340, 12, 44, 56

ORDER = ["logo", "doc", "xls", "ppt", "md", "pdf", "html", "mind", "dwg"]
LABELS = {"logo": "logo", "doc": "DOC", "xls": "XLS", "ppt": "PPT", "md": "MD",
          "pdf": "PDF", "html": "HTML", "mind": "MIND", "dwg": "DWG"}

FAMILY_ZH = {
    "01": "品牌蓝紫渐变", "02": "多彩糖果便签", "03": "墨线手绘", "04": "新拟物浅盘",
    "05": "深色玻璃拟物", "06": "极简线框", "07": "复古丝网印刷", "08": "霓虹暗底",
    "09": "茶园绿意", "10": "3D 陶瓷软质感", "11": "WPS 参考风",
    "12": "WPS 风·朱红经典", "13": "WPS 风·深海蓝", "14": "WPS 风·翡翠", "15": "WPS 风·紫罗兰",
    "16": "WPS 风·暖橙日落", "17": "WPS 风·青碧薄荷", "18": "WPS 风·石墨商务", "19": "WPS 风·樱粉",
    "20": "WPS 风·靛夜", "21": "WPS 风·暖沙大地",
    "22": "Office 风·Fluent 磁贴", "23": "Office 风·经典横带", "24": "Office 风·软圆角", "25": "Office 风·深色",
    "26": "Office 风·竖条侧签", "27": "Office 风·细带极简", "28": "Office 风·磁贴居中", "29": "Office 风·暖调环境",
    "30": "Office 风·冷调环境", "31": "Office 风·高饱和满彩", "32": "WPS 经典·横条徽标", "33": "WPS 经典·圆形徽标", "34": "WPS 经典·方圆徽标", "35": "WPS 经典·描边徽标", "36": "WPS 经典·折角着色", "37": "WPS 经典·混搭定稿",
}

FONT_PATHS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]

def font(size, bold=False):
    for p in FONT_PATHS:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size, index=1 if bold else 0)
            except Exception:
                continue
    return ImageFont.load_default()

def main():
    OUT.mkdir(exist_ok=True)
    title_font = font(30, bold=True)
    label_font = font(22)
    for fam_dir in sorted(SRC.iterdir()):
        if not fam_dir.is_dir():
            continue
        cells = []
        for slug in ORDER:
            f = fam_dir / f"{slug}.jpg"
            if f.exists():
                cells.append((slug, f))
        if len(cells) < 9:
            print(f"skip {fam_dir.name}: {len(cells)}/9")
            continue
        W = 3 * THUMB + 4 * PAD
        H = TITLE_H + 3 * (THUMB + LABEL_H) + 4 * PAD
        sheet = Image.new("RGB", (W, H), "#f5f5f7")
        draw = ImageDraw.Draw(sheet)
        zh = FAMILY_ZH.get(fam_dir.name[:2], "")
        draw.text((PAD + 4, 12), f"{fam_dir.name[:2]}  {zh}", fill="#111", font=title_font)
        for i, (slug, f) in enumerate(cells):
            r, c = divmod(i, 3)
            x = PAD + c * (THUMB + PAD)
            y = TITLE_H + PAD + r * (THUMB + LABEL_H + PAD)
            im = Image.open(f).convert("RGB").resize((THUMB, THUMB), Image.LANCZOS)
            sheet.paste(im, (x, y))
            draw.rectangle([x, y, x + THUMB - 1, y + THUMB - 1], outline="#d0d0d5", width=1)
            draw.text((x + 8, y + THUMB + 8), LABELS[slug], fill="#333", font=label_font)
        out = OUT / f"{fam_dir.name}.png"
        sheet.save(out)
        print(f"sheet {out.name}: {len(cells)} cells")

if __name__ == "__main__":
    main()
