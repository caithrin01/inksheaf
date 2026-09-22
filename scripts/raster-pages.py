#!/usr/bin/env python3
"""Render disjoint page ranges with the existing Poppler renderer and options."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import os
import subprocess
import json
import re
import threading
import fitz
from contact_sheets import render_sheet

parser = argparse.ArgumentParser()
parser.add_argument('pdf')
parser.add_argument('prefix')
size = parser.add_mutually_exclusive_group(required=True)
size.add_argument('--scale', type=int)
size.add_argument('--dpi', type=int)
parser.add_argument('--gray', action='store_true')
parser.add_argument('--workers', type=int, default=min(4, os.cpu_count() or 1))
parser.add_argument('--sheet-dir')
parser.add_argument('--sheet-format', choices=['jpeg', 'png'], default='jpeg')
args = parser.parse_args()
if not 1 <= args.workers <= 8 or (args.scale or args.dpi) < 1:
    parser.error('Invalid raster size or worker count')
with fitz.open(args.pdf) as document:
    count = len(document)
if count < 1:
    raise RuntimeError('Cannot review a PDF without pages')
workers = min(args.workers, count)
chunk = (count + workers - 1) // workers
base = ['pdftoppm', '-png'] + (['-scale-to', str(args.scale)] if args.scale else ['-r', str(args.dpi)])
if args.gray:
    base += ['-gray']

seen = {}
made = set()
lock = threading.Lock()

def emit(event):
    print(json.dumps(event), flush=True)

def page_ready(page, file):
    with lock:
        if not 1 <= page <= count or page in seen:
            raise RuntimeError('Duplicate or invalid raster page')
        seen[page] = file
        group = (page - 1) // 4
        pages = list(range(group * 4 + 1, min(count, group * 4 + 4) + 1))
        if group in made or any(p not in seen for p in pages):
            return
        suffix = 'png' if args.sheet_format == 'png' else 'jpg'
        out = os.path.join(args.sheet_dir, f'sheet-{group + 1:03d}.{suffix}')
        render_sheet({'out': out, 'tiles': [{'file': seen[p], 'page': p} for p in pages]})
        made.add(group)
        emit({'sheet': group + 1, 'file': out, 'pages': pages})

if args.sheet_dir:
    os.makedirs(args.sheet_dir, exist_ok=True)
    emit({'pages': count, 'sheets': (count + 3) // 4})

def render(first):
    command = base + ['-f', str(first), '-l', str(min(count, first + chunk - 1)), args.pdf, args.prefix]
    if not args.sheet_dir:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return
    process = subprocess.Popen(command[:1] + ['-progress'] + command[1:], stdout=subprocess.DEVNULL,
                               stderr=subprocess.PIPE, text=True)
    failure = None
    try:
        for line in process.stderr:
            match = re.fullmatch(r'(\d+) (\d+) (.+)\n', line)
            if match and failure is None:
                try:
                    page_ready(int(match[1]), match[3])
                except Exception as error:
                    failure = error
                    with lock:
                        emit({'error': 'Cannot prepare complete review sheet'})
    finally:
        # Drain and reap every started Poppler process, even after sheet failure.
        code = process.wait()
        process.stderr.close()
    if code:
        with lock:
            emit({'error': f'Raster process failed (exit {code})'})
        raise RuntimeError(f'Raster process failed (exit {code})')
    if failure:
        raise failure

# Exiting the pool waits for every started process, including after a failure.
with ThreadPoolExecutor(max_workers=workers) as pool:
    list(pool.map(render, range(1, count + 1, chunk)))
if args.sheet_dir and (len(seen) != count or len(made) != (count + 3) // 4):
    raise RuntimeError('Incomplete raster page coverage')
