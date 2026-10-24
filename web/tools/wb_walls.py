"""The light on the white walls of rendered frames, for the white balance's check (test_white_balance_bake.mjs).

Frames: gate (c) visitor frames (bake/validate/RENDER_GATE.md, 960x540) rendered with the white balance off (`&wb=0`), so
the walls show the light as baked. Per camera, the median of hand-picked boxes of white wall (BOXES; away from windows,
sun patches and lamps), through Blender AgX inverted (a numpy port of web/src/agx.js with its LUTs), divided by the wall
paint's albedo (materials.js wallPaint 0xf7f5f1): the light's colour as CCT (K) and Duv. Exposure does not matter.

usage: python3 -I web/tools/wb_walls.py <set dir: .../hq-visitor> <label> [fixture json to update]
       (labels: 'shipped' for the bake as shipped, 'gains/64' with every lamp group's gain / 64 in encoding.json)
"""
import gzip, hashlib, json, os, sys
import numpy as np
from PIL import Image

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BOXES = {   # (x0, y0, x1, y1) in 960x540 frames of bake/validate/cameras.json
    'living_1': [(600, 40, 720, 160)],
    'kitchen_1': [(780, 60, 920, 160)],
    'dining_1': [(60, 40, 200, 140), (760, 80, 920, 160)],
    'office_1': [(200, 60, 420, 160)],
    'primaryBedroom_1': [(540, 110, 640, 220), (760, 130, 860, 200), (280, 120, 360, 260)],
    'primaryBath_1': [(700, 60, 840, 220)],
    'bedroom3_1': [(20, 60, 120, 200), (430, 30, 520, 120), (660, 120, 760, 200)],
    'bathB_1': [(40, 60, 160, 200)],
}
STATES = ['sunrise', 'noon', 'golden', 'dusk']

# ---- Blender AgX (web/src/agx.js), scene-linear Rec.709 -> display sRGB
mat = lambda v: np.array(v).reshape(3, 3).T   # GLSL mat3 literals are column-major
IN = mat([0.559463047, 0.0762332609, 0.0655375095, 0.304775811, 0.787952395, 0.16454273, 0.135812941, 0.135774849, 0.769741528])
LOOK = mat([0.967977806, 0.131809967, 0.0468677678, 0.117887618, 0.916062285, 0.0124191066, -0.0858536371, -0.047868188, 0.940833412])
VIEW = mat([1.04730554, -0.153314683, -0.0501479231, -0.135979098, 1.11078232, -0.00788863052, 0.0886511001, 0.0425245458, 1.05790992])


def luts():
    raw = open(os.path.join(WEB, 'assets/agx/agx_lut.bin.gz'), 'rb').read()
    raw = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
    u, out, o = np.frombuffer(raw, dtype=np.uint16), [], 0
    for n in (37, 57):   # red fastest, 16-bit deltas along red, value * 64000
        a = u[o:o + n ** 3 * 3].reshape(n * n, n, 3).astype(np.uint32)
        out.append(((np.cumsum(a, axis=1) & 0xffff) / 64000).reshape(n, n, n, 3))   # [b][g][r][channel]
        o += n ** 3 * 3
    return out


LUM, AGX = luts()
enc = lambda x: (np.log2(np.maximum(x, 1e-10)) + 12.47393) / 25
dec = lambda y: np.exp2(y * 25 - 12.47393)


def tetra(t, c):   # OCIO's tetrahedral interpolation, as agx.js
    n = t.shape[0] - 1
    c = np.clip(c, 0, 1) * n
    i = np.minimum(np.floor(c), n - 1).astype(int)
    f = c - i
    r, g, b = f
    if r >= g:
        s1, s2, w = ((1, 0, 0), (1, 1, 0), (r, g, b)) if g >= b else ((1, 0, 0), (1, 0, 1), (r, b, g)) if r >= b else ((0, 0, 1), (1, 0, 1), (b, r, g))
    else:
        s1, s2, w = ((0, 0, 1), (0, 1, 1), (b, g, r)) if g <= b else ((0, 1, 0), (1, 1, 0), (g, r, b)) if r >= b else ((0, 1, 0), (0, 1, 1), (g, b, r))
    at = lambda d: t[i[2] + d[2], i[1] + d[1], i[0] + d[0]]
    return (1 - w[0]) * at((0, 0, 0)) + (w[0] - w[1]) * at(s1) + (w[1] - w[2]) * at(s2) + w[2] * at((1, 1, 1))


def agx(x):
    c = dec(tetra(LUM, enc(IN @ x)))
    c = dec((enc(LOOK @ c) - 0.4) * 1.2 + 0.4)
    c = np.maximum(tetra(AGX, enc(VIEW @ c)), 0) ** 2.4
    return np.where(c >= 0.00303993467, 1.055 * c ** (1 / 2.4) - 0.055, c * 12.9232101)


def invert(display):   # Gauss-Newton in log space
    x = np.log(np.full(3, 0.2))
    for _ in range(40):
        f, J = agx(np.exp(x)) - display, np.zeros((3, 3))
        for k in range(3):
            d = np.zeros(3); d[k] = 1e-4
            J[:, k] = (agx(np.exp(x + d)) - agx(np.exp(x))) / 1e-4
        x = x - np.linalg.lstsq(J, f, rcond=None)[0]
    return np.exp(x)


RGB2XYZ = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])


def temperature(rgb):   # nearest point of the Planckian locus (Krystek), CIE 1960 uv: (K, Duv)
    X, Y, Z = RGB2XYZ @ rgb
    u, v = 4 * X / (X + 15 * Y + 3 * Z), 6 * Y / (X + 15 * Y + 3 * Z)
    T = np.arange(1500.0, 20000.0, 5.0)
    uu = (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T)
    vv = (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T)
    k = np.argmin((u - uu) ** 2 + (v - vv) ** 2)
    return float(T[k]), float(np.sign(v - vv[k]) * np.hypot(u - uu[k], v - vv[k]))


s2l = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
PAINT = s2l(np.array([247, 245, 241]) / 255)
sha = lambda p: hashlib.sha256(open(os.path.join(WEB, p), 'rb').read()).hexdigest()[:16]

if __name__ == '__main__':
    frames, label = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else None
    fixture = json.load(open(out)) if out and os.path.exists(out) else {}
    walls = {}
    for st in STATES:
        for cam, boxes in BOXES.items():
            p = os.path.join(frames, st, cam + '.png')
            if not os.path.exists(p):
                continue
            img = np.asarray(Image.open(p).convert('RGB')).astype(np.float64) / 255
            disp = np.median(np.concatenate([img[y0:y1, x0:x1].reshape(-1, 3) for x0, y0, x1, y1 in boxes]), axis=0)
            if disp.max() < 8 / 255:
                continue   # too dark to read a colour
            K, duv = temperature(invert(disp) / PAINT)
            walls.setdefault(st, {})[cam] = round(K)
            print(f'{label} {st} {cam}: display {np.round(disp * 255).astype(int)} -> {K:.0f} K Duv {duv:+.4f}')
    if out:
        fixture.setdefault('walls', {})[label] = walls
        fixture['bake'] = {p: sha(p) for p in [f'assets/lightmaps/{s}/probes.bin' for s in STATES] + ['assets/lightmaps/v2/lampgroups/probes.bin', 'assets/lightmaps/v2/lampgroups/encoding.json']}
        fixture['boxes'] = BOXES
        json.dump(fixture, open(out, 'w'), indent=1)
