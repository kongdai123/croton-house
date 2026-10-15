# Tone-curved 8-bit arrays (composite_v2.py) -> lossless WebP for the site.
import argparse, json, os, numpy as np
from PIL import Image
parser = argparse.ArgumentParser()
parser.add_argument('folder')
parser.add_argument('--split', action='store_true', help='two horizontal halves per layer (15 MB publishing cap)')
args = parser.parse_args(); folder = args.folder
with open(os.path.join(folder, 'encoding.json')) as f: meta = json.load(f)
meta.pop('rows', None)
for name in ('slot', 'lamps'):
    a = np.load(os.path.join(folder, f'{name}_tone.npy'), mmap_mode='r')
    if a.dtype != np.uint8 or a.ndim != 3 or a.shape[2] != 3 or (args.split and a.shape[0] < 2):
        raise ValueError(f'{name}: expected uint8 RGB rows')
    parts = (a[:a.shape[0] // 2], a[a.shape[0] // 2:]) if args.split else (a,)
    if args.split: meta.setdefault('rows', {})[name] = [len(p) for p in parts]   # top half first, odd row in bottom half
    for i, part in enumerate(parts):
        out = os.path.join(folder, f'{name}_{i}.webp' if args.split else f'{name}.webp')
        Image.fromarray(part).save(out, format='WEBP', lossless=True, quality=100, method=6)
        print(os.path.basename(out), part.shape, f'{os.path.getsize(out) / 1e6:.1f} MB')
with open(os.path.join(folder, 'encoding.json'), 'w') as f: json.dump(meta, f)
