#!/usr/bin/env python3
"""Composites the generated assets into store preview images
(mirrors the widget layout in watchface/index.js)."""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "assets", "balance.r", "images")
OUT = os.path.join(ROOT, "store")
os.makedirs(OUT, exist_ok=True)


def load(p):
    return Image.open(os.path.join(IMG, p)).convert("RGBA")


def paste(base, im, x, y):
    base.alpha_composite(im, (int(round(x)), int(round(y))))


def hand(base, path, px, py, deg, cx=240, cy=240):
    im = load(path)
    # put the pivot at the centre of a big canvas, then rotate around it
    big = Image.new("RGBA", (480, 480), (0, 0, 0, 0))
    big.alpha_composite(im, (240 - px, 240 - py))
    big = big.rotate(-deg, resample=Image.BICUBIC, center=(240, 240))
    base.alpha_composite(big, (cx - 240, cy - 240))


def text_img(base, folder, s, cx, cy, w=96, unit=None):
    ims = [load(f"{folder}/{c}.png") for c in s]
    if unit:
        ims.append(load(unit))
    total = sum(i.width for i in ims)
    x = cx - w / 2 + (w - total) / 2
    for i in ims:
        paste(base, i, x, cy - i.height / 2)
        x += i.width


def arc(base, cx, cy, pct, color, r=46, lw=5):
    d = ImageDraw.Draw(base)
    if pct > 0:
        d.arc([cx - r - lw / 2, cy - r - lw / 2, cx + r + lw / 2, cy + r + lw / 2], -90, -90 + 360 * pct, fill=color, width=lw)


def render(h, m, s, week, day, steps, step_pct, batt, hr, aod=False):
    base = load("bg_aod.png" if aod else "bg.png")
    if not aod:
        paste(base, load(f"week_en/{week}.png"), 200, 141)
        x = 250
        for c in f"{day:02d}":
            im = load(f"date/{c}.png")
            paste(base, im, x, 141)
            x += im.width
        arc(base, 140, 240, step_pct, (255, 122, 26))
        text_img(base, "num", str(steps), 140, 236)
        arc(base, 340, 240, batt / 100, (64, 196, 255))
        text_img(base, "num", str(batt), 340, 236, unit="num/percent.png")
        paste(base, load("heart.png"), 230, 304)
        text_img(base, "num", str(hr), 240, 342)
    suffix = "_aod" if aod else ""
    hand(base, f"hour{suffix}.png", 11, 138, (h % 12) * 30 + m * 0.5)
    hand(base, f"minute{suffix}.png", 9, 200, m * 6 + s * 0.1)
    if not aod:
        hand(base, "second.png", 8, 206, s * 6)
        paste(base, load("center.png"), 233, 233)
    else:
        paste(base, load("center_aod.png"), 233, 233)
    mask = Image.new("L", (480, 480), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, 479, 479], fill=255)
    out = Image.new("RGBA", (480, 480), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


if __name__ == "__main__":
    render(10, 8, 36, 5, 10, 8452, 0.85, 76, 72).save(os.path.join(OUT, "preview.png"))
    render(10, 8, 36, 5, 10, 8452, 0.85, 76, 72, aod=True).save(os.path.join(OUT, "preview_aod.png"))
    render(10, 8, 36, 5, 10, 8452, 0.85, 76, 72).resize((248, 248), Image.LANCZOS).save(
        os.path.join(ROOT, "assets", "balance.r", "icon.png"))
    print("previews ->", OUT)
