#!/usr/bin/env python3
"""Generates all PNG assets for the "Balance Pro" watch face.

Everything is drawn at 4x and downsampled for clean anti-aliasing.
Run:  python3 tools/generate_assets.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "balance.r")
IMG = os.path.join(OUT, "images")
os.makedirs(IMG, exist_ok=True)

SS = 4  # supersampling factor
SIZE = 480
C = SIZE / 2

BG = (11, 13, 16)
WHITE = (236, 238, 241)
GREY = (120, 126, 136)
DARK = (38, 42, 48)
ACCENT = (255, 122, 26)
BLUE = (64, 196, 255)
RED = (255, 70, 85)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_COND = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def canvas(w, h, color=(0, 0, 0, 0)):
    img = Image.new("RGBA", (w * SS, h * SS), color)
    return img, ImageDraw.Draw(img)


def finish(img, w, h, path):
    img.resize((w, h), Image.LANCZOS).save(path)


def polar(cx, cy, r, deg):
    a = math.radians(deg - 90)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def radial_line(d, cx, cy, r1, r2, deg, width, fill):
    p1 = polar(cx, cy, r1, deg)
    p2 = polar(cx, cy, r2, deg)
    d.line([tuple(v * SS for v in p1), tuple(v * SS for v in p2)], fill=fill, width=int(width * SS))


def font(path, size):
    return ImageFont.truetype(path, int(size * SS))


def centered_text(d, x, y, text, fnt, fill):
    d.text((x * SS, y * SS), text, font=fnt, fill=fill, anchor="mm")


def subdial(d, cx, cy, r, track=None):
    s = SS
    d.ellipse([(cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s], fill=(18, 21, 25), outline=DARK, width=2 * s)
    tr = r - 6  # matches ARC_PROGRESS radius in watchface/index.js
    d.ellipse([(cx - tr - 2.5) * s, (cy - tr - 2.5) * s, (cx + tr + 2.5) * s, (cy + tr + 2.5) * s],
              outline=track or DARK, width=int(5 * s))


def draw_dial(aod=False):
    img, d = canvas(SIZE, SIZE, (0, 0, 0, 255))
    s = SS
    if not aod:
        # subtle radial vignette
        grad = Image.new("L", (SIZE * s, SIZE * s), 0)
        gd = ImageDraw.Draw(grad)
        steps = 60
        for i in range(steps):
            r = C * s * (1 - i / steps)
            v = int(10 + 18 * (i / steps))
            gd.ellipse([C * s - r, C * s - r, C * s + r, C * s + r], fill=v)
        base = Image.new("RGBA", grad.size, BG + (255,))
        lit = Image.new("RGBA", grad.size, (30, 34, 40, 255))
        img = Image.composite(lit, base, grad.point(lambda v: min(255, v * 6)))
        d = ImageDraw.Draw(img)
        # outer chapter ring
        d.ellipse([4 * s, 4 * s, (SIZE - 4) * s, (SIZE - 4) * s], outline=DARK, width=2 * s)

    tick_col = (70, 74, 80) if aod else WHITE
    minor_col = (45, 48, 52) if aod else GREY
    for i in range(60):
        deg = i * 6
        if i % 5 == 0:
            continue
        radial_line(d, C, C, 226, 214, deg, 2, minor_col)
    for h in range(12):
        deg = h * 30
        if h == 0:
            # double baton at 12 in accent
            col = (110, 60, 20) if aod else ACCENT
            for off in (-3.2, 3.2):
                radial_line(d, C, C, 228, 190, deg + off, 7, col)
        elif h in (3, 6, 9):
            radial_line(d, C, C, 228, 196, deg, 8, tick_col)
        else:
            radial_line(d, C, C, 228, 202, deg, 5, tick_col)

    if not aod:
        # minute numerals on the rehaut
        f = font(FONT_COND, 12)
        for m in range(5, 60, 5):
            if m in (15, 30, 45):
                continue
            x, y = polar(C, C, 182, m * 6)
            centered_text(d, x, y, f"{m:02d}", f, GREY)
        subdial(d, 140, 240, 52)  # steps
        subdial(d, 340, 240, 52)  # battery
        subdial(d, 240, 340, 52, track=(70, 24, 30))  # heart rate
        fl = font(FONT_BOLD, 11)
        centered_text(d, 140, 276, "STEPS", fl, GREY)
        centered_text(d, 340, 276, "BATT", fl, GREY)
        centered_text(d, 240, 376, "BPM", fl, GREY)
        # brand
        centered_text(d, 240, 100, "BALANCE", font(FONT_BOLD, 15), WHITE)
        centered_text(d, 240, 118, "PRO  ·  ZEPP OS", font(FONT_COND, 10), ACCENT)
        # date window frame
        d.rounded_rectangle([196 * s, 136 * s, 284 * s, 166 * s], radius=6 * s, fill=(18, 21, 25), outline=DARK, width=2 * s)
    return img


def hand(w, length, tail, color, path, accent_tip=None, lume=True):
    """Vertical hand pointing up; rotation centre = (w/2, length)."""
    h = length + tail
    img, d = canvas(w, h)
    s = SS
    cx = w / 2
    # tapered body
    pts = [(cx - w * 0.5, length), (cx - w * 0.28, 8), (cx, 0), (cx + w * 0.28, 8), (cx + w * 0.5, length),
           (cx + w * 0.2, h), (cx - w * 0.2, h)]
    d.polygon([(x * s, y * s) for x, y in pts], fill=color)
    if lume:
        inner = [(cx - w * 0.22, length - 22), (cx - w * 0.14, 22), (cx, 14), (cx + w * 0.14, 22),
                 (cx + w * 0.22, length - 22)]
        d.polygon([(x * s, y * s) for x, y in inner], fill=(14, 16, 19))
        if accent_tip:
            d.polygon([(x * s, y * s) for x, y in inner[1:4]] + [(cx * s, 34 * s)], fill=accent_tip)
    finish(img, w, h, os.path.join(IMG, path))
    return w // 2, length


def second_hand(path, color):
    w, length, tail = 16, 206, 46
    h = length + tail
    img, d = canvas(w, h)
    s = SS
    cx = w / 2
    d.rectangle([(cx - 1.5) * s, 0, (cx + 1.5) * s, h * s], fill=color)
    d.rounded_rectangle([(cx - 4) * s, (length + 18) * s, (cx + 4) * s, (h - 2) * s], radius=3 * s, fill=color)
    d.ellipse([(cx - 7) * s, (length - 7) * s, (cx + 7) * s, (length + 7) * s], fill=color)
    finish(img, w, h, os.path.join(IMG, path))
    return w // 2, length


def center_cap(path, color, size=14):
    img, d = canvas(size, size)
    s = SS
    d.ellipse([0, 0, size * s - 1, size * s - 1], fill=color)
    d.ellipse([size * 0.32 * s, size * 0.32 * s, size * 0.68 * s, size * 0.68 * s], fill=(14, 16, 19))
    finish(img, size, size, os.path.join(IMG, path))


def icon_heart(path, size=20, color=RED):
    img, d = canvas(size, size)
    s = SS
    r = size * 0.27
    d.ellipse([size * 0.04 * s, size * 0.1 * s, (size * 0.04 + 2 * r) * s, (size * 0.1 + 2 * r) * s], fill=color)
    d.ellipse([(size * 0.96 - 2 * r) * s, size * 0.1 * s, size * 0.96 * s, (size * 0.1 + 2 * r) * s], fill=color)
    d.polygon([(size * 0.06 * s, size * 0.42 * s), (size * 0.94 * s, size * 0.42 * s), (size * 0.5 * s, size * 0.92 * s)],
              fill=color)
    finish(img, size, size, os.path.join(IMG, path))


def icon_store(path, size):
    """Square store / app-list icon based on the dial."""
    dial = draw_dial().resize((SIZE, SIZE), Image.LANCZOS)
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, SIZE - 1, SIZE - 1], fill=255)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(dial, (0, 0), mask)
    out.resize((size, size), Image.LANCZOS).save(path)


def digit_font(folder, size, color, extra=None):
    """0-9 digit images of identical width (required by TEXT_IMG)."""
    os.makedirs(os.path.join(IMG, folder), exist_ok=True)
    f = font(FONT_BOLD, size)
    glyphs = {str(i): str(i) for i in range(10)}
    glyphs.update(extra or {})
    boxes = [f.getbbox(t) for t in "0123456789"]
    w = max(b[2] - b[0] for b in boxes) // SS + 2
    asc, desc = f.getmetrics()
    h = int(size * 1.2)
    for name, text in glyphs.items():
        gw = w if name.isdigit() else (f.getbbox(text)[2] - f.getbbox(text)[0]) // SS + 2
        img, d = canvas(gw, h)
        d.text((gw * SS / 2, h * SS / 2), text, font=f, fill=color, anchor="mm")
        finish(img, gw, h, os.path.join(IMG, folder, f"{name}.png"))
    return w, h


def week_images(folder, names, size, color):
    os.makedirs(os.path.join(IMG, folder), exist_ok=True)
    f = font(FONT_BOLD, size)
    w, h = 46, int(size * 1.3)
    for i, n in enumerate(names):
        img, d = canvas(w, h)
        d.text((w * SS / 2, h * SS / 2), n, font=f, fill=color, anchor="mm")
        finish(img, w, h, os.path.join(IMG, folder, f"{i}.png"))
    return w, h


if __name__ == "__main__":
    finish(draw_dial(), SIZE, SIZE, os.path.join(IMG, "bg.png"))
    finish(draw_dial(aod=True), SIZE, SIZE, os.path.join(IMG, "bg_aod.png"))
    print("hour", hand(22, 138, 22, WHITE, "hour.png", accent_tip=ACCENT))
    print("minute", hand(18, 200, 22, WHITE, "minute.png", accent_tip=ACCENT))
    print("second", second_hand("second.png", ACCENT))
    print("hour_aod", hand(22, 138, 22, (150, 152, 156), "hour_aod.png"))
    print("minute_aod", hand(18, 200, 22, (150, 152, 156), "minute_aod.png"))
    center_cap("center.png", ACCENT)
    center_cap("center_aod.png", (150, 152, 156))
    icon_heart("heart.png")
    print("data font", digit_font("num", 22, WHITE, {"percent": "%", "dash": "--"}))
    print("date font", digit_font("date", 18, WHITE))
    print("week en", week_images("week_en", ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], 16, ACCENT))
    icon_store(os.path.join(OUT, "icon.png"), 248)
    print("done ->", OUT)
