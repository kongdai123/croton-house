# v2 merge: per layer, take each group's covered texels, denoise chart by chart (denoise.py), grow charts into the
# padding; then the time-slot layer = sky + sun bounce, and the lamps layer. Writes linear EXRs (reference)
# and RGBM arrays for the web (encode_png.py turns them into PNGs).
# RGBM with a square-root curve for precision in the dark: stored = sqrt(rgb / RANGE) / m, m = max channel (alpha).
# usage: blender -b -P scripts/composite_v2.py -- bakes/v2/sunrise [output folder, default the same]
import bpy, sys, os, glob, time
if os.environ.get('CROTON_SITE_PACKAGES'): sys.path.append(os.environ['CROTON_SITE_PACKAGES'])   # numpy for Blender's Python
import numpy as np
args = sys.argv[sys.argv.index('--') + 1:]
lamps_from = None
if '--lamps-from' in args: i = args.index('--lamps-from'); lamps_from = args[i + 1]; del args[i:i + 2]
folder = args[0]; dst = args[1] if len(args) > 1 else folder; RANGE = 8.0
os.makedirs(dst, exist_ok=True); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); G = None
if os.environ.get('CROTON_DENOISE') != '0': import denoise
def load(path):
    im = bpy.data.images.load(path); im.colorspace_settings.name = 'Non-Color'; w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(px); bpy.data.images.remove(im); return px.reshape(h, w, 4)
def save_exr(rgb, path):
    h, w, _ = rgb.shape; im = bpy.data.images.new('out', w, h, alpha=True, float_buffer=True); im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.concatenate([rgb, np.ones((h, w, 1), np.float32)], -1).ravel()); im.filepath_raw = path; im.file_format = 'OPEN_EXR'; im.save(); bpy.data.images.remove(im)
def merged(layer):
    t0 = time.time(); acc = cov = None
    for p in sorted(glob.glob(os.path.join(folder, f'{layer}_g*.exr'))):
        a = load(p); m = a[..., 3] > 0.5
        if acc is None: acc = np.zeros_like(a[..., :3]); cov = np.zeros(m.shape, bool)
        acc[m] = a[m, :3]; cov |= m
    out, filled = acc, cov.copy()
    # chart-aware denoising (denoise.py; CROTON_DENOISE=0 turns it off): needs the guides rasterised from the scene
    guides = os.environ.get('CROTON_GUIDES', os.path.join(os.path.dirname(folder.rstrip('/')), 'guides.npz'))
    if os.environ.get('CROTON_DENOISE') != '0' and os.path.exists(guides):
        global G
        if G is None: G = denoise.load_guides(guides)
        kw = dict(rel=1e-4) if layer == 'lamps' else {}   # lamp pools keep their falloff; soft sky / sun bounce smooth out more
        out, set_ = denoise.denoise(out, cov, G, log=lambda m: print(layer, m, flush=True), **kw); filled |= set_
    else: print(layer, 'not denoised')
    # grow the charts into the padding (bilinear filtering and mipmaps reach into it)
    for _ in range(16):
        s = np.zeros_like(out); n = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            sh = np.roll(np.roll(filled, dy, 0), dx, 1); s += np.roll(np.roll(out * filled[..., None], dy, 0), dx, 1) * sh[..., None]; n += sh
        grow = (~filled) & (n > 0); out[grow] = s[grow] / n[grow][:, None]; filled |= grow
    print(f'{layer}: coverage {cov.mean():.3f}, mean {out[cov].mean(0).round(4).tolist()}, {time.time() - t0:.0f} s', flush=True)
    if layer == 'sky': np.save(os.path.join(dst, 'coverage.npy'), cov[::-1])   # top-first, for downscale_atlas.py --mask
    return np.clip(out, 0, None)
def rgbm(rgb):
    c = np.sqrt(np.clip(rgb / RANGE, 0, 1)); m = np.clip(c.max(-1, keepdims=True), 1 / 255, 1); m = np.ceil(m * 255) / 255
    enc = np.concatenate([np.clip(c / m, 0, 1), m], -1)
    return np.round(enc * 255).astype(np.uint8)[::-1]   # top row first, like an image file
slot = merged('sky') + merged('sunind'); lamps = load(os.path.join(lamps_from, 'lamps.exr'))[..., :3] if lamps_from else merged('lamps')
save_exr(slot, os.path.join(dst, 'slot.exr')); save_exr(lamps, os.path.join(dst, 'lamps.exr'))
np.save(os.path.join(dst, 'slot_rgbm.npy'), rgbm(slot)); np.save(os.path.join(dst, 'lamps_rgbm.npy'), rgbm(lamps))
# the web format: 8-bit RGB through a tone curve, stored = sqrt(x / (x + K)), best relative precision around x = K, so K
# is the layer's median lit texel, raised so the brightest texels (99.9th percentile) stay below y = 0.97, where 8-bit
# steps are still fine (encode_webp.py writes lossless WebP; under 2% error at the 99th percentile)
import json
meta = {'curve': 'sqrt(x/(x+K))', 'K': {}}
for name, rgb in (('slot', slot), ('lamps', lamps)):
    lit = rgb.max(-1); lit = lit[lit > 1e-4]; K = float(np.clip(max(np.median(lit), np.percentile(lit, 99.9) / 15.5) if lit.size else 0.15, 0.01, 2.0)); meta['K'][name] = round(K, 5)
    q = np.round(np.sqrt(rgb / (rgb + K)) * 255).astype(np.uint8); np.save(os.path.join(dst, f'{name}_tone.npy'), q[::-1])
    y = q.astype(np.float32) / 255; back = K * y * y / np.maximum(1 - y * y, 1 / 255); m = rgb.max(-1) > 1e-4
    rel = np.abs(back[m] - rgb[m]) / (rgb[m] + 0.003)
    print(f'{name}: K {K:.4f}, max {lit.max():.2f}, p99.9 {np.percentile(lit, 99.9):.2f}, rel err p50 {np.percentile(rel, 50):.4f} p99 {np.percentile(rel, 99):.4f} max {rel.max():.3f}')
if lamps_from: meta['lampsSlot'] = 'sunrise'
json.dump(meta, open(os.path.join(dst, 'encoding.json'), 'w'))
print('saved slot and lamps', slot.shape, meta)
