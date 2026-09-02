#!/usr/bin/env python3
# Resample an image for print: anything wider than MAXW px is scaled to MAXW (300 ppi across the
# 6 x 9 text block is 1350 px; 2700 keeps a full-bleed reserve), re-encoded as JPEG at quality 88
# or PNG when it has transparency or is small. Keeps the file under a few hundred KB instead of
# several MB, so a 44-essay interior stays well under the proof store's cap. Pillow only.
# Usage: resample-image.py in out [maxw]
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]; maxw = int(sys.argv[3]) if len(sys.argv) > 3 else 2700
im = Image.open(src)
if getattr(im, "n_frames", 1) > 1: im.seek(0)
im.load()
w, h = im.size
if w > maxw: im = im.resize((maxw, round(h * maxw / w)), Image.LANCZOS)
if im.mode in ("RGBA", "LA", "P") and dst.lower().endswith(".png"):
    im.save(dst, "PNG", optimize=True)
else:
    if im.mode not in ("RGB", "L"): im = im.convert("RGB")
    im.save(dst, "JPEG", quality=88, optimize=True, progressive=True)
print(f"{w}x{h} -> {im.size[0]}x{im.size[1]}")
