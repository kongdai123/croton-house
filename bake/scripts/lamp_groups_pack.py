# Switchable baked lamps, step 3: merge each lamp group's bakes and pack every group's light for the site.
#   merge (Blender's Python, CROTON_SITE_PACKAGES for numpy/torch): one group folder's lamps_gKK.exr -> lum.npy
#     blender -b --python-exit-code 1 -P scripts/lamp_groups_pack.py -- merge <bakes>/gNN [guides.npz]
#     As composite_v2.py's lamps layer: covered texels of every object group, the world fill (CROTON_HOLES: the slot
#     composite's holes.npy), the chart-aware denoiser (lamp pools keep their falloff), charts grown 16 texels into the padding. Lamp light is warm white (3000 K), so a group keeps its
#     luminance (Rec. 709) per texel and one colour (its mean lit chromaticity, luminance 1) in color.json.
#   pack (any Python with numpy + Pillow): every group -> lampgroups/ for web/assets/lightmaps/v2/
#     python scripts/lamp_groups_pack.py pack <groups.json> <bakes> <coverage.npy> <out> [--probes scene/probes.json]
#       [--gains kitchen=2,hall=0.5]   (a group's fixture wattage relative to the bake; the site multiplies its level)
#     Three groups per lossless RGB WebP (one per channel), each through the bake's tone curve y = sqrt(x / (x + K))
#     with its own K; full size split in two row halves (15 MB publishing cap), half and quarter tiers averaged over the
#     covered area in linear light as downscale_atlas.py does (coverage.npy: composite_v2.py's top-first mask).
#     probes.bin: per group, the luminance SH (9 coefficients) of its probe chunks (probe.py).
import sys, os, glob, json, math, time
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
if os.environ.get('CROTON_SITE_PACKAGES'): sys.path.append(os.environ['CROTON_SITE_PACKAGES'])
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)

def merge(folder, guides=None):
    import bpy
    def load(path):
        im = bpy.data.images.load(path); im.colorspace_settings.name = 'Non-Color'; w, h = im.size
        px = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(px); bpy.data.images.remove(im); return px.reshape(h, w, 4)
    t0 = time.time(); acc = cov = None; paths = sorted(glob.glob(os.path.join(folder, 'lamps_g*.exr')))
    if not paths: raise SystemExit(f'no bakes in {folder}')
    for p in paths:
        a = load(p); m = a[..., 3] > 0.5
        if acc is None: acc = np.zeros_like(a[..., :3]); cov = np.zeros(m.shape, bool)
        acc[m] = a[m, :3]; cov |= m; del a
    out, valid = acc, cov
    guides = guides or os.environ.get('CROTON_GUIDES')
    if guides and os.path.exists(guides) and os.environ.get('CROTON_DENOISE') != '0':
        import denoise
        G = denoise.load_guides(guides)
        # as composite_v2.py: the slot bake's holes (holes.npy, top-first; lamp light alone cannot tell a hole from a
        # dark corner) and the texels the rasteriser skipped take the light of the surface around them
        holes = os.environ.get('CROTON_HOLES'); hole = np.zeros(cov.shape, bool)
        if holes: hole = cov & np.load(holes)[::-1]; valid = cov & ~hole
        filled = denoise.world_fill([out], valid, G, log=lambda m: print(m, flush=True))
        dark = hole & ~filled; valid = valid | filled   # buried holes stay black (composite_v2.py)
        out, set_ = denoise.denoise(out, valid, G, log=lambda m: print(m, flush=True), rel=1e-4); filled = valid | set_ | dark
        out[dark] = 0   # buried holes stay black
    else: print('not denoised'); filled = cov.copy()
    for _ in range(16):
        s = np.zeros_like(out); n = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            sh = np.roll(np.roll(filled, dy, 0), dx, 1); s += np.roll(np.roll(out * filled[..., None], dy, 0), dx, 1) * sh[..., None]; n += sh
        grow = (~filled) & (n > 0); out[grow] = s[grow] / n[grow][:, None]; filled |= grow
    out = np.clip(out, 0, None); lum = out @ LUM
    lit = lum > 1e-4; tot = out[lit].sum(0); color = (tot / max(float(tot @ LUM), 1e-9)).tolist() if lit.any() else [1.0, 0.6, 0.35]
    np.save(os.path.join(folder, 'lum.npy'), lum[::-1].astype(np.float32))   # top row first, like an image file
    json.dump({'color': [round(c, 5) for c in color], 'sum': float(lum[cov].sum()), 'max': float(lum.max()), 'coverage': float(cov.mean())}, open(os.path.join(folder, 'color.json'), 'w'))
    print(f'{folder}: lit {lit.mean():.4f}, max {lum.max():.2f}, colour {np.round(color, 3).tolist()}, {time.time() - t0:.0f} s', flush=True)

