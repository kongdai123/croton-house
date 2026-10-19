"""The lightmap unit table (compact_uv.py's lightmap_uv2.bin.gz; unwrap.py's lightmap_uv.bin has the v1 layout) and its charts rasterised into
the atlas: shared by bake QA (bake/validate/qa.py) and the tiers (downscale_atlas.py, lamp_groups_pack.py). numpy + Pillow."""
import gzip, json, struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None


def read_units(path):
    buf = gzip.decompress(Path(path).read_bytes()) if str(path).endswith('.gz') else Path(path).read_bytes()
    n = struct.unpack('<I', buf[:4])[0]; header = json.loads(buf[4:4 + n]); base = 4 + n
    units = header['units']; v2 = header.get('format') == 2
    for u in units:
        o = base + u['off']; x16 = u.get('x16') if v2 else False; i16 = u.get('i16') if v2 else False
        o += u['nv'] * 4 if v2 and not x16 else (u['nv'] * 2 if v2 else u['nv'] * 4)
        idt = np.uint16 if v2 and i16 else np.uint32
        u['idx'] = np.frombuffer(buf, idt, u['ni'], o).reshape(-1, 3).astype(np.int64); o += u['ni'] * np.dtype(idt).itemsize
        u['uv'] = np.frombuffer(buf, np.uint16, u['nv'] * 2, o).reshape(-1, 2).astype(np.float64) / 65535
        u['centre'] = [(a + b) / 2 for a, b in zip(u['min'], u['max'])]   # three's frame (x, up, z)
    return header


def rasterize(units, W, H):
    """Unit index + 1 per texel (0 = no unit): every triangle of every unit drawn into its UV chart. Rows top-first, v is
    the image row fraction (the site flips v once more for the texture)."""
    img = Image.new('I', (W, H), 0); d = ImageDraw.Draw(img)
    for k, u in enumerate(units, 1):
        p = u['uv'] * (W, H) - 0.5
        for t in p[u['idx']].reshape(-1, 6).tolist(): d.polygon(t, fill=k)
    return np.asarray(img)
