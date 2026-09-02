#!/usr/bin/env python3
# Blank-page measure for a rendered PDF, engine-agnostic. For each page: the fraction of the text
# block (12% to 92% of the page height, which excludes the running head and the folio) that lies
# below the last ink row. Pages in --skip (front and back matter, part pages, closers) are exempt.
# Usage: blank-measure.py book.pdf [--limit 0.40] [--skip 1,2,3] [--json out.json]
# Prints one line: "BLANK ok pages=N worst=0.31" or "BLANK over 40%: 22 (65%), 48 (48%)" and exits 1.
# Needs pdftoppm (poppler) and Pillow.
import sys, subprocess, glob, tempfile, json
from PIL import Image
args = sys.argv[1:]; pdf = args[0]; limit = 0.40; skip = set(); out = None
for i, a in enumerate(args):
    if a == "--limit": limit = float(args[i + 1])
    if a == "--skip": skip = set(int(x) for x in args[i + 1].split(",") if x.strip())
    if a == "--json": out = args[i + 1]
d = tempfile.mkdtemp()
subprocess.run(["pdftoppm", "-r", "30", "-gray", "-png", pdf, f"{d}/p"], check=True)
files = sorted(glob.glob(f"{d}/p-*.png"))
pages = []
for i, f in enumerate(files, 1):
    im = Image.open(f).convert("L"); w, h = im.size; px = im.load()
    top, bot = int(h * 0.12), int(h * 0.92); last = top
    for y in range(top, bot):
        if any(px[x, y] < 200 for x in range(int(w * 0.1), int(w * 0.9), 2)): last = y
    pages.append({"page": i, "blank": round((bot - last) / (bot - top), 3), "exempt": i in skip})
bad = [p for p in pages if not p["exempt"] and p["blank"] > limit]
body = [p["blank"] for p in pages if not p["exempt"]]
if out: json.dump({"limit": limit, "bad": bad, "pages": pages}, open(out, "w"))
if bad:
    print("BLANK over %d%%: %s" % (round(limit * 100), ", ".join("%d (%d%%)" % (p["page"], round(p["blank"] * 100)) for p in bad))); sys.exit(1)
print("BLANK ok pages=%d worst=%.2f" % (len(pages), max(body) if body else 0))