def grown(mask, steps):
    # the charts plus the padding the merge grew into them (8-neighbour dilation, no wrap)
    m = mask.copy(); h, w = m.shape
    for _ in range(steps):
        src = m.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            m[max(0, dy):h + min(0, dy), max(0, dx):w + min(0, dx)] |= src[max(0, -dy):h + min(0, -dy), max(0, -dx):w + min(0, -dx)]
    return m

def tone_K(lum):
    lit = lum[lum > 1e-4]
    return float(np.clip(max(np.median(lit), np.percentile(lit, 99.9) / 15.5) if lit.size else 0.15, 0.01, 2.0))

def pack(groups_json, bakes, coverage, out, probes='scene/probes.json', gains={}):
    from PIL import Image
    from downscale_atlas import downscale, dilate, PAD
    groups = json.load(open(groups_json))['groups']; G = len(groups); T = math.ceil(G / 3)
    cov = np.load(coverage).astype(bool); H, W = cov.shape
    os.makedirs(out, exist_ok=True)
    meta = {'version': 1, 'curve': 'sqrt(x/(x+K))', 'lampK': 3000, 'textures': T, 'size': [W, H], 'groups': []}
    lums = []
    for g in groups:
        d = os.path.join(bakes, f'g{g["index"]:02d}'); lum = np.load(os.path.join(d, 'lum.npy'), mmap_mode='r')
        if lum.shape != (H, W): raise SystemExit(f'{d}: {lum.shape} != coverage {(H, W)}')
        info = json.load(open(os.path.join(d, 'color.json'))); K = tone_K(np.asarray(lum[::4, ::4]))
        meta['groups'].append({k: g[k] for k in ('name', 'index', 'always', 'exterior', 'members')} | {'tex': g['index'] // 3, 'ch': g['index'] % 3, 'K': round(K, 5), 'color': info['color'], 'gain': float(gains.get(g['name'], 1.0))})
        lums.append(lum); print(f'{g["name"]:15s} K {K:.4f} max {info["max"]:.2f} colour {info["color"]}', flush=True)
    rows = [H // 2, H - H // 2]; meta['rows'] = rows; sizes = {}
    # every texel of a chart or its padding stores at least 1/255 (decoded ~K * 1.5e-5), 0 marks empty atlas: the site's
    # linear mips (lightmap.js linearMips, cov 'self') read coverage from the texture itself
    used = grown(cov, 16)
    for t in range(T):
        idx = [i for i in range(3 * t, 3 * t + 3)]
        K = np.array([meta['groups'][i]['K'] if i < G else 1.0 for i in idx], np.float32)
        stack = np.zeros((H, W, 3), np.float32)
        for c, i in enumerate(idx):
            if i < G: stack[..., c] = lums[i]
        q = np.round(np.sqrt(stack / (stack + K)) * 255).astype(np.uint8); q[used] = np.maximum(q[used], 1)
        for part, (a, b) in enumerate(((0, rows[0]), (rows[0], H))):
            p = os.path.join(out, f'lampgroups_{t}_{part}.webp'); Image.fromarray(q[a:b]).save(p, format='WEBP', lossless=True, quality=100, method=6)
            sizes[os.path.basename(p)] = os.path.getsize(p)
        del q
        for tier, factor in (('half', 2), ('quarter', 4)):
            small, covered = downscale(stack, cov, factor); small = dilate(small, covered, PAD)
            q = np.round(np.sqrt(small / (small + K)) * 255).astype(np.uint8); u = grown(covered, PAD); q[u] = np.maximum(q[u], 1); os.makedirs(os.path.join(out, tier), exist_ok=True)
            p = os.path.join(out, tier, f'lampgroups_{t}.webp'); Image.fromarray(q).save(p, format='WEBP', lossless=True, quality=100, method=6)
            sizes[f'{tier}/{os.path.basename(p)}'] = os.path.getsize(p); meta.setdefault('tiers', {})[tier] = list(q.shape[1::-1])
        print(f'texture {t}: {[meta["groups"][i]["name"] for i in idx if i < G]}', {k: f'{v / 1e6:.2f} MB' for k, v in sizes.items() if f'_{t}' in k}, flush=True)
        del stack
    # probes: luminance SH per group, f32[G][N][9]
    pts = json.load(open(probes))['points']; N = len(pts); sh = np.zeros((G, N, 9), np.float32); missing = []
    for g in groups:
        files = sorted(glob.glob(os.path.join(bakes, f'g{g["index"]:02d}', 'probes_c*.json'))); seen = np.zeros(N, bool)
        for f in files:
            for row in json.load(open(f)):
                sh[g['index'], row[0]] = np.asarray(row[2:], np.float32).reshape(9, 3) @ LUM; seen[row[0]] = True
        if not seen.all(): missing.append(f'{g["name"]} ({int((~seen).sum())} of {N})')
    if missing:   # the atlases alone still work: the site lights probe-lit objects with the shared lamp probes then
        print('WARNING: probes missing, no probes.bin:', ', '.join(missing))
        json.dump(meta, open(os.path.join(out, 'encoding.json'), 'w'), indent=1); return
    header = json.dumps({'count': N, 'groups': G, 'coefs': 9, 'basis': 'luminance, three.js SH order'}).encode()
    with open(os.path.join(out, 'probes.bin'), 'wb') as f:
        f.write(np.uint32(len(header)).tobytes()); f.write(header)
        while f.tell() % 4: f.write(b' ')
        f.write(sh.tobytes())
    sizes['probes.bin'] = os.path.getsize(os.path.join(out, 'probes.bin'))
    meta['probes'] = {'count': N, 'coefs': 9}
    json.dump(meta, open(os.path.join(out, 'encoding.json'), 'w'), indent=1)
    print('total', f'{sum(sizes.values()) / 1e6:.1f} MB', 'full', f'{sum(v for k, v in sizes.items() if "/" not in k and k.endswith(".webp")) / 1e6:.1f} MB',
          'half', f'{sum(v for k, v in sizes.items() if k.startswith("half")) / 1e6:.1f} MB', 'quarter', f'{sum(v for k, v in sizes.items() if k.startswith("quarter")) / 1e6:.1f} MB')

if __name__ == '__main__':
    if args[0] == 'merge': merge(args[1], args[2] if len(args) > 2 else None)
    elif args[0] == 'pack':
        probes = args[args.index('--probes') + 1] if '--probes' in args else 'scene/probes.json'
        gains = dict((k, float(v)) for k, v in (kv.split('=') for kv in args[args.index('--gains') + 1].split(','))) if '--gains' in args else {}
        pack(*args[1:5], probes=probes, gains=gains)
    else: raise SystemExit('usage: merge <group dir> [guides] | pack <groups.json> <bakes> <coverage.npy> <out> [--probes path]')
