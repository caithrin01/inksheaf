#!/usr/bin/env python3
"""Decode once to an explicit print format; never preserve an unsupported HEIC container.

Pillow handles ordinary web images. HEIC can use the system's decoder (sips on
macOS, ImageMagick on Linux). Missing decoders fail visibly to the builder.
"""
import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path
from PIL import Image, ImageOps

p = argparse.ArgumentParser()
p.add_argument('source')
p.add_argument('destination')
p.add_argument('--bw', action='store_true')
p.add_argument('--max-width', type=int, default=2700)
a = p.parse_args()

with tempfile.TemporaryDirectory(prefix='inksheaf-image-') as tmp:
    try:
        im = Image.open(a.source)
        im.load()
    except (OSError, ValueError):
        decoded = str(Path(tmp) / 'decoded.png')
        if shutil.which('sips'):
            command = ['sips', '-s', 'format', 'png', a.source, '--out', decoded]
        elif shutil.which('magick'):
            command = ['magick', a.source + '[0]', decoded]
        elif shutil.which('heif-convert'):
            command = ['heif-convert', a.source, decoded]
        else:
            raise RuntimeError('Image needs an HEIC-capable decoder (sips, ImageMagick or heif-convert).')
        subprocess.run(command, check=True, capture_output=True, timeout=60)
        im = Image.open(decoded)
        im.load()
    im = ImageOps.exif_transpose(im).convert('RGBA')
    # Paper is white; composite alpha before grayscale rather than making it black.
    paper = Image.new('RGBA', im.size, 'white')
    paper.alpha_composite(im)
    im = paper.convert('L' if a.bw else 'RGB')
    if im.width > a.max_width:
        im = im.resize((a.max_width, round(im.height * a.max_width / im.width)), Image.Resampling.LANCZOS)
    im.save(a.destination, 'JPEG', quality=95, dpi=(300, 300))
