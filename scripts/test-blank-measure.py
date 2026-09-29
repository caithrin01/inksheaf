#!/usr/bin/env python3
"""Physical PDF controls for blank detection, including invisible image pixels."""
import hashlib
import io
import json
import subprocess
import tempfile
from pathlib import Path

import pymupdf as fitz
from PIL import Image

with tempfile.TemporaryDirectory(prefix='inksheaf-blank-') as tmp:
    root = Path(tmp)
    pdf = root / 'controls.pdf'
    output = root / 'measurement.json'
    transparent = io.BytesIO()
    Image.new('RGBA', (80, 80), (0, 0, 0, 0)).save(transparent, 'PNG')
    with fitz.open() as doc:
        for n in range(6):
            page = doc.new_page(width=432, height=648)
            page.insert_text((60, 40), 'Running header')
            page.insert_text((205, 625), str(n + 1))
            if n == 0:  # A substantial photograph occupies the page.
                page.draw_rect(fitz.Rect(50, 90, 380, 570), color=None, fill=(.3, .3, .3))
            elif n == 1:  # An accidentally stranded prose line must remain flagged.
                page.insert_text((60, 105), 'Stranded source sentence.', fontsize=11)
            elif n == 2:  # Ink near the bottom cannot hide a large internal gap.
                for rect in [(50, 90, 380, 150), (50, 505, 380, 570)]:
                    page.draw_rect(fitz.Rect(rect), color=None, fill=(.3, .3, .3))
            elif n == 3:  # An entirely empty body, despite its running matter.
                pass
            elif n == 4:  # Transparent pixels must stay white, not become ink.
                page.insert_image(fitz.Rect(50, 90, 380, 570), stream=transparent.getvalue())
            else:  # The whole landscape page is measured in its displayed orientation.
                page.draw_rect(fitz.Rect(0, 0, 432, 648), color=None, fill=(.3, .3, .3))
                page.set_rotation(90)
        doc.save(pdf)
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    command = ['python3', 'scripts/blank-measure.py', str(pdf), '--json', str(output)]
    run = subprocess.run(command, capture_output=True, text=True)
    assert run.returncode == 1, run.stderr
    result = json.loads(output.read_text())
    assert result['raster']['engine'] == 'MuPDF' and result['raster']['dpi'] == 30
    assert len(result['pages']) == 6
    assert [p['page'] for p in result['bad']] == [2, 4, 5]
    assert result['pages'][0]['ink_rows'] > .8
    assert result['pages'][1]['blank'] > .8
    assert result['pages'][2]['hole'] > .6 and result['pages'][2]['blank'] < .1
    assert result['pages'][3]['blank'] == result['pages'][4]['blank'] == 1
    assert result['pages'][5]['blank'] < .02 and result['pages'][5]['ink_rows'] > .98
    # Structural exemptions affect refusal only; they cannot erase measurements.
    skipped = subprocess.run(command + ['--skip', '2,4,5'], capture_output=True, text=True)
    assert skipped.returncode == 0, skipped.stderr
    after = json.loads(output.read_text())
    assert not after['bad'] and len(after['pages']) == 6
    for before, current in zip(result['pages'], after['pages']):
        assert {k: v for k, v in before.items() if k != 'exempt'} == {
            k: v for k, v in current.items() if k != 'exempt'
        }
    metadata = root / 'metadata.json'
    metadata.write_text(json.dumps({'artend': [{'page': 2}]}))
    hybrid = subprocess.run(command + ['--metadata', str(metadata)], capture_output=True, text=True)
    assert hybrid.returncode == 1, hybrid.stderr
    combined = json.loads(output.read_text())
    assert combined['raster']['article_end_pages'] == [2]
    assert [p['page'] for p in combined['bad']] == [2, 4, 5]
    for n in (0, 2, 3, 4, 5):
        assert combined['pages'][n] == result['pages'][n], 'Unrelated pages changed'
    # A measurement failure must not masquerade as a spacing-only refusal,
    # even when a previous result exists beside the same PDF.
    retained = output.read_bytes()
    metadata.write_text(json.dumps({'artend': [{'page': 7}]}))
    invalid = subprocess.run(command + ['--metadata', str(metadata)], capture_output=True, text=True)
    assert invalid.returncode == 2 and 'MEASUREMENT FAILED' in invalid.stderr
    assert output.read_bytes() == retained
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == digest, 'Measurement changed the PDF'
print('PASS blank/sparse/internal-gap, transparency, rotation and exemption controls; PDF unchanged')
