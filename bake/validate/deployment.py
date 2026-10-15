"""Cluster check: deployed bakes are byte-identical, split pixels match tone arrays, budgets hold.
usage: python validate/deployment.py site_deploy_src/assets/lightmaps site_deploy_src/build bakes/v2/sunrise
"""
import hashlib, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

src, build, arrays = map(Path, sys.argv[1:])
dst = build / 'assets/lightmaps'
manifest = json.loads((dst / 'manifest.json').read_text())
expected = {'v2/lightmap_uv2.bin.gz', 'v2/sunrise/encoding.json', 'sunrise/probes.bin', 'sunrise/sky_bg.hdr', 'sunrise/refl/meta.json'}
encoding = json.loads((src / 'v2/sunrise/encoding.json').read_text())
for layer in ('slot', 'lamps'):
    rows = encoding.get('rows', {}).get(layer)
    names = [f'v2/sunrise/{layer}_{i}.webp' for i in range(2)] if rows else [f'v2/sunrise/{layer}.webp']
    expected.update(names)
    a = np.load(arrays / f'{layer}_tone.npy', mmap_mode='r'); start = 0
    for i, name in enumerate(names):
        with Image.open(dst / manifest[name]) as im: pixels = np.asarray(im.convert('RGB'))
        n = rows[i] if rows else len(a)
        assert pixels.shape == a[start:start + n].shape and np.array_equal(pixels, a[start:start + n]), name
        start += n
    assert start == len(a), layer
    print(layer, a.shape, 'decoded pixels exact; rows', rows)
probes = json.loads((src / 'sunrise/refl/meta.json').read_text())
expected.update(f"sunrise/refl/probe_{int(p['i']):02d}.hdr" for p in probes)
if (src / 'v2/sunrise/foliage.bin.gz').exists(): expected.add('v2/sunrise/foliage.bin.gz')
for resolution in ('half', 'quarter'):
    names = [f'v2/sunrise/{resolution}/{layer}.webp' for layer in ('slot', 'lamps')]
    if any((src / name).exists() for name in names): expected.update(names)
assert set(manifest) == expected, 'manifest runtime set'
for name, hashed in manifest.items():
    data = (dst / hashed).read_bytes()
    assert data == (src / name).read_bytes(), name
    assert hashlib.sha256(data).hexdigest()[:16] in Path(hashed).name, hashed
    assert len(data) <= 15_000_000, hashed
files = [p for p in build.rglob('*') if p.is_file()]
assert all(p.stat().st_size <= 15_000_000 for p in files), 'per-file cap'
total = sum(p.stat().st_size for p in files)
assert total <= 240_000_000, 'total cap'
assert set(p.relative_to(dst).as_posix() for p in dst.rglob('*') if p.is_file()) == set(manifest.values()) | {'manifest.json'}, 'extra bake files'
print(len(manifest), 'hashed bakes byte-identical;', total, 'total bytes; budgets OK')
