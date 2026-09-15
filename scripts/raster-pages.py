#!/usr/bin/env python3
"""Render disjoint page ranges with the existing Poppler renderer and options."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import os
import subprocess
import fitz

parser = argparse.ArgumentParser()
parser.add_argument('pdf')
parser.add_argument('prefix')
size = parser.add_mutually_exclusive_group(required=True)
size.add_argument('--scale', type=int)
size.add_argument('--dpi', type=int)
parser.add_argument('--gray', action='store_true')
parser.add_argument('--workers', type=int, default=min(4, os.cpu_count() or 1))
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

def render(first):
    subprocess.run(base + ['-f', str(first), '-l', str(min(count, first + chunk - 1)), args.pdf, args.prefix],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

# Exiting the pool waits for every started process, including after a failure.
with ThreadPoolExecutor(max_workers=workers) as pool:
    list(pool.map(render, range(1, count + 1, chunk)))
