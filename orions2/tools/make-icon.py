#!/usr/bin/env python3
"""Generate the Orions 2 launcher icon without external art.

The card sprites are only 100x94, so blowing one up to 1024px turns into
mush. This draws a vector-style emblem instead: an astrolabe ring (the game is
named after Orion), a six-pointed star for the six elements, and a burning
gemstone in the middle. Everything is drawn at 4x and downsampled, so the
edges stay crisp at every launcher size.

    python3 tools/make-icon.py
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/icon')
S = 1024
K = 4                      # supersampling factor
GOLD = (232, 201, 126)
GOLD_DIM = (168, 132, 70)
GOLD_DARK = (110, 82, 40)
EMBER = (255, 92, 40)
EMBER_HOT = (255, 176, 96)


def radial_base(size):
    """Warm black radial gradient with a hint of ember at the centre."""
    small = 192
    im = Image.new('RGB', (small, small))
    px = im.load()
    cx = cy = small / 2
    for y in range(small):
        for x in range(small):
            d = math.hypot(x - cx, y - cy) / (small * 0.62)
            d = min(1.0, d)
            t = d ** 0.9
            r = int(46 * (1 - t) + 9 * t)
            g = int(20 * (1 - t) + 8 * t)
            b = int(10 * (1 - t) + 7 * t)
            px[x, y] = (r, g, b)
    return im.resize((size, size), Image.BICUBIC)


def star_points(cx, cy, r_out, r_in, points=6, rot=-math.pi / 2):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + i * math.pi / points
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def draw_star_of_david(d, cx, cy, r, width, fill):
    """Two overlapping triangles -> six-pointed star outline."""
    for off in (0, math.pi / 3):
        pts = [(cx + math.cos(off + i * 2 * math.pi / 3 - math.pi / 2) * r,
                cy + math.sin(off + i * 2 * math.pi / 3 - math.pi / 2) * r) for i in range(3)]
        d.line(pts + [pts[0]], fill=fill, width=width, joint='curve')


def build_master(size=S):
    W = size * K
    base = radial_base(W).convert('RGBA')

    # --- faint starfield -------------------------------------------------
    star = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    sd = ImageDraw.Draw(star)
    rnd = random.Random(20498)
    for _ in range(150):
        a = rnd.random() * math.pi * 2
        r = (0.10 + rnd.random() * 0.86) * W * 0.5
        x = W / 2 + math.cos(a) * r
        y = W / 2 + math.sin(a) * r
        rr = rnd.choice([1.2, 1.6, 2.2, 3.0]) * K
        alpha = int(30 + rnd.random() * 90)
        sd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 240, 210, alpha))
    star = star.filter(ImageFilter.GaussianBlur(0.6 * K))
    base.alpha_composite(star)

    # --- ember glow behind the gem --------------------------------------
    glow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(50):
        t = i / 50
        r = W * (0.30 - 0.26 * t)
        a = int(120 * (1 - t) ** 2)
        gd.ellipse([W / 2 - r, W / 2 - r, W / 2 + r, W / 2 + r], fill=EMBER + (a,))
    glow = glow.filter(ImageFilter.GaussianBlur(W * 0.02))
    base.alpha_composite(glow)

    ring = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    cx = cy = W / 2
    R = W * 0.437

    # outer ring, thick with a darker inner edge for depth
    rd.ellipse([cx - R, cy - R, cx + R, cy + R], outline=GOLD + (255,), width=int(W * 0.016))
    rd.ellipse([cx - R, cy - R, cx + R, cy + R], outline=GOLD_DARK + (200,), width=int(W * 0.004))
    # inner thin ring
    R2 = W * 0.372
    rd.ellipse([cx - R2, cy - R2, cx + R2, cy + R2], outline=GOLD_DIM + (150,), width=int(W * 0.003))

    # tick marks between the two rings
    for i in range(72):
        a = i * math.pi * 2 / 72 - math.pi / 2
        major = i % 6 == 0
        r1 = R - W * 0.016
        r2 = r1 - (W * 0.022 if major else W * 0.010)
        rd.line([(cx + math.cos(a) * r1, cy + math.sin(a) * r1),
                 (cx + math.cos(a) * r2, cy + math.sin(a) * r2)],
                fill=(GOLD if major else GOLD_DIM) + ((230 if major else 120),),
                width=int(W * (0.006 if major else 0.003)))

    # six-pointed star for the six elements
    draw_star_of_david(rd, cx, cy, W * 0.295, int(W * 0.012), GOLD + (235,))
    draw_star_of_david(rd, cx, cy, W * 0.295, int(W * 0.004), (255, 236, 190, 120))

    ring = ring.filter(ImageFilter.GaussianBlur(0.35 * K))
    halo = ring.filter(ImageFilter.GaussianBlur(W * 0.012))
    base.alpha_composite(halo)
    base.alpha_composite(ring)

    # --- centre gem ------------------------------------------------------
    # A molten core: deep crimson rim burning to a white-hot centre. Drawn as
    # stacked discs so it stays smooth at every size.
    gem = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    md = ImageDraw.Draw(gem)
    gr = W * 0.126
    steps = 90
    for i in range(steps):
        t = i / steps                       # 0 = rim, 1 = core
        r = gr * (1 - t)
        cc = (int(118 + 137 * t ** 1.35),
              int(16 + 176 * t ** 1.7),
              int(6 + 86 * t ** 2.1))
        md.ellipse([cx - r, cy - r, cx + r, cy + r], fill=cc + (255,))
    md.ellipse([cx - gr, cy - gr, cx + gr, cy + gr], outline=(255, 214, 150, 215),
               width=int(W * 0.0065))
    gem = gem.filter(ImageFilter.GaussianBlur(0.7 * K))

    # small specular dot instead of a wide arc (an arc washed the core out)
    hl = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hx, hy = cx - gr * 0.26, cy - gr * 0.30
    hr = gr * 0.30
    hd.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(255, 244, 214, 190))
    hl = hl.filter(ImageFilter.GaussianBlur(gr * 0.42))
    gem.alpha_composite(hl)

    # outer bloom, kept subtle so it does not grey out the core
    glow2 = gem.filter(ImageFilter.GaussianBlur(W * 0.030))
    glow2.putalpha(glow2.getchannel('A').point(lambda v: int(v * 0.55)))
    base.alpha_composite(glow2)
    base.alpha_composite(gem)

    # --- corner sparks + vignette ---------------------------------------
    deco = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    dd = ImageDraw.Draw(deco)
    for ang in (45, 135, 225, 315):
        a = math.radians(ang)
        x = cx + math.cos(a) * (R + W * 0.028)
        y = cy + math.sin(a) * (R + W * 0.028)
        rr = W * 0.010
        dd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 236, 190, 210))
    deco = deco.filter(ImageFilter.GaussianBlur(W * 0.004))
    base.alpha_composite(deco.filter(ImageFilter.GaussianBlur(W * 0.012)))
    base.alpha_composite(deco)

    # Corner darkening only: the ring must not crawl toward the centre, or the
    # gem picks up a grey haze.
    vig = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vig)
    for i in range(24):
        t = i / 24
        r = W * (0.56 - 0.10 * t)
        vd.ellipse([cx - r, cy - r, cx + r, cy + r],
                   outline=(0, 0, 0, int(46 + 70 * t)), width=int(W * 0.05))
    vig = vig.filter(ImageFilter.GaussianBlur(W * 0.05))
    base.alpha_composite(vig)

    return base.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    master = build_master()
    # Keep the master in tools/ — a 800 KB PNG has no business shipping inside
    # the APK's assets folder.
    master.save(os.path.join(ROOT, 'tools/icon-master.png'))

    res = os.path.join(ROOT, '..', 'android', 'res')
    for dpi, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        d = os.path.join(res, 'mipmap-' + dpi)
        if os.path.isdir(d):
            master.resize((px, px), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'))

    # Adaptive foreground: emblem inside the 66dp safe zone of a 108dp canvas.
    fg_px = 432
    fg = Image.new('RGBA', (fg_px, fg_px), (0, 0, 0, 0))
    disc = int(fg_px * 0.84)
    emblem = master.resize((disc, disc), Image.LANCZOS)
    # Punch out the corners: adaptive icons are masked by the launcher, and a
    # black square inside the circle looks like a sticker.
    mask = Image.new('L', (disc * 4, disc * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, disc * 4 - 1, disc * 4 - 1], fill=255)
    mask = mask.resize((disc, disc), Image.LANCZOS)
    emblem.putalpha(mask)
    fg.alpha_composite(emblem, ((fg_px - disc) // 2, (fg_px - disc) // 2))
    fg.save(os.path.join(res, 'drawable-nodpi', 'ic_launcher_foreground.png'))

    master.resize((520, 520), Image.LANCZOS).save(
        os.path.join(res, 'drawable-nodpi', 'splash_logo.png'))
    master.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, 'favicon.png'))
    print('icon written:', os.path.join(ROOT, 'tools/icon-master.png'))


if __name__ == '__main__':
    main()
