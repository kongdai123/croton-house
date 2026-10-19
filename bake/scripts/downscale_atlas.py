# Covered-area averages in linear light, then fresh padding and the full atlas's tone curve / K.
# usage: CROTON_SITE_PACKAGES=... blender -b --python-exit-code 1 -P scripts/downscale_atlas.py -- bakes/v2/sunrise [--mask coverage.npy] [--units lightmap_uv2.bin.gz]
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
        m = a[..., 3] > 0   # alpha is the surface's opacity (composite_v2.py COVERED)
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

def chart_downscale(rgb, cov, factor, ids, ids_t):
    # Chart-aware tiers: a tier texel that a unit's charts cover (ids_t: atlas_units.rasterize at the tier's size, the texels
    # the site samples for that unit) averages only that unit's texels of the full atlas in its footprint (ids: the same
    # raster at full size, the texels the full tier shows for the unit, chart edges included), or takes the unit's mean
    # when its footprint holds none (a chart thinner than the tier's texel). Plain covered-area averaging mixed in the
    # neighbouring charts of other units, and the dilation filled a thin chart's empty tier texels from them: small dim
    # units read 2-10x brighter at half and quarter (bake QA tiers-consistency; on the final bake's sunrise slot 3 units at
    # half and 7 at quarter, none chart-aware). Texels no unit covers keep downscale().
    out, covered = downscale(rgb, cov, factor)
    h, w = cov.shape; th, tw = ids_t.shape; C = rgb.shape[-1]
    if ids.shape != (h, w): raise ValueError('unit raster and atlas dimensions differ')
    tindex = ((np.arange(h) * th // h)[:, None] * tw + (np.arange(w) * tw // w)[None, :]).ravel()
    f_ids = ids.ravel(); owner = ids_t.ravel()
    sel = np.flatnonzero((f_ids > 0) & (f_ids == owner[tindex])); t = tindex[sel]
    flat = rgb.reshape(-1, C); n = th * tw
    cnt = np.bincount(t, minlength=n)
    sums = np.stack([np.bincount(t, weights=flat[sel, c], minlength=n) for c in range(C)], -1)
    U = int(max(f_ids.max(), owner.max()))
    su = np.flatnonzero(f_ids > 0); uc = np.bincount(f_ids[su], minlength=U + 1)
    um = np.stack([np.bincount(f_ids[su], weights=flat[su, c], minlength=U + 1) for c in range(C)], -1) / np.maximum(uc, 1)[:, None]
    o = out.reshape(-1, C); cv = covered.ravel()
    has = (owner > 0) & (cnt > 0); o[has] = sums[has] / cnt[has][:, None]
    fb = (owner > 0) & (cnt == 0) & (uc[owner] > 0); o[fb] = um[owner[fb]]
    cv |= has | fb
    return o.reshape(th, tw, C).astype(np.float32), cv.reshape(th, tw)

def unit_rasters(units_path, W, H):
    # {(W, H): raster} at full size and both tier sizes (atlas_units.py, as bake QA rasterises them)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # Blender's -P does not put the script's folder on the path
    from atlas_units import read_units, rasterize
    units = read_units(units_path)['units']
    return {s: rasterize(units, *s) for s in ((W, H), (math.ceil(W / 2), math.ceil(H / 2)), (math.ceil(W / 4), math.ceil(H / 4)))}

def tier(rgb, cov, factor, rasters=None):
    # one tier of an atlas: chart-aware when the unit rasters are given (--units), else plain covered-area averaging
    if rasters is None: return downscale(rgb, cov, factor)
    h, w = cov.shape
    return chart_downscale(rgb, cov, factor, rasters[(w, h)], rasters[(math.ceil(w / factor), math.ceil(h / factor))])

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

def encode(rgb, K, charts=None):
    q = np.round(np.sqrt(rgb / (rgb + K)) * 255).astype(np.uint8)
    # every chart texel and its padding stores at least 1/255 (decoded ~K * 1.5e-5): the site's linear mips
    # (lightmap.js MIP_FS) take coverage from the texel values, and a black chart texel (a buried hole) read as empty
    # was filled from the neighbouring charts of the atlas (the walnut shelf glowing with another chart's orange)
    if charts is not None: q[charts] = np.maximum(q[charts], 1)
    return q

def padded_charts(mask, steps):
    m = mask.copy(); h, w = m.shape
    for _ in range(steps):
        src = m.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            m[max(0, dy):h + min(0, dy), max(0, dx):w + min(0, dx)] |= src[max(0, -dy):h + min(0, -dy), max(0, -dx):w + min(0, -dx)]
    return m

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
    np.testing.assert_array_equal(encode(np.zeros((1, 3, 3), np.float32), 0.2, np.array([[True, False, True]]))[0, :, 0], [1, 0, 1])
    assert padded_charts(np.eye(3, dtype=bool)[:1], 1).sum() == 2
    # chart-aware: a dim one-texel-wide chart beside a bright one keeps its own light at half size
    rgb = np.zeros((8, 8, 3), np.float32); cov = np.zeros((8, 8), bool); ids = np.zeros((8, 8), np.int32)
    rgb[:, 0] = 0.01; cov[:, 0] = True; ids[:, 0] = 1; rgb[:, 1:4] = 1.0; cov[:, 1:4] = True; ids[:, 1:4] = 2
    ids_t = np.zeros((4, 4), np.int32); ids_t[:, 0] = 1; ids_t[:, 1] = 2
    plain, _ = downscale(rgb, cov, 2); aware, cv = chart_downscale(rgb, cov, 2, ids, ids_t)
    assert plain[0, 0, 0] > 0.5 and abs(aware[0, 0, 0] - 0.01) < 1e-6 and abs(aware[0, 1, 0] - 1.0) < 1e-6 and cv[:, :2].all()
    ids_t[0, 2] = 1   # a tier texel the dim unit owns but whose footprint holds none of its texels: the unit's mean
    aware, _ = chart_downscale(rgb, cov, 2, ids, ids_t); assert abs(aware[0, 2, 0] - 0.01) < 1e-6
    print('self-test passed: covered area, odd dimensions, black charts, padding, tone curve, chart-aware tiers')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', nargs='?'); parser.add_argument('--mask', help='optional top-first boolean coverage .npy')
    parser.add_argument('--units', help='lightmap_uv2.bin.gz: chart-aware tiers (chart_downscale)')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    if args.self_test: self_test(); return
    if not args.folder: parser.error('folder is required')
    from PIL import Image
    folder = args.folder
    with open(os.path.join(folder, 'encoding.json')) as f: meta = json.load(f)
    meta.pop('rows', None)   # lower tiers are single WebPs, even when the full atlas is split for transport
    if meta.get('curve') != 'sqrt(x/(x+K))': raise ValueError('unsupported tone curve')
    cov = None; sizes = {}; rasters = None
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
        if args.units and rasters is None: rasters = unit_rasters(args.units, rgb.shape[1], rgb.shape[0]); print('chart-aware tiers:', args.units, flush=True)
        for tname, factor in (('half', 2), ('quarter', 4)):
            out, covered = tier(rgb, cov, factor, rasters); out = dilate(out, covered, PAD); q = encode(out, K, padded_charts(covered, PAD))
            dst = os.path.join(folder, tname); os.makedirs(dst, exist_ok=True)
            np.save(os.path.join(dst, f'{name}_tone.npy'), q)
            Image.fromarray(q, 'RGB').save(os.path.join(dst, f'{name}.webp'), format='WEBP', lossless=True, quality=100, method=6)
            np.save(os.path.join(dst, 'coverage.npy'), covered)
            with open(os.path.join(dst, 'encoding.json'), 'w') as f: json.dump(meta, f)
            h, w = q.shape[:2]; sizes[tname] = [w, h]
            print(f'{name} {tname}: {w}x{h}, coverage {covered.mean():.4f}, K {K}, two layers + mips {memory(w, h):.2f} MiB', flush=True)
            del out, covered, q
        del rgb
    report = {'source': sizes['full'], 'rows': 'top-first', 'padding_full': 4,
              'tiers': {k: {'size': v, 'rgba8_mips_MiB': memory(*v)} for k, v in sizes.items()}}
    with open(os.path.join(folder, 'atlas_tiers.json'), 'w') as f: json.dump(report, f, indent=2)

if __name__ == '__main__': main()
