#!/usr/bin/env python3
# Fail if a rendered PDF contains missing-glyph boxes (tofu). Typst emits no warning for glyphs no
# font covers (upstream issue #5137), and the blank-page gate cannot see tofu because a box is ink.
# This scans real glyph ids with PyMuPDF get_texttrace; glyph id 0 is .notdef, i.e. tofu.
# Usage: python3 scripts/tofu-check.py book.pdf   -> exit 0 clean, exit 1 with page/char report.
import sys, fitz
def main(path):
    doc = fitz.open(path)
    bad = []
    for pno, page in enumerate(doc, 1):
        for span in page.get_texttrace():
            for ch in span.get("chars", []):
                # ch = (unicode, glyph_id, origin, bbox); glyph 0 is .notdef
                if ch[1] == 0 and ch[0] not in (0x20, 0xa0):  # ignore space codepoints
                    bad.append((pno, ch[0]))
    if bad:
        sample = ", ".join(f"p{p} U+{u:04X}({chr(u) if u>31 else '?'})" for p, u in bad[:8])
        print(f"TOFU: {len(bad)} missing glyph(s) in {path}: {sample}", file=sys.stderr)
        return 1
    print(f"tofu-check clean: {path} ({doc.page_count} pages, no missing glyphs)")
    return 0
if __name__ == "__main__":
    if len(sys.argv) != 2: print("usage: tofu-check.py file.pdf", file=sys.stderr); sys.exit(2)
    sys.exit(main(sys.argv[1]))
