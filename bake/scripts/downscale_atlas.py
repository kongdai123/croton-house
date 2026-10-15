# Covered-area averages in linear light, then fresh padding and the full atlas's tone curve / K.
# usage: CROTON_SITE_PACKAGES=... blender -b --python-exit-code 1 -P scripts/downscale_atlas.py -- bakes/v2/sunrise
# All arrays here are top-first; Blender's bottom-first image buffer is flipped exactly once on load.
import sys, os, glob, json, math, argparse
if os.environ.get('CROTON_SITE_PACKAGES'): sys.path.append(os.environ['CROTON_SITE_PACKAGES'])
import numpy as np

def load(path):
    import bpy
    im = bpy.data.images.load(path, check_existing=False)
    try:
        im.colorspace_settings.name = 'Non-Color'; w, h = im.size
        px = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(px)
        return px.reshape(h, w, 4)[::-1].copy()
    finally: bpy.data.images.remove(im)

def coverage(folder, shape):
    # Every group series covers the same static geometry; prefer sky, which also lights dark lamp-only charts.
    paths = next((p for layer in ('sky', 'sunind', 'lamps') if (p := sorted(glob.glob(os.path.join(folder, f'{layer}_g*.exr'))))), [])
    if not paths: raise RuntimeError('need per-group EXRs for coverage (merged layers already contain padding); or use --mask top-first.npy')
    cov = np.zeros(shape, bool)
    for p in paths:
        a = load(p)
        if a.shape[:2] != shape: raise ValueError(f'{p}: atlas dimensions differ')
        m = a[..., 3] > 0.5
        if not m.any() or m.all():
            m = np.any(a[..., :3] > 0, axis=-1)
            print(f'{p}: no usable alpha mask, rebuilding from positive texels', flush=True)
        cov |= m
        del a, m
    if not cov.any(): raise ValueError('empty coverage')
    return cov

def area_axis(a, n, axis):
    # Exact pixel overlaps, including odd dimensions: each output pixel spans [i * size/n, (i+1) * size/n].
    x = np.moveaxis(a, axis, 1); size = x.shape[1]
    edges = np.arange(n + 1, dtype=np.float64) * (size / n); start = np.floor(edges[:-1]).astype(np.int64)
    out = np.zeros((x.shape[0], n, x.shape[2]), np.float32)
    for j in range(math.ceil(size / n) + 1):
        idx = start + j
        weight = np.maximum(0, np.minimum(edges[1:], idx + 1) - np.maximum(edges[:-1], idx)).astype(np.float32)
        idx = np.minimum(idx, size - 1)
        for row in range(0, x.shape[0], 64):
            out[row:row + 64] += x[row:row + 64, idx] * weight[None, :, None]
    out *= n / size
    return np.moveaxis(out, 1, axis)

def downscale(rgb, cov, factor):
    h, w = cov.shape; size = (math.ceil(w / factor), math.ceil(h / factor))
    a = np.empty((h, w, 4), np.float32); a[..., :3] = rgb; a[..., :3] *= cov[..., None]; a[..., 3] = cov
    a = area_axis(a, size[0], 1); a = area_axis(a, size[1], 0)
    covered = a[..., 3] > 0
    a[..., :3] /= np.maximum(a[..., 3:], np.finfo(np.float32).tiny)
    return a[..., :3].copy(), covered

def dilate(rgb, cov, steps):
    # Copy a neighbour rather than mixing unrelated charts. No wrap at atlas edges; covered (even black) stays fixed.
    out = rgb.copy(); filled = cov.copy(); h, w = cov.shape
    for _ in range(steps):
        before = filled.copy(); src = out.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            ys = slice(max(0, -dy), min(h, h - dy)); xs = slice(max(0, -dx), min(w, w - dx))
            yd = slice(max(0, dy), min(h, h + dy)); xd = slice(max(0, dx), min(w, w + dx))
            grow = ~filled[yd, xd] & before[ys, xs]
            out[yd, xd][grow] = src[ys, xs][grow]; filled[yd, xd] |= grow
    return out

# Grow charts as far as composite_v2.py does at full size (16 texels): mip levels average whole blocks, and an empty
# (black) neighbour pulls chart edges dark from mip 2 at half and mip 1 at quarter if only the 4-texel gutter is filled.
PAD = 16

def encode(rgb, K):
    return np.round(np.sqrt(rgb / (rgb + K)) * 255).astype(np.uint8)

