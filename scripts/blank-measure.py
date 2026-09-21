#!/usr/bin/env python3
# Blank-page measure for a rendered PDF, engine-agnostic. For each page: the fraction of the text
# block (12% to 92% of the page height, which excludes the running head and the folio) that lies
# below the last ink row. Pages in --skip (front and back matter, part pages, closers) are exempt.
# Usage: blank-measure.py book.pdf [--limit 0.40] [--skip 1,2,3] [--json out.json]
# Prints one line: "BLANK ok pages=N worst=0.31" or "BLANK over 40%: 22 (65%), 48 (48%)" and exits 1.
# MuPDF renders one grayscale page in memory at a time. Final PDF compilation
# and the higher-resolution Poppler evidence used by visual review are separate.
import sys, json, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import pymupdf as fitz
from PIL import Image
def main():
    args = sys.argv[1:]; pdf = args[0]; limit = 0.40; skip = set(); out = None; metadata = None
    for i, a in enumerate(args):
        if a == "--limit": limit = float(args[i + 1])
        if a == "--skip": skip = set(int(x) for x in args[i + 1].split(",") if x.strip())
        if a == "--json": out = args[i + 1]
        if a == "--metadata": metadata = args[i + 1]
    def measure(im, number):
        w, h = im.size; px = im.load()
        top, bot = int(h * 0.12), int(h * 0.92); last = top; first = None; rows = 0; hole = 0; run = 0; hole_at = 0
        for y in range(top, bot):
            if any(px[x, y] < 200 for x in range(int(w * 0.1), int(w * 0.9), 2)):
                if first is not None and run > hole: hole, hole_at = run, y - run
                run = 0; last = y; rows += 1
                if first is None: first = y
            else: run += 1
        return {"page": number, "blank": round((bot - last) / (bot - top), 3), "exempt": number in skip,
                      "ink_top": round(((first if first is not None else bot) - top) / (bot - top), 3), "ink_rows": round(rows / (bot - top), 3),
                      "hole": round(hole / (bot - top), 3), "hole_at": round((hole_at - top) / (bot - top), 3)}
    with fitz.open(pdf) as document:
        if not len(document): raise RuntimeError('Cannot measure a PDF without pages')
        # Text antialiasing changes ink-row counts near the fitting threshold. Keep
        # the existing measurements on article endings, where those counts choose
        # reference/leading/photo repairs. Their exemptions never suppress review.
        exact = set()
        if metadata:
            endings = json.loads(Path(metadata).read_text())['artend']
            for ending in endings:
                number = ending['page']
                if type(number) is not int or not 1 <= number <= len(document):
                    raise ValueError('Article ending lies outside the measured PDF')
                exact.add(number)
        pages = []
        for number, page in enumerate(document, 1):
            if number in exact:
                pages.append(None)
            else:
                pix = page.get_pixmap(dpi=30, colorspace=fitz.csGRAY, alpha=False)
                pages.append(measure(Image.frombytes('L', (pix.width, pix.height), pix.samples), number))
    if exact:
        with tempfile.TemporaryDirectory(prefix='inksheaf-ending-measure-') as tmp:
            def measure_ending(number):
                prefix = str(Path(tmp) / str(number))
                subprocess.run(['pdftoppm', '-png', '-gray', '-r', '30', '-f', str(number), '-l', str(number),
                                '-singlefile', pdf, prefix], check=True, stdout=subprocess.DEVNULL,
                               stderr=subprocess.PIPE, timeout=60)
                with Image.open(prefix + '.png') as image:
                    return number, measure(image.convert('L'), number)
            with ThreadPoolExecutor(max_workers=min(4, len(exact))) as pool:
                for number, measured in pool.map(measure_ending, sorted(exact)):
                    pages[number - 1] = measured
    bad = [p for p in pages if not p["exempt"] and p["blank"] > limit]
    body = [p["blank"] for p in pages if not p["exempt"]]
    if out:
        with open(out, "w") as target:
            json.dump({"limit": limit, "bad": bad, "pages": pages,
                       "raster": {"engine": "MuPDF", "version": fitz.VersionBind, "dpi": 30, "color": "gray",
                                  "article_end_engine": "Poppler", "article_end_pages": sorted(exact)}}, target)
    if bad:
        print("BLANK over %d%%: %s" % (round(limit * 100), ", ".join("%d (%d%%)" % (p["page"], round(p["blank"] * 100)) for p in bad))); sys.exit(1)
    print("BLANK ok pages=%d worst=%.2f" % (len(pages), max(body) if body else 0))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'MEASUREMENT FAILED: {error}', file=sys.stderr)
        raise SystemExit(2)
