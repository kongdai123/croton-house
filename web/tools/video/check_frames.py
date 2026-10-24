# Pops, flicker and exposure pumps in recorded frames: per-frame mean luma and frame-to-frame change (on 96 x 54
# thumbnails), flagged where the change spikes inside a shot (cuts excepted), plus a strip chart to look at.
# usage: python check_frames.py <framesDir> <out.png> [spikeFactor]
# A pop is a frame-to-frame change several times the shot's median change that does not continue (the next change is
# small again); a pump is a luma swing inside a shot whose sign reverses within a second.
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
frames, out = sys.argv[1], sys.argv[2]
factor = float(sys.argv[3]) if len(sys.argv) > 3 else 4.0
meta = json.load(open(os.path.join(frames, 'meta.json')))
fps, every = meta['fps'], meta.get('every', 1)
starts = [(s['frame'], s.get('shot') or s.get('text') or '') for s in meta.get('steps', [])]
names = sorted(f for f in os.listdir(frames) if f.startswith('f') and f.endswith('.jpg'))
idx = [int(f[1:-4]) for f in names]
thumbs = np.stack([np.asarray(Image.open(os.path.join(frames, f)).convert('L').resize((96, 54), Image.BILINEAR), dtype=np.float32) for f in names])
luma = thumbs.mean(axis=(1, 2))
diff = np.r_[0, np.abs(np.diff(thumbs, axis=0)).mean(axis=(1, 2))]
shot_of = np.zeros(len(idx), dtype=int)
for k, f in enumerate(idx): shot_of[k] = sum(1 for s, _ in starts if s <= f) - 1
report = []
for s in range(len(starts)):
    ks = np.where(shot_of == s)[0]
    if len(ks) < 4: continue
    inner = ks[1:]                                   # the first frame of a shot is a cut
    med = max(np.median(diff[inner]), 0.05)
    for k in inner:
        nxt = diff[k + 1] if k + 1 < len(diff) and shot_of[k + 1] == s else 0
        if diff[k] > factor * med and diff[k] > 0.6 and nxt < 0.5 * diff[k]:
            report.append(f'pop?  {starts[s][1]:10s} frame {idx[k]:5d} ({idx[k] / fps:6.2f} s): change {diff[k]:.2f} vs median {med:.2f}')
    # exposure pumps: luma derivative changing sign with a swing > 3 levels within a second
    L = luma[ks]; w = max(2, int(round(fps / every / 2)))
    for a in range(0, len(L) - 2 * w, w):
        up, down = L[a + w] - L[a], L[a + 2 * w] - L[a + w]
        if up * down < 0 and min(abs(up), abs(down)) > 3:
            report.append(f'pump? {starts[s][1]:10s} frames {idx[ks[a]]}-{idx[ks[a + 2 * w]]} ({idx[ks[a]] / fps:.2f}-{idx[ks[a + 2 * w]] / fps:.2f} s): luma {L[a]:.1f} -> {L[a + w]:.1f} -> {L[a + 2 * w]:.1f}')
print('\n'.join(report) if report else 'no pops or pumps flagged')
# strip chart: luma (white) and change x10 (red), shot boundaries (grey), one pixel per frame
Wd, Hd = len(idx), 300
img = Image.new('RGB', (max(Wd, 200), Hd), (16, 16, 16)); g = ImageDraw.Draw(img)
for f, n in starts:
    x = idx.index(min(idx, key=lambda q: abs(q - f))); g.line([(x, 0), (x, Hd)], fill=(70, 70, 70)); g.text((x + 2, 2), n, fill=(150, 150, 150))
g.line([(k, Hd - 1 - luma[k] / 255 * (Hd - 20)) for k in range(Wd)], fill=(235, 235, 235))
g.line([(k, Hd - 1 - min(Hd - 20, diff[k] * 10)) for k in range(Wd)], fill=(220, 60, 50))
img.save(out)
with open(os.path.splitext(out)[0] + '.txt', 'w') as fh:
    fh.write('\n'.join(report) + '\n')
    for k in range(len(idx)): fh.write(f'{idx[k]} {luma[k]:.2f} {diff[k]:.3f}\n')