def memory(w, h):
    count = 0
    while True:
        count += w * h
        if w == h == 1: return count * 8 / 2**20   # two RGBA8 layers
        w, h = max(1, w // 2), max(1, h // 2)

def self_test():
    # Odd dimensions, coverage-normalised averages, true black charts, padding and edge isolation.
    rng = np.random.default_rng(4); rgb = rng.random((9, 7, 3), dtype=np.float32); cov = rng.random((9, 7)) > 0.4
    for factor in (2, 4):
        out, covered = downscale(rgb, cov, factor); h, w = out.shape[:2]
        for y in range(h):
            wy = np.maximum(0, np.minimum((y + 1) * 9 / h, np.arange(9) + 1) - np.maximum(y * 9 / h, np.arange(9)))
            for x in range(w):
                wx = np.maximum(0, np.minimum((x + 1) * 7 / w, np.arange(7) + 1) - np.maximum(x * 7 / w, np.arange(7)))
                weights = wy[:, None] * wx[None, :] * cov; total = weights.sum()
                assert covered[y, x] == (total > 0)
                np.testing.assert_allclose(out[y, x], (rgb * weights[..., None]).sum((0, 1)) / total if total else 0, atol=2e-7)
    a = np.zeros((5, 5, 3), np.float32); c = np.zeros((5, 5), bool); a[0, 0] = 8; c[0, 0] = c[0, 3] = True
    grown = dilate(a, c, 1)
    assert np.all(grown[0, 0] == 8) and np.all(grown[1, 1] == 8) and not grown[-1].any() and not grown[:, -1].any()
    assert not grown[0, 3].any() and not grown[1, 3].any()
    out, covered = downscale(a, c, 2); assert covered[0, 1] and not out[0, 1].any()
    np.testing.assert_array_equal(encode(np.array([0, 0.2, 0.6], np.float32), 0.2), [0, 180, 221])
    print('self-test passed: covered area, odd dimensions, black charts, padding, tone curve')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', nargs='?'); parser.add_argument('--mask', help='optional top-first boolean coverage .npy')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    if args.self_test: self_test(); return
    if not args.folder: parser.error('folder is required')
    from PIL import Image
    folder = args.folder
    with open(os.path.join(folder, 'encoding.json')) as f: meta = json.load(f)
    meta.pop('rows', None)   # lower tiers are single WebPs, even when the full atlas is split for transport
    if meta.get('curve') != 'sqrt(x/(x+K))': raise ValueError('unsupported tone curve')
    cov = None; sizes = {}
    for name in ('slot', 'lamps'):
        K = float(meta['K'][name])
        if not math.isfinite(K) or K <= 0: raise ValueError(f'{name}: invalid K')
        a = load(os.path.join(folder, f'{name}.exr')); rgb = a[..., :3].copy(); del a
        if not np.isfinite(rgb).all(): raise ValueError(f'{name}: non-finite texels')
        np.maximum(rgb, 0, out=rgb)
        if cov is None:
            cov = np.load(args.mask).astype(bool) if args.mask else coverage(folder, rgb.shape[:2])
        if cov.shape != rgb.shape[:2]: raise ValueError('coverage dimensions differ')
        if not cov.any(): raise ValueError('empty coverage')
        sizes['full'] = list(rgb.shape[1::-1])
        for tier, factor in (('half', 2), ('quarter', 4)):
            out, covered = downscale(rgb, cov, factor); out = dilate(out, covered, PAD); q = encode(out, K)
            dst = os.path.join(folder, tier); os.makedirs(dst, exist_ok=True)
            np.save(os.path.join(dst, f'{name}_tone.npy'), q)
            Image.fromarray(q, 'RGB').save(os.path.join(dst, f'{name}.webp'), format='WEBP', lossless=True, quality=100, method=6)
            np.save(os.path.join(dst, 'coverage.npy'), covered)
            with open(os.path.join(dst, 'encoding.json'), 'w') as f: json.dump(meta, f)
            h, w = q.shape[:2]; sizes[tier] = [w, h]
            print(f'{name} {tier}: {w}x{h}, coverage {covered.mean():.4f}, K {K}, two layers + mips {memory(w, h):.2f} MiB', flush=True)
            del out, covered, q
        del rgb
    report = {'source': sizes['full'], 'rows': 'top-first', 'padding_full': 4,
              'tiers': {k: {'size': v, 'rgba8_mips_MiB': memory(*v)} for k, v in sizes.items()}}
    with open(os.path.join(folder, 'atlas_tiers.json'), 'w') as f: json.dump(report, f, indent=2)

if __name__ == '__main__': main()
