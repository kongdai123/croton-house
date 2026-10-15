# The plant bake (foliage_bake.py) as a small sidecar for the site: per vertex the luminance of the slot (sky + sun
# bounce) and, for plants the lamps reach, of the lamps layer, 8-bit with the lightmaps' tone curve y = sqrt(x / (x + K)),
# and the visible part of the sun (linear). The colour comes from the probe volume at run time (web/src/foliage_bake.js).
# usage: .venv/bin/python scripts/foliage_pack.py bakes/v2/sunrise/foliage/foliage.npz <out dir>/foliage.bin.gz
# Little-endian: u32 header length, JSON header {K, units: [{m, vc, min, max, l}]}, then per unit u8 slot[vc], u8 sun[vc]
# and, where l = 1, u8 lamps[vc]. Units are matched at run time by material, vertex count and world bounds.
import sys, json, struct, gzip
import numpy as np
src, dst = sys.argv[1:3]
d = np.load(src); meta = json.loads(str(d['meta']))
lum = lambda a: np.clip(a @ np.array([0.2126, 0.7152, 0.0722], np.float32), 0, None)
slot, lamps, sun = lum(d['sky']) + lum(d['sunind']), lum(d['lamps']), d['sunvis'][:, 0]
K = {'slot': float(np.median(slot)), 'lamps': float(max(np.percentile(lamps, 99), 1e-4))}
enc = lambda x, k: np.round(np.sqrt(x / (x + k)) * 255).astype(np.uint8)
chunks, o = [], 0
for u in meta:
    sl = slice(o, o + u['vc']); s, la = slot[sl], lamps[sl]; o += u['vc']
    u['l'] = int(0.25 * la.max() > 0.05 * max(s.mean(), 1e-6))   # lamps at their usual level add 5% somewhere
    chunks += [enc(s, K['slot']).tobytes(), np.round(sun[sl] * 255).astype(np.uint8).tobytes()]
    if u['l']: chunks.append(enc(la, K['lamps']).tobytes())
hj = json.dumps({'K': K, 'units': meta}, separators=(',', ':')).encode()
raw = struct.pack('<I', len(hj)) + hj + b''.join(chunks)
with open(dst, 'wb') as f: f.write(gzip.compress(raw, 9))
print(f'{len(meta)} units, {o} vertices, {sum(u["l"] for u in meta)} with lamps, K {K}, {len(raw) / 1e6:.2f} MB raw')
