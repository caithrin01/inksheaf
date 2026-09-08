#!/usr/bin/env python3
import subprocess
import tempfile
from pathlib import Path
from PIL import Image

with tempfile.TemporaryDirectory(prefix='inksheaf-image-test-') as tmp:
    root = Path(tmp)
    source = root / 'guessed-extension.img'
    Image.new('RGBA', (400, 200), (255, 0, 0, 0)).save(source, 'PNG')
    output = root / 'print.jpg'
    subprocess.run(['python3', 'scripts/normalize-print-image.py', str(source), str(output), '--bw', '--max-width', '200'], check=True)
    im = Image.open(output)
    assert im.format == 'JPEG' and im.mode == 'L'
    assert im.size == (200, 100)
    assert im.getpixel((100, 50)) >= 250, 'transparent pixels must print as white paper'
    Image.new('RGB', (400, 200), (200, 40, 20)).save(source, 'WEBP')
    subprocess.run(['python3', 'scripts/normalize-print-image.py', str(source), str(output)], check=True)
    im = Image.open(output)
    assert im.format == 'JPEG' and im.mode == 'RGB'
    assert im.getpixel((100, 50))[0] > im.getpixel((100, 50))[1] + 100
    subprocess.run(['python3', 'scripts/normalize-print-image.py', 'scripts/fixtures/print-heic.heic', str(output), '--bw'], check=True)
    im = Image.open(output)
    assert im.format == 'JPEG' and im.mode == 'L' and im.size == (120, 80)
    assert im.getpixel((60, 40)) > 245 and im.getpixel((15, 40)) < 110, 'HEIC pixels must survive decoding and grayscale conversion'
    source.write_bytes(b'not an image')
    failed = subprocess.run(['python3', 'scripts/normalize-print-image.py', str(source), str(root / 'broken.jpg')], capture_output=True)
    assert failed.returncode != 0 and not (root / 'broken.jpg').exists(), 'decode failure cannot masquerade as a print image'
print('8 print image checks passed')
