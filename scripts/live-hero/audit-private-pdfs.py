#!/usr/bin/env python3
"""Local PDF checks and review sheets. No upload and no automatic whitespace exemptions."""
import concurrent.futures
import json
import subprocess
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

root = Path('output/private-acceptance')
destination = root / 'review-final'
destination.mkdir(exist_ok=True)
pdfs = sorted(root.glob('*/interior.pdf'))
if len(sys.argv) > 1:
    pdfs = [pdf for pdf in pdfs if pdf.parent.name in sys.argv[1:]]


def audit(pdf):
    directory = pdf.parent
    for script, arguments in [
        ('pdf-whitespace-audit.py', ['--typ', str(directory / 'interior.typ'), '--out', str(directory / 'whitespace.json')]),
        ('pdf-bounds-audit.py', ['--out', str(directory / 'bounds.json')]),
    ]:
        subprocess.run(['python3', 'scripts/' + script, str(pdf), *arguments], check=True)
    data = json.loads((directory / 'whitespace.json').read_text())
    doc = fitz.open(pdf)
    rows = [row for row in data['pages'] if row['over30']]
    sheets = []
    for offset in range(0, len(rows), 12):
        subset = rows[offset:offset + 12]
        sheet = Image.new('RGB', (1600, 1875), '#d2d0ca')
        draw = ImageDraw.Draw(sheet)
        for number, row in enumerate(subset):
            pix = doc[row['page'] - 1].get_pixmap(matrix=fitz.Matrix(.86, .86), alpha=False)
            image = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
            x, y = (number % 4) * 400 + 14, (number // 4) * 625 + 52
            sheet.paste(image, (x, y))
            draw.text((x, y - 37), f"{directory.name[:31]} p{row['page']}\n{row['kind']} {row['unused']:.0%} unused", fill='black')
        path = destination / f'{directory.name}-{offset // 12 + 1:02d}.png'
        sheet.save(path)
        sheets.append({'sheet': str(path), 'host': directory.name, 'sha256': data['sha256'], 'pages': subset})
    (destination / f'{directory.name}.json').write_text(json.dumps(sheets, indent=2) + '\n')
    return sheets


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results = list(pool.map(audit, pdfs))
index = [sheet for result in results for sheet in result]
(destination / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
print(json.dumps({'pdfs': len(pdfs), 'sheets': len(index), 'pages_for_review': sum(len(sheet['pages']) for sheet in index)}))
