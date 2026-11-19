"""App icons: gold capture brackets around a faceted gem on near-black.
python3 scripts/make_icons.py  → web/icons/*.png and ios/AppIcon-1024.png"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BG, GOLD, GOLD2 = (13, 15, 20), (240, 186, 74), (201, 150, 42)

def icon(size, maskable=False, rounded=True):
    S = 4 * size  # draw big, downsample for smooth edges
    im = Image.new("RGBA", (S, S), BG + (255,))
    d = ImageDraw.Draw(im)
    pad = int(S * (0.22 if maskable else 0.16))
    l, t, r, b = pad, pad, S - pad, S - pad
    w = max(6, S // 26); arm = int((r - l) * 0.28)
    for (x, y, dx, dy) in [(l, t, 1, 1), (r, t, -1, 1), (l, b, 1, -1), (r, b, -1, -1)]:
        d.line([(x, y + dy * arm), (x, y), (x + dx * arm, y)], fill=GOLD, width=w, joint="curve")
    cx, cy, gw = S // 2, int(S * 0.53), int((r - l) * 0.46)
    top, mid, bot = cy - int(gw * 0.42), cy - int(gw * 0.12), cy + int(gw * 0.55)
    crown = [(cx - gw // 2, mid), (cx - gw // 4, top), (cx + gw // 4, top), (cx + gw // 2, mid)]
    d.polygon(crown + [(cx, bot)], fill=GOLD2)
    d.polygon([(cx - gw // 2, mid), (cx - gw // 4, top), (cx, mid)], fill=GOLD)
    d.polygon([(cx, mid), (cx + gw // 4, top), (cx + gw // 2, mid)], fill=GOLD)
    d.polygon([(cx - gw // 2, mid), (cx, mid), (cx, bot)], fill=(226, 170, 60))
    out = im.resize((size, size), Image.LANCZOS)
    if rounded and not maskable:
        m = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=size * 4 * 0.22, fill=255)
        out.putalpha(m.resize((size, size), Image.LANCZOS))
    return out

web = ROOT / "web" / "icons"; web.mkdir(parents=True, exist_ok=True)
icon(192).save(web / "icon-192.png")
icon(512).save(web / "icon-512.png")
icon(512, maskable=True).save(web / "maskable-512.png")
icon(180, rounded=False).convert("RGB").save(web / "apple-touch-180.png")
ios = ROOT / "ios"; ios.mkdir(exist_ok=True)
icon(1024, rounded=False).convert("RGB").save(ios / "AppIcon-1024.png")  # App Store: no alpha, no rounding
print("icons written")
