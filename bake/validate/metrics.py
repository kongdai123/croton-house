# Compare live renders with the Blender references: linear-luminance percentiles, per-region exposure difference in
# stops, and a side-by-side sheet (reference on top). usage: python3 metrics.py <ref dir> <ours dir> [<other ours dir>...]
import sys, os, numpy as np
from PIL import Image
lin = lambda a: np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
L = lambda p: lin(np.asarray(Image.open(p).convert('RGB'), float) / 255) @ np.array([0.2126, 0.7152, 0.0722])
Q = [1, 5, 25, 50, 75, 95, 99]
REGIONS = {'garden': {'wall': (260, 420, 300, 900), 'fg plants': (520, 720, 0, 640), 'patio': (560, 720, 700, 1280), 'windows': (180, 300, 280, 1000)},
           'living': {'left wall': (100, 400, 0, 300), 'island': (560, 720, 0, 650), 'dining': (250, 600, 700, 1280), 'ceiling': (0, 120, 0, 1280)}}
ref, runs = sys.argv[1], sys.argv[2:]
for v in ('garden', 'living'):
    b = L(os.path.join(ref, v + '.png')); rows = slice(300, None) if v == 'garden' else slice(None)
    print(f'{v}\n  {"blender":24s}', np.percentile(b[rows], Q).round(4))
    sheet = [Image.open(os.path.join(ref, v + '.png')).convert('RGB').resize((640, 360))]
    for r in runs:
        p = os.path.join(r, v + '.png')
        if not os.path.exists(p): print('  missing', p); continue
        o = L(p); d = np.log2((o + 0.002) / (b + 0.002))
        print(f'  {os.path.basename(r.rstrip("/")):24s}', np.percentile(o[rows], Q).round(4), ' |dstops| median', round(float(np.median(np.abs(d[rows]))), 3))
        print('     ' + '  '.join(f'{k} {float(np.median(d[y0:y1, x0:x1])):+.2f}' for k, (y0, y1, x0, x1) in REGIONS[v].items()))
        sheet.append(Image.open(p).convert('RGB').resize((640, 360)))
    w = Image.new('RGB', (640, 360 * len(sheet)))
    for i, s in enumerate(sheet): w.paste(s, (0, 360 * i))
    w.save(os.path.join(runs[-1], f'{v}_sheet.jpg'), quality=88)
