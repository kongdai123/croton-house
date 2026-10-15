# Pack the light-probe chunks (probe.py) of a slot into the site's probes.bin, and merge the reflection probes' per-chunk
# meta files (reflprobe.py) into meta.json.
# usage: .venv/bin/python scripts/probe_pack.py bakes/<version>/<slot> [scene/probes.json] [--refl <refl dir>]
# probes.bin, little-endian: u32 header length, JSON header {count, layers, points (three's frame)}, u8 valid[count]
# padded to 4 bytes, then per layer f32[count][27] (L2 SH, 9 coefficients x RGB; lightmap.js loadProbes).
import sys, os, glob, json, struct
import numpy as np
args = sys.argv[1:]
refl = None
lamps_from = None
if '--lamps-from' in args: i = args.index('--lamps-from'); lamps_from = args[i + 1]; del args[i:i + 2]
if '--refl' in args: i = args.index('--refl'); refl = args[i + 1]; del args[i:i + 2]
folder = args[0]; points = args[1] if len(args) > 1 else 'scene/probes.json'
LAYERS = ('sky', 'sunind', 'lamps')
pts = json.load(open(points))['points']; N = len(pts)
valid = np.ones(N, np.uint8); sh = {}
for layer in LAYERS:
    files = sorted(glob.glob(os.path.join(lamps_from if layer == 'lamps' and lamps_from else folder, f'probes_{layer}_c*.json')))
    if not files: raise SystemExit(f'no {layer} probe chunks in {folder}')
    arr = np.zeros((N, 27), np.float32); seen = np.zeros(N, bool)
    for f in files:
        for row in json.load(open(f)):
            arr[row[0]] = row[2:]; valid[row[0]] &= row[1]; seen[row[0]] = True
    if not seen.all(): raise SystemExit(f'{layer}: {int((~seen).sum())} of {N} probes missing ({len(files)} chunks)')
    sh[layer] = arr
header = json.dumps({'count': N, 'layers': list(LAYERS), 'points': [p['t'] for p in pts]}).encode()
out = os.path.join(folder, 'probes.bin')
with open(out, 'wb') as f:
    f.write(struct.pack('<I', len(header))); f.write(header); f.write(valid.tobytes())
    while f.tell() % 4: f.write(b'\0')
    for layer in LAYERS: f.write(sh[layer].tobytes())
print(f'{out}: {N} probes, {int(valid.sum())} valid, mean L0 ' + ', '.join(f'{l} {float(sh[l][valid > 0, 0:3].mean()):.4f}' for l in LAYERS))
if refl:
    meta = sorted((m for f in sorted(glob.glob(os.path.join(refl, 'meta_*.json'))) for m in json.load(open(f))), key=lambda m: m['i'])
    missing = [m['i'] for m in meta if not os.path.exists(os.path.join(refl, f"probe_{m['i']:02d}.hdr"))]
    if missing or len({m['i'] for m in meta}) != len(meta): raise SystemExit(f'reflection probes: missing panoramas {missing} or duplicates')
    json.dump(meta, open(os.path.join(refl, 'meta.json'), 'w'))
    print(f'{refl}/meta.json: {len(meta)} reflection probes')
