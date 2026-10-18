#!/usr/bin/env python3
"""Gate (b) of docs/architecture-lighting.md: bake QA. CPU only (stdlib + numpy + Pillow), no Blender, no GPU.

usage: python3 bake/validate/qa.py [DIR] [--out qa.json] [--report qa.txt (default: next to --out)] [--approve [--allow-new-failures]]
  DIR  a bake output folder (bakes/<V>: <slot>/{encoding.json, slot_*.webp, half/, quarter/, probes.bin, refl/},
       lightmap_uv2.bin.gz, lampgroups/out) or the shipped web/assets/lightmaps (v2/<slot>, <slot>/probes.bin, ...).
       Default: the shipped assets of this repo.
  --thresholds F   bake/validate/qa_thresholds.json (every limit lives there)
  --baseline F     bake/validate/qa_baseline.json: expected failures (shrink-only, like web/tools/golden/known_failures.json)
                   and the approved metrics; a metric that moved beyond its tolerance fails
  --approve        rewrite the baseline from this run. It never adds an expected failure unless --allow-new-failures
  --slots a,b      only these slots;  --no-tiers: skip the half/quarter consistency pass (faster)
  --plan / --objects / --switches   plan.json, web/tools/golden/objects.json (lmId -> mesh, material, placed name) and a
                   switch-records file (a bake's switches.json) for the expected lamp-group list

Checks (ids as in the report): files-*, encoding-valid, units-no-texels, units-coverage, units-black (the vertex-colour
bug), units-outlier, units-holes, tiers-consistency (cross-chart bleed), lamp-groups-order / -energy / -footprint,
probes-walls / -flags / -sh, refl-layout / -placement / -black / -slots. Exit 0: no failure beyond the baseline's
expected ones and no metric outside its tolerance; 1 otherwise; 2: usage error.
"""
import argparse, gzip, json, math, struct, sys, time
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / 'bake/scripts'))
import plan as planlib   # noqa: E402
import reflprobe_layout as layoutlib   # noqa: E402

LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
SEP = ' | '
CIRCUITS = ('main', 'lamps', 'pendant', 'cabinet', 'niche', 'center')   # lighting_roles.js CIRCUITS order
ALWAYS = 'always'


# ---- results ------------------------------------------------------------------------------------------------------------
class Report:
    def __init__(self):
        self.checks = {}; self.metrics = {}; self.details = {}; self.notes = []

    def check(self, id, title, level, offenders=(), **info):
        """offenders: strings 'key | label' (the key is what the baseline compares)."""
        offenders = sorted(set(offenders)); self.checks[id] = dict(title=title, level=level, count=len(offenders), offenders=offenders, **info)

    def metric(self, key, value):
        if value is None: return
        v = float(value)
        if math.isfinite(v): self.metrics[key] = round(v, 6)

    def failures(self):
        return {k: [o.split(SEP)[0] for o in c['offenders']] for k, c in self.checks.items() if c['level'] == 'fail' and c['offenders']}


def fmt(v, n=3): return f'{v:.{n}g}'


# ---- locating the data --------------------------------------------------------------------------------------------------
class Assets:
    """Where a bake output folder or the shipped lightmaps keep their files."""
    def __init__(self, root, uv=None):
        self.root = Path(root)
        v2 = self.root / 'v2'
        self.shipped = v2.is_dir()
        self.base = v2 if self.shipped else self.root
        self.uv = Path(uv) if uv else next((p for p in (self.base / 'lightmap_uv2.bin.gz', self.root / 'lightmap_uv2.bin.gz') if p.exists()), None)
        self.slots = sorted(p.parent.name for p in self.base.glob('*/encoding.json') if p.parent.name not in ('lampgroups', 'out'))
        self.lamp_dir = next((p for p in (self.base / 'lampgroups', self.base / 'lampgroups/out') if (p / 'encoding.json').exists()), None)

    def slot_dir(self, slot): return self.base / slot
    def aux_dir(self, slot): return self.root / slot if self.shipped else self.base / slot


def read_json(p):
    try: return json.loads(Path(p).read_text())
    except (OSError, ValueError): return None


def image_size(p):
    try:
        with Image.open(p) as im: return im.size
    except (OSError, ValueError): return None


def load_rgb(paths):
    """Lossless WebP part(s), top part first, as one uint8 (H, W, 3) array."""
    parts = []
    for p in paths:
        with Image.open(p) as im: parts.append(np.asarray(im.convert('RGB')))
    return parts[0] if len(parts) == 1 else np.concatenate(parts, 0)


def layer_files(folder, name, enc, tier):
    """The file(s) of a layer ('slot', 'lamps') at a tier: full atlases are split in two halves when encoding.json has rows."""
    folder = Path(folder)
    if tier != 'full': return [folder / tier / f'{name}.webp']
    if (enc or {}).get('rows', {}).get(name): return [folder / f'{name}_{i}.webp' for i in range(len(enc['rows'][name]))]
    return [folder / f'{name}.webp']


def decode_lut(K):
    """uint8 -> linear irradiance for y = sqrt(x / (x + K)): x = K y^2 / (1 - y^2), as composite_v2.py checks it."""
    y = np.arange(256, dtype=np.float32) / 255
    return (K * y * y / np.maximum(1 - y * y, 1 / 255)).astype(np.float32)


# ---- the unit table (lightmap_uv2.bin.gz): bake/scripts/atlas_units.py ----------------------------------------------------
from atlas_units import read_units, rasterize   # noqa: E402


class Rasters:
    def __init__(self, units): self.units = units; self.cache = {}

    def get(self, W, H):
        if (W, H) not in self.cache:
            if len(self.cache) >= 3: self.cache.pop(next(iter(self.cache)))   # tiers are done one after another
            self.cache[(W, H)] = rasterize(self.units, W, H)
        return self.cache[(W, H)]


def unit_stats(ids, q, luts, U, floor):
    """Per unit (index 0..U-1): texels, covered texels (any channel > 0), black texels (covered, every channel under
    `floor`), summed linear luminance and RGB over the covered texels. q: uint8 (H, W, 3); luts: three decode tables."""
    flat = ids.ravel(); sel = np.flatnonzero(flat); k = flat[sel].astype(np.int64)
    qs = q.reshape(-1, 3)[sel]
    lin = np.stack([luts[c][qs[:, c]] for c in range(3)], 1)
    cov = qs.max(1) > 0
    black = cov & (lin.max(1) < floor)
    lum = lin @ LUM
    out = dict(n=np.bincount(k, minlength=U + 1)[1:], covered=np.bincount(k, weights=cov, minlength=U + 1)[1:],
               black=np.bincount(k, weights=black, minlength=U + 1)[1:], zero=np.bincount(k, weights=~cov, minlength=U + 1)[1:])
    for c, name in enumerate('rgb'): out[name] = np.bincount(k, weights=lin[:, c] * cov, minlength=U + 1)[1:]
    out['lum'] = np.bincount(k, weights=lum * cov, minlength=U + 1)[1:]
    return out


def mean(sum_, count): return sum_ / np.maximum(count, 1)


# ---- objects.json: lmId -> mesh record, materials, placed item --------------------------------------------------------------
class Objects:
    def __init__(self, path):
        d = read_json(path) if path else None
        self.ok = bool(d)
        d = d or {}
        self.materials = d.get('materials', {}); self.meshes = d.get('meshes', {}); self.placed = d.get('placed', {})
        self.switches = d.get('bakeSwitches', {})
        self.boxes = sorted(((p['bbox'], k, p) for k, p in self.placed.items() if p.get('bbox')), key=lambda t: self._vol(t[0]))

    @staticmethod
    def _vol(b): return max(b[3] - b[0], 1e-3) * max(b[4] - b[1], 1e-3) * max(b[5] - b[2], 1e-3)

    def mesh(self, lm_id): return self.meshes.get('lm:' + lm_id) if lm_id else None

    def material_albedo(self, name):
        """Linear luminance of the material's diffuse albedo, base colour x (1 - metalness): what the lightmap's light is
        multiplied by (a metal has no diffuse lobe, so Cycles' DIFFUSE bake of it is black by design); emissive/transparent -> None."""
        m = self.materials.get(name)
        if not m: return None
        if m.get('transparent') or m.get('transmission', 0) > 0 or m.get('emissive', '000000') != '000000': return None
        c = m.get('color', 'ffffff'); rgb = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        lin = [(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in rgb]
        return (0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]) * (1 - min(max(float(m.get('metalness', 0) or 0), 0.0), 1.0))

    def albedo(self, lm_id):
        """The brightest opaque albedo among the unit's materials (None when unknown or all emissive/transparent)."""
        rec = self.mesh(lm_id)
        if not rec: return None
        vals = [a for a in (self.material_albedo(n) for n in rec.get('materials', [])) if a is not None]
        return max(vals) if vals else None

    def name(self, lm_id, centre):
        """Readable name: the smallest placed item whose box holds the unit's centre, else region + material."""
        rec = self.mesh(lm_id)
        for b, key, p in self.boxes:
            if all(b[i] - 0.02 <= centre[i] <= b[i + 3] + 0.02 for i in range(3)): return f"{p.get('id') or p.get('item') or key} ({p.get('name', '')})".replace('  ', ' ').strip()
        if rec: return f"{rec.get('region', '?')}: {', '.join(n.split('#')[0] for n in rec.get('materials', []))}"
        return ''


# ---- Radiance HDR -----------------------------------------------------------------------------------------------------------
def read_hdr(path):
    data = Path(path).read_bytes(); pos = 0; hdr = []
    while True:
        end = data.index(b'\n', pos); line = data[pos:end]; pos = end + 1
        if line == b'': break
        hdr.append(line)
    end = data.index(b'\n', pos); res = data[pos:end].split(); pos = end + 1
    h, w = int(res[1]), int(res[3]); out = np.zeros((h, w, 4), np.uint8); arr = np.frombuffer(data, np.uint8)
    for y in range(h):
        if w < 8 or w > 32767 or arr[pos] != 2 or arr[pos + 1] != 2 or arr[pos + 2] & 0x80:   # flat scanlines
            out[y] = arr[pos:pos + 4 * w].reshape(w, 4); pos += 4 * w; continue
        pos += 4
        for c in range(4):
            x = 0
            while x < w:
                n = int(arr[pos]); pos += 1
                if n > 128:
                    n -= 128; out[y, x:x + n, c] = arr[pos]; pos += 1
                else: out[y, x:x + n, c] = arr[pos:pos + n]; pos += n
                x += n
    e = out[..., 3].astype(np.int32)
    scale = np.where(e == 0, 0.0, np.ldexp(1.0, e - 136)).astype(np.float32)
    return out[..., :3].astype(np.float32) * scale[..., None]


# ---- plan helpers -----------------------------------------------------------------------------------------------------------
def plan_xy(p): return p[0], -p[2]   # three's frame (x, up, z) -> plan (x, y)


def group_spaces(plan, group, records):
    """The plan spaces a lamp group lights: the spaces of its switches' records, else the spaces named after the group."""
    out = {r['space'] for r in records if r.get('group') == group and r.get('space')}
    if not out:
        for s in plan.spaces:
            base = s.get('lampGroup', s['id'])
            if group == base or (group.startswith(base) and group[len(base):] in ('Lamps', 'Pendant', 'Cabinet', 'Niche', 'Center')): out.add(s['id'])
    if group == 'porch' or not out: out |= {s['id'] for s in plan.spaces if s['zone'] == 'exterior'} if group == 'porch' else set()
    return out


def lamp_group_order(plan, records):
    """lighting_roles.js lampGroupOrder: rooms in the plan's order, each room's circuits in CIRCUITS order, then porch (exterior), then always."""
    rank = {s['id']: i for i, s in enumerate(plan.spaces)}; order = {}
    for r in records:
        g = r.get('group')
        if g and g not in order: order[g] = (1 if r.get('exterior') else 0, rank.get(r.get('space'), 1000), CIRCUITS.index(r['circuit']) if r.get('circuit') in CIRCUITS else -1, g)
    return [g for g, _ in sorted(order.items(), key=lambda e: e[1])] + [ALWAYS]


# ---- the checks -------------------------------------------------------------------------------------------------------------
def check_files(rep, A, T):
    big = []; n = 0
    for p in sorted(A.root.rglob('*')):
        if p.is_file() and '.git' not in p.parts:
            n += 1
            if p.stat().st_size >= T['files']['maxBytes']: big.append(f'{p.relative_to(A.root)}{SEP}{p.stat().st_size / 1e6:.2f} MB')
    rep.check('files-size', f'every file under {T["files"]["maxBytes"] / 1e6:.0f} MB ({n} files)', 'fail', big)
    rep.metric('files.count', n)


def check_encodings(rep, A, T, slots):
    bad, missing, size_off = [], [], []
    W = H = None
    header = rep.details.get('atlas')
    if header: W, H = header
    for s in slots:
        d = A.slot_dir(s); enc = read_json(d / 'encoding.json')
        if enc is None: bad.append(f'{s}{SEP}encoding.json unreadable'); continue
        if enc.get('curve') != 'sqrt(x/(x+K))': bad.append(f'{s}{SEP}curve {enc.get("curve")}')
        for k in ('slot', 'lamps'):
            v = (enc.get('K') or {}).get(k)
            if not (isinstance(v, (int, float)) and math.isfinite(v) and v > 0): bad.append(f'{s}.K.{k}{SEP}{v!r}')
        # layers and tiers present, sizes match the unit table's atlas
        own_lamps = enc.get('lampsSlot') in (None, s)
        for name in ('slot',) + (('lamps',) if own_lamps else ()):
            parts = layer_files(d, name, enc, 'full'); total = 0
            for p in parts:
                sz = image_size(p)
                if sz is None: missing.append(f'{s}/{p.name}{SEP}missing or unreadable'); continue
                if W and sz[0] != W: size_off.append(f'{s}/{p.name}{SEP}width {sz[0]} != atlas {W}')
                total += sz[1]
            if parts and W and total and total != H: size_off.append(f'{s}/{name}{SEP}{total} rows != atlas {H}')
            for tier, div in (('half', 2), ('quarter', 4)):
                p = layer_files(d, name, enc, tier)[0]; sz = image_size(p)
                if sz is None: missing.append(f'{s}/{tier}/{name}.webp{SEP}tier missing'); continue
                if W and sz != (math.ceil(W / div), math.ceil(H / div)): size_off.append(f'{s}/{tier}/{name}.webp{SEP}{sz[0]}x{sz[1]} != ceil({W}x{H}/{div})')
            if (d / 'half').is_dir() and read_json(d / 'half' / 'encoding.json') is None: missing.append(f'{s}/half/encoding.json{SEP}missing')
            if (d / 'quarter').is_dir() and read_json(d / 'quarter' / 'encoding.json') is None: missing.append(f'{s}/quarter/encoding.json{SEP}missing')
        if not own_lamps and not (A.slot_dir(enc['lampsSlot']) / 'encoding.json').exists(): missing.append(f'{s}{SEP}lampsSlot {enc["lampsSlot"]} not shipped')
    if A.lamp_dir:
        g = read_json(A.lamp_dir / 'encoding.json') or {}
        if g.get('curve') != 'sqrt(x/(x+K))' or g.get('version') != 1: bad.append(f'lampgroups{SEP}curve/version')
        for i, grp in enumerate(g.get('groups', [])):
            if not (isinstance(grp.get('K'), (int, float)) and math.isfinite(grp['K']) and grp['K'] > 0): bad.append(f'lampgroups.{grp.get("name", i)}.K{SEP}{grp.get("K")!r}')
            if grp.get('index') != i or grp.get('tex') != i // 3 or grp.get('ch') != i % 3: bad.append(f'lampgroups.{grp.get("name", i)}{SEP}index/tex/ch not {i}/{i // 3}/{i % 3}')
        if g.get('textures') != math.ceil(len(g.get('groups', [])) / 3): bad.append(f'lampgroups{SEP}textures {g.get("textures")} for {len(g.get("groups", []))} groups')
        if W and g.get('size') and list(g['size']) != [W, H]: size_off.append(f'lampgroups{SEP}size {g["size"]} != atlas {[W, H]}')
        for t in range(g.get('textures', 0)):
            have = [tier for tier in ('half', 'quarter') if (A.lamp_dir / tier / f'lampgroups_{t}.webp').exists()] + (['full'] if (A.lamp_dir / f'lampgroups_{t}_0.webp').exists() or (A.lamp_dir / f'lampgroups_{t}.webp').exists() else [])
            if not have: missing.append(f'lampgroups_{t}{SEP}no tier present')
            for tier in ('half', 'quarter'):
                sz = image_size(A.lamp_dir / tier / f'lampgroups_{t}.webp')
                if sz is None: missing.append(f'lampgroups/{tier}/lampgroups_{t}.webp{SEP}tier missing')
                elif W and sz != (math.ceil(W / (2 if tier == 'half' else 4)), math.ceil(H / (2 if tier == 'half' else 4))): size_off.append(f'lampgroups/{tier}/lampgroups_{t}.webp{SEP}{sz[0]}x{sz[1]}')
    rep.check('encoding-valid', 'encoding.json K finite and positive, curve, group channel layout', 'fail', bad)
    rep.check('files-present', 'every layer and tier file present', 'fail', missing)
    rep.check('files-sizes-match', 'image sizes match the unit table\'s atlas (full rows, half/quarter = ceil)', 'fail', size_off)


def slot_layers(A, slot, enc):
    """(name, folder, enc) of the layers to decode for a slot: its slot layer, and its own lamps layer if it has one."""
    d = A.slot_dir(slot); out = [('slot', d, enc)]
    if enc.get('lampsSlot') in (None, slot): out.append(('lamps', d, enc))
    return out


def check_units(rep, A, T, units, objs, plan, slots, tiers):
    U = len(units); uT = T['units']; floor = uT['blackFloor']
    names = [f'{u.get("id") or "unit#" + str(i)}' for i, u in enumerate(units)]
    centres = [plan_xy(u['centre']) for u in units]
    label = lambda i: f'{names[i]}{SEP}{objs.name(units[i].get("id"), units[i]["centre"])}'
    W, H = rep.details['atlas']; ras = Rasters(units)
    stats, tier_stats, texels = {}, {}, None
    t0 = time.time()
    for s in slots:
        enc = read_json(A.slot_dir(s) / 'encoding.json')
        if not enc: continue
        for name, folder, e in slot_layers(A, s, enc):
            for tier in (['full', 'half', 'quarter'] if tiers and name == 'slot' else ['full']):
                files = layer_files(folder, name, e, tier)
                if not all(p.exists() for p in files): continue
                q = load_rgb(files)
                K = e['K'][name] if tier == 'full' else (read_json(Path(folder) / tier / 'encoding.json') or e)['K'][name]
                ids = ras.get(q.shape[1], q.shape[0])
                stats[(s, name, tier)] = unit_stats(ids, q, [decode_lut(K)] * 3, U, floor)
                if name == 'slot' and tier == 'full': texels = stats[(s, name, tier)]['n']
                del q
        print(f'  slot {s} decoded ({time.time() - t0:.0f} s)', file=sys.stderr, flush=True)
    rep.details['unitTexels'] = [int(x) for x in texels] if texels is not None else []
    # lamp groups: per channel luminance, at the best tier present
    group_stats = decode_groups(rep, A, ras, units, floor)
    slotkeys = [s for s in slots if (s, 'slot', 'full') in stats]

    # -- 1. no texels / coverage
    n = np.maximum(texels, 0) if texels is not None else np.zeros(U)
    none = [label(i) for i in range(U) if n[i] < uT['minTexels']]
    rep.check('units-no-texels', f'units whose chart holds no texel (under {uT["minTexels"]}) of {U}', 'fail', none)
    low = []
    cov_by_slot = {s: mean(stats[(s, 'slot', 'full')]['covered'], stats[(s, 'slot', 'full')]['n']) for s in slotkeys}
    for i in range(U):
        if n[i] < uT['minTexels']: continue
        worst = min(cov_by_slot[s][i] for s in slotkeys)
        if worst < uT['minCoverage']: low.append(f'{names[i]}{SEP}{objs.name(units[i].get("id"), units[i]["centre"])}: coverage {worst:.2f}')
    rep.check('units-coverage', f'units whose covered texel fraction (any channel > 0, in the worst slot) is under {uT["minCoverage"]}', uT['coverageLevel'], low)
    # -- hole fill, only if the bake kept it
    holes = None
    for p in (A.slot_dir('sunrise') / 'holes.npy', A.base / 'holes.npy'):
        if p.exists(): holes = np.load(p, mmap_mode='r'); break
    if holes is not None and holes.shape == (H, W):
        hs = unit_stats(ras.get(W, H), np.repeat(np.asarray(holes, np.uint8)[..., None] * 255, 3, 2), [np.arange(256, dtype=np.float32)] * 3, U, 0.5)
        frac = mean(hs['covered'], hs['n'])
        rep.check('units-holes', f'units with more than {uT["holeFraction"]:.0%} hole-filled texels', 'warn', [label(i) for i in range(U) if frac[i] > uT['holeFraction']])
        rep.metric('holes.fraction', float(hs['covered'].sum() / max(hs['n'].sum(), 1)))
    else: rep.notes.append('units-holes: holes.npy is not in this folder (a bake keeps it; the shipped assets do not): skipped')

    # -- 2. mostly black on a non-black material (every full-size layer: the slots and the shared lamps; the groups' tiers are padded, so they cannot show it)
    dark = {}
    for s in slotkeys:
        st = stats[(s, 'slot', 'full')]; dark[s] = mean(st['black'] + st['zero'], st['n'])
    lamp_dark = None
    lamp_keys = [k for k in stats if k[1] == 'lamps' and k[2] == 'full']
    if lamp_keys:
        st = stats[lamp_keys[0]]; lamp_dark = mean(st['black'] + st['zero'], st['n'])
    black, unknown_mat, dim_ok = [], [], 0
    for i in range(U):
        if n[i] < uT['minTexels']: continue
        if min(dark[s][i] for s in slotkeys) < uT['blackFraction']: continue                    # lit in at least one slot
        if lamp_dark is not None and lamp_dark[i] < uT['blackFraction']: continue              # or by the shared lamps layer
        if group_stats is not None and group_stats['dark'][:, i].min() < uT['blackFraction']: continue   # or by its lamp group (a shut closet's plate)
        alb = objs.albedo(units[i].get('id'))
        row = f'{names[i]}{SEP}{objs.name(units[i].get("id"), units[i]["centre"])}'
        if alb is None and objs.ok and not objs.mesh(units[i].get('id')): unknown_mat.append(row)
        elif alb is None: dim_ok += 1   # emissive / transparent: black light is plausible
        elif alb >= uT['minAlbedo']: black.append(row + f' (albedo {alb:.2f})')
        else: dim_ok += 1
    rep.check('units-black', f'units black in every slot and layer, lamp groups included (>= {uT["blackFraction"]:.0%} of texels under {floor}) on a material with diffuse albedo >= {uT["minAlbedo"]} (the vertex-colour bug)', 'fail', black)
    rep.check('units-black-unknown-material', 'units black in every slot and layer that objects.json has no material for', 'warn', unknown_mat)
    rep.metric('units.blackNonBlackMaterial', len(black)); rep.metric('units.blackAll', len(black) + len(unknown_mat) + dim_ok)

    # -- 3. mean irradiance per slot, per plan space, robust outliers
    big = [max(u['max'][0] - u['min'][0], u['max'][2] - u['min'][2]) > T['groups']['bigUnit'] for u in units]
    space_of = [None if big[i] else (plan.space_at(*centres[i], 0.3) or {}).get('id') for i in range(U)]
    outliers = []; unit_means = {}
    for s in slotkeys:
        st = stats[(s, 'slot', 'full')]; m = mean(st['lum'], st['covered']); unit_means[s] = m
        rep.metric(f'slot.{s}.meanIrradiance', st['lum'].sum() / max(st['covered'].sum(), 1))
        rep.metric(f'slot.{s}.coverage', st['covered'].sum() / max(st['n'].sum(), 1))
        by = {}
        for i in range(U):
            if space_of[i] and st['covered'][i] >= uT['minTexels'] and n[i] >= uT['outlierMinTexels']: by.setdefault(space_of[i], []).append(i)
        for sp, idx in by.items():
            tot = sum(st['lum'][i] for i in idx); cnt = sum(st['covered'][i] for i in idx)
            rep.metric(f'slot.{s}.space.{sp}', tot / max(cnt, 1))
            if len(idx) < uT['outlierMinUnits']: continue
            lg = np.log(np.maximum(m[idx], uT['outlierFloor'])); med = np.median(lg); mad = max(np.median(np.abs(lg - med)) * 1.4826, uT['outlierMinSigma'])
            for j, i in enumerate(idx):
                z = (lg[j] - med) / mad
                if abs(z) > uT['outlierZ'] and abs(lg[j] - med) > math.log(uT['outlierRatio']):
                    outliers.append(f'{names[i]}@{s}{SEP}{objs.name(units[i].get("id"), units[i]["centre"])}: {sp} z {z:+.1f}, {math.exp(lg[j] - med):.2g}x the median')
    rep.check('units-outlier', f'units whose mean irradiance is a robust log outlier (|z| > {uT["outlierZ"]}, > {uT["outlierRatio"]}x) among the units of their plan space', 'warn', outliers)

    # -- 4. tier consistency
    if tiers:
        tT = T['tiers']; bleed = []; compared = 0; worst = {}
        for s in slotkeys:
            for name in ('slot',):
                full = stats[(s, name, 'full')]
                for tier in ('half', 'quarter'):
                    ts = stats.get((s, name, tier))
                    if ts is None: continue
                    for i in range(U):
                        if full['covered'][i] < tT['minFullTexels'] or ts['covered'][i] < tT['minTierTexels'][tier]: continue
                        compared += 1
                        mf = np.array([full[c][i] for c in 'rgb']) / full['covered'][i]; mt = np.array([ts[c][i] for c in 'rgb']) / ts['covered'][i]
                        # a zero texel of the shipped full atlas may be an uncovered texel or a covered black one, so the full mean is a
                        # range: over the non-zero texels, or over all the unit's texels
                        lf_nz, lt = mf @ LUM, mt @ LUM; lf_all = float(full['lum'][i] / max(full['n'][i], 1))
                        lo, hi = min(lf_nz, lf_all), max(lf_nz, lf_all); lf = lf_nz
                        rel = (lo - lt) / max(lo, tT['lumFloor']) if lt < lo else (lt - hi) / max(hi, tT['lumFloor']) if lt > hi else 0.0
                        absd = max(lo - lt, lt - hi, 0.0)
                        if full['zero'][i] / max(full['n'][i], 1) > tT['maxZeroForLuminance']: rel = absd = 0.0   # holes are filled in the tiers: luminance is not comparable, chroma is
                        chroma = float(np.abs(mf / max(mf.sum(), 1e-9) - mt / max(mt.sum(), 1e-9)).max()) if mf.sum() > tT['chromaMinSum'] else 0.0
                        worst.setdefault(tier, []).append(rel)
                        if (rel > tT['relTol'][tier] and absd > tT['absTol']) or chroma > tT['chromaTol']:
                            bleed.append(f'{names[i]}@{s}/{tier}{SEP}{objs.name(units[i].get("id"), units[i]["centre"])}: mean {lf_nz:.3g} (all texels {lf_all:.3g}) -> {lt:.3g} ({rel:+.0%} outside), chroma {chroma:.2f}')
        rep.check('tiers-consistency', f'half/quarter unit means vs the full atlas (relative {tT["relTol"]} and over {tT["absTol"]} absolute, or chroma {tT["chromaTol"]}); {compared} comparisons', 'fail', bleed)
        for tier, v in worst.items(): rep.metric(f'tiers.{tier}.p99RelDiff', np.percentile(v, 99)); rep.metric(f'tiers.{tier}.badFraction', float(np.mean(np.array(v) > T['tiers']['relTol'][tier])))

    # -- 5. lamp groups
    check_groups(rep, A, T, plan, units, objs, group_stats, space_of, big)
    rep.details['units'] = [dict(id=names[i], name=objs.name(units[i].get('id'), units[i]['centre']), space=space_of[i], texels=int(n[i]),
                                 **{f'cov.{s}': round(float(cov_by_slot[s][i]), 4) for s in slotkeys},
                                 **{f'mean.{s}': round(float(unit_means[s][i]), 6) for s in slotkeys}) for i in range(U)]


def decode_groups(rep, A, ras, units, floor):
    if not A.lamp_dir: return None
    g = read_json(A.lamp_dir / 'encoding.json')
    if not g or not isinstance(g.get('groups'), list): return None
    U = len(units); G = len(g['groups']); energy = np.zeros((G, U)); mean_ = np.zeros((G, U)); dark = np.ones((G, U)); tier_used = None
    for t in range(g.get('textures', 0)):
        tier = None
        files = None
        for cand, paths in (('full', [A.lamp_dir / f'lampgroups_{t}_{i}.webp' for i in range(len(g.get('rows') or []))] if g.get('rows') else [A.lamp_dir / f'lampgroups_{t}.webp']),
                            ('half', [A.lamp_dir / 'half' / f'lampgroups_{t}.webp']), ('quarter', [A.lamp_dir / 'quarter' / f'lampgroups_{t}.webp'])):
            if paths and all(p.exists() for p in paths): files, tier = paths, cand; break
        if not files: continue
        tier_used = tier; q = load_rgb(files); ids = ras.get(q.shape[1], q.shape[0])
        Ks = [g['groups'][3 * t + c]['K'] if 3 * t + c < G else 1.0 for c in range(3)]
        luts = [decode_lut(K) for K in Ks]
        flat = ids.ravel(); sel = np.flatnonzero(flat); k = flat[sel].astype(np.int64); qs = q.reshape(-1, 3)[sel]
        cnt = np.bincount(k, minlength=U + 1)[1:]
        for c in range(3):
            gi = 3 * t + c
            if gi >= G: continue
            lin = luts[c][qs[:, c]]
            en = np.bincount(k, weights=lin, minlength=U + 1)[1:]
            energy[gi] = en; mean_[gi] = en / np.maximum(cnt, 1)
            dark[gi] = 1 - np.bincount(k, weights=lin >= floor, minlength=U + 1)[1:] / np.maximum(cnt, 1)
        del q
    return dict(energy=energy, mean=mean_, dark=dark, groups=g['groups'], tier=tier_used, meta=g)


def check_groups(rep, A, T, plan, units, objs, gs, space_of, big):
    gT = T['groups']
    if gs is None: rep.notes.append('lamp groups: no lampgroups/encoding.json: group checks skipped'); return
    enc_names = [x['name'] for x in gs['groups']]
    records = list(objs.switches.values()) if isinstance(objs.switches, dict) else list(objs.switches)
    listed = None
    if A.switches_file:   # a bake's switches.json (switch_groups.mjs: {switches, groups}), or a plain list of records
        d = read_json(A.switches_file)
        if isinstance(d, dict) and 'switches' in d: records, listed = d['switches'], d.get('groups')
        elif isinstance(d, dict): records = list(d.values())
        elif d: records = d
    off = []
    if records:
        order = lamp_group_order(plan, records)
        if listed and list(listed) != order: off.append(f'switches.json{SEP}its group list differs from the order lighting_roles.js gives: {listed} vs {order}')
        order = list(listed) if listed else order
        for n in order:
            if n not in enc_names: off.append(f'{n}{SEP}missing from encoding.json')
        for n in enc_names:
            if n not in order: off.append(f'{n}{SEP}not a lamp group of the manifest')
        if not off and order != enc_names: off.append(f'order{SEP}same groups, different order: {order} vs {enc_names}')
        title = f'lamp groups of encoding.json ({len(enc_names)}) equal the manifest\'s ({len(order)}, in the order the code expects)'
    else: title = 'lamp group list (no switch records to compare against: objects.json missing)'; order = enc_names
    rep.check('lamp-groups-order', title, 'fail', off)
    # energy and footprint
    energy = gs['energy']; zero, leaks = [], []
    allowed_cache = {}
    for gi, g in enumerate(gs['groups']):
        total = float(energy[gi].sum()); rep.metric(f'group.{g["name"]}.energy', total)
        if total <= gT['minEnergy']: zero.append(f'{g["name"]}{SEP}energy {total:.3g}')
        if g['name'] == ALWAYS or total <= gT['minEnergy']: continue
        S = group_spaces(plan, g['name'], records)
        if not S: continue
        allowed = set(S)
        for sid in S: allowed |= {n['space'] for n in plan.neighbors(sid)}
        e_all = sum(energy[gi][i] for i in range(len(units)) if not big[i]); e_out = 0.0; worst = {}
        for i in range(len(units)):
            if big[i]: continue
            sp = space_of[i]
            if sp not in allowed:
                e_out += energy[gi][i]; worst[sp] = worst.get(sp, 0) + energy[gi][i]
        frac = e_out / max(e_all, 1e-12)
        rep.metric(f'group.{g["name"]}.outsideFraction', frac)
        rep.metric(f'group.{g["name"]}.bigUnitShare', 1 - e_all / max(total, 1e-12))
        if frac > gT['leakFraction']:
            top = sorted(worst.items(), key=lambda kv: -kv[1])[:3]
            leaks.append(f'{g["name"]}{SEP}{frac:.0%} of its energy outside {sorted(S)} and their neighbours; most in ' + ', '.join(f'{k} {v / max(e_all, 1e-12):.0%}' for k, v in top))
    rep.check('lamp-groups-energy', 'every lamp group has non-zero energy', 'fail', zero)
    rep.check('lamp-groups-footprint', f'a group puts at most {gT["leakFraction"]:.0%} of its energy (units under {gT["bigUnit"]} m, at their centres) outside its plan spaces and their door/opening neighbours', 'fail', leaks)


def check_probes(rep, A, T, plan, slots):
    pT = T['probes']; walls_bad, flag_bad, sh_bad, info = [], [], [], {}
    pieces_cache = {}
    lot = plan.data['lot']
    first = None
    for s in slots:
        p = A.aux_dir(s) / 'probes.bin'
        if not p.exists(): flag_bad.append(f'{s}{SEP}probes.bin missing'); continue
        buf = p.read_bytes(); hl = struct.unpack('<I', buf[:4])[0]; h = json.loads(buf[4:4 + hl]); N = h['count']; o = 4 + hl
        valid = np.frombuffer(buf, np.uint8, N, o); o = (o + N + 3) & ~3
        layers = {}
        for l in h['layers']: layers[l] = np.frombuffer(buf, np.float32, N * 27, o).reshape(N, 27); o += N * 27 * 4
        if o != len(buf): sh_bad.append(f'{s}{SEP}file size {len(buf)} != header layout {o}')
        pts = np.array(h['points'], float)
        if first is None: first = pts
        elif pts.shape != first.shape or np.abs(pts - first).max() > 1e-4: flag_bad.append(f'{s}{SEP}probe positions differ from {slots[0]}')
        # positions: in a wall piece at the probe's height, or outside the lot
        inwall = np.zeros(N, bool)
        for k, (x, y, z) in enumerate(pts):
            px, py = x, -z
            if px < lot['x0'] or px > lot['x1'] or py < lot['y0'] or py > lot['y1']: inwall[k] = True; continue
            key = round(float(y), 3)
            if key not in pieces_cache: pieces_cache[key] = [(w['x0'], w['x1'], w['y0'], w['y1']) for w in plan.walls_at(key)]
            for x0, x1, y0, y1 in pieces_cache[key]:
                if x0 < px < x1 and y0 < py < y1: inwall[k] = True; break
        bad_valid = np.flatnonzero(inwall & (valid > 0))
        for k in bad_valid[:200]: walls_bad.append(f'{s} probe {k}{SEP}valid, at ({pts[k][0]:.2f}, {-pts[k][2]:.2f}, h {pts[k][1]:.2f}) in a wall or outside the lot')
        rep.metric(f'probes.{s}.inWallInvalid', int((inwall & (valid == 0)).sum())); rep.metric(f'probes.{s}.inWallValid', len(bad_valid))
        inv = float((valid == 0).mean()); rep.metric(f'probes.{s}.invalidFraction', inv)
        if inv > pT['maxInvalidFraction']: flag_bad.append(f'{s}{SEP}{inv:.0%} of probes flagged invalid')
        if int(valid.sum()) < 4: flag_bad.append(f'{s}{SEP}fewer than 4 valid probes')
        # SH
        for l, arr in layers.items():
            nonfin = int((~np.isfinite(arr)).sum())
            if nonfin: sh_bad.append(f'{s}/{l}{SEP}{nonfin} non-finite coefficients')
            a = np.nan_to_num(arr[valid > 0]).reshape(-1, 9, 3)
            c0 = a[:, 0, :]; c1 = np.linalg.norm(a[:, 1:4, :], axis=1)   # per channel
            neg0 = int((c0 < -pT['c0Epsilon']).any(1).sum())
            if neg0: sh_bad.append(f'{s}/{l}{SEP}{neg0} valid probes with a negative L0')
            ratio = (c1 / np.maximum(c0, 1e-6))[c0 > pT['ratioMinL0']]
            neg = int(((0.282095 * c0 - 0.488603 * c1) < -1e-6).any(1).sum())   # linear L0+L1 reconstruction below 0 somewhere
            mx = float(ratio.max()) if ratio.size else 0.0
            rep.metric(f'probes.{s}.{l}.meanL0', float(c0.mean())); rep.metric(f'probes.{s}.{l}.negL1Probes', neg)
            rep.metric(f'probes.{s}.{l}.l1ratioP99', float(np.percentile(ratio, 99)) if ratio.size else 0)
            info[f'{s}/{l}'] = dict(l1ratio_p50=float(np.median(ratio)) if ratio.size else 0, l1ratio_p99=float(np.percentile(ratio, 99)) if ratio.size else 0, l1ratio_max=mx, negL1=neg, valid=int(valid.sum()))
            if mx > pT['maxL1Ratio']: sh_bad.append(f'{s}/{l}{SEP}L1/L0 ratio up to {mx:.2f} (> {pT["maxL1Ratio"]}: more than a delta light)')
    if A.lamp_dir:
        p = A.lamp_dir / 'probes.bin'; g = read_json(A.lamp_dir / 'encoding.json') or {}
        if p.exists():
            buf = p.read_bytes(); hl = struct.unpack('<I', buf[:4])[0]; h = json.loads(buf[4:4 + hl]); o = (4 + hl + 3) & ~3
            arr = np.frombuffer(buf, np.float32, offset=o)
            if h.get('groups') != len(g.get('groups', [])): sh_bad.append(f'lampgroups/probes.bin{SEP}{h.get("groups")} groups vs encoding.json {len(g.get("groups", []))}')
            if arr.size != h['groups'] * h['count'] * 9: sh_bad.append(f'lampgroups/probes.bin{SEP}size does not match header')
            elif not np.isfinite(arr).all(): sh_bad.append(f'lampgroups/probes.bin{SEP}non-finite coefficients')
            if first is not None and h['count'] != len(first): sh_bad.append(f'lampgroups/probes.bin{SEP}{h["count"]} probes vs {len(first)}')
    rep.check('probes-walls', 'valid light probes not inside a plan wall piece at their height or outside the lot', 'fail', walls_bad)
    rep.check('probes-flags', f'probe files present, same positions in every slot, at most {pT["maxInvalidFraction"]:.0%} flagged invalid', 'fail', flag_bad)
    rep.check('probes-sh', 'SH finite, L0 non-negative, L1/L0 ratio within a physical radiance (<= sqrt 3)', 'fail', sh_bad)
    rep.details['probeSH'] = info


def check_refl(rep, A, T, plan, slots):
    rT = T['refl']; layout, place, black, cross = [], [], [], []
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()): pts = layoutlib.points(plan)
    expect = [(p, layoutlib.plan_box(plan, p)) for p in pts]
    first = None; ceil = float(plan.levels['ceiling']); rects = layoutlib.full_walls(plan)
    for s in slots:
        fr = []
        meta = read_json(A.aux_dir(s) / 'refl' / 'meta.json')
        if meta is None: layout.append(f'{s}{SEP}refl/meta.json missing'); continue
        meta = sorted(meta, key=lambda m: m['i'])
        sig = [(m['i'], m['p'], m['min'], m['max']) for m in meta]
        if first is None: first = (s, sig)
        elif len(sig) != len(first[1]) or any(a[0] != b[0] or max(abs(x - y) for k in (1, 2, 3) for x, y in zip(a[k], b[k])) > 1e-4 for a, b in zip(sig, first[1])):
            cross.append(f'{s}{SEP}layout differs from {first[0]}')
        if len(meta) != len(expect): layout.append(f'{s}{SEP}{len(meta)} probes in meta.json, {len(expect)} in reflprobe_layout.py')
        for m in meta:
            i = m['i']; x, y, z = m['p']; px, py = x, -z
            if i < len(expect):
                (ex, ey, ez), box = expect[i]; dp = math.hypot(px - ex, py - ey)
                db = max(abs(m['min'][0] - box['min'][0]), abs(m['max'][0] - box['max'][0]), abs(m['min'][2] - box['min'][2]), abs(m['max'][2] - box['max'][2]), abs(m['min'][1] - box['min'][1]), abs(m['max'][1] - box['max'][1])) if box else 0.0
                if dp > rT['pointTol'] or (box and db > rT['boxTol']): layout.append(f'{s} probe {i}{SEP}point off {dp:.2f} m, box off {db:.2f} m')
            # placement: inside its space, not in a wall, box holds the centre and stays in its room except through openings
            for k in range(3):
                if not m['min'][k] <= m['p'][k] <= m['max'][k]: place.append(f'{s} probe {i}{SEP}box does not hold its centre (axis {k})')
            if layoutlib.in_plan(plan, px, py):
                sp = plan.space_at(px, py)
                if sp is None: place.append(f'{s} probe {i}{SEP}centre ({px:.2f}, {py:.2f}) is in no plan space (a wall or seam)')
                if layoutlib.wall_distance(layoutlib.walls_at(plan, y), px, py) < rT['wallClearance']: place.append(f'{s} probe {i}{SEP}centre ({px:.2f}, {py:.2f}) within {rT["wallClearance"]} m of a wall at its height')
                if sp:
                    b = plan.rect_of(sp['id']); ext = [(m['max'][0] - px, '+x'), (px - m['min'][0], '-x'), (-m['min'][2] - py, '+y'), (py + m['max'][2], '-y')]
                    for (e, side), (dx, dy) in zip(ext, ((1, 0), (-1, 0), (0, 1), (0, -1))):
                        hit = layoutlib.cast(rects, px, py, dx, dy)
                        if e > hit + rT['boxOverTol'] and not through_opening(plan, px + dx * hit, py + dy * hit):
                            place.append(f'{s} probe {i}{SEP}box reaches {e:.2f} m {side}, but a wall stands {hit:.2f} m away (space {sp["id"]}, no opening there)')
                    if m['min'][1] < -0.05 or m['max'][1] > ceil + 0.05: place.append(f'{s} probe {i}{SEP}box height {m["min"][1]:.2f}..{m["max"][1]:.2f} outside 0..{ceil}')
            f = A.aux_dir(s) / 'refl' / f'probe_{i:02d}.hdr'
            if not f.exists(): layout.append(f'{s} probe {i}{SEP}panorama missing'); continue
            try: img = read_hdr(f)
            except Exception as e:   # noqa: BLE001
                layout.append(f'{s} probe {i}{SEP}panorama unreadable: {e}'); continue
            mx = img.max(-1); bl = float((mx < rT['blackLevel']).mean())
            fr.append(bl); rep.details.setdefault('reflBlack', {})[f'{s}/{i:02d}'] = round(bl, 4)
            if not np.isfinite(img).all(): black.append(f'{s} probe {i}{SEP}non-finite pixels')
            elif bl > rT['maxBlackFraction']: black.append(f'{s} probe {i}{SEP}{bl:.0%} of the panorama is black')
            elif float(mx.std()) < rT['minStd']: black.append(f'{s} probe {i}{SEP}panorama is uniform (std {mx.std():.3g})')
        if fr: rep.metric(f'refl.{s}.blackFractionMean', np.mean(fr)); rep.metric(f'refl.{s}.blackFractionMax', max(fr)); rep.metric(f'refl.{s}.panoramas', len(fr))
    rep.check('refl-layout', 'refl/meta.json (every slot) equals what reflprobe_layout.py lays out now (points %g m, boxes %g m)' % (rT['pointTol'], rT['boxTol']), 'fail', layout)
    rep.check('refl-placement', 'reflection probes inside a plan space, clear of walls, box holding the centre and stopping at walls except at openings', 'fail', place)
    rep.check('refl-black', f'panoramas with at most {rT["maxBlackFraction"]:.0%} black pixels (max channel under {rT["blackLevel"]}) and not uniform', 'fail', black)
    rep.check('refl-slots', 'the same probe layout in every slot', 'fail', cross)


def through_opening(plan, x, y, pad=0.08):
    for o in plan.openings:
        if o['kind'] == 'window': continue
        if o['x0'] - pad <= x <= o['x1'] + pad and o['y0'] - pad <= y <= o['y1'] + pad: return True
    return False


# ---- baseline -----------------------------------------------------------------------------------------------------------------
def diff_baseline(rep, base, T):
    """Failures not in the baseline's expected list, expected ones that vanished (shrink-only: remove them), metrics moved."""
    problems = []
    exp = base.get('expectedFailures', {}) if base else {}
    cur = rep.failures()
    for cid, offs in cur.items():
        known = set(exp.get(cid, []))
        new = [o for o in offs if o not in known]
        for o in new[:50]: problems.append(f'NEW FAILURE {cid}: {o}')
        if len(new) > 50: problems.append(f'NEW FAILURE {cid}: ... and {len(new) - 50} more')
    for cid, offs in exp.items():
        if cid not in rep.checks: continue
        gone = [o for o in offs if o not in set(cur.get(cid, []))]
        for o in gone[:50]: problems.append(f'FIXED, remove from the baseline (--approve): {cid}: {o}')
        if len(gone) > 50: problems.append(f'FIXED, remove from the baseline (--approve): {cid}: ... and {len(gone) - 50} more')
    bT = T['baseline']; moved = []
    ref = (base or {}).get('metrics', {})
    for k, v in sorted(rep.metrics.items()):
        if k not in ref: continue
        tol = next((t for pre, t in bT['relTolByPrefix'].items() if k.startswith(pre)), bT['relTol'])
        old = ref[k]; d = abs(v - old)
        if d > bT['absTol'] and d > tol * max(abs(old), bT['absTol']): moved.append(f'METRIC {k}: {old:.6g} -> {v:.6g} ({(v - old) / max(abs(old), 1e-12):+.1%}, tolerance {tol:.0%})')
    problems += moved
    gone_metrics = [k for k in ref if k not in rep.metrics]
    rep.details['baseline'] = dict(newMetrics=[k for k in rep.metrics if k not in ref][:50], missingMetrics=gone_metrics[:50])
    return problems


def write_baseline(path, rep, base, allow_new):
    exp = (base or {}).get('expectedFailures', {}); cur = rep.failures(); out = {}
    added = {}
    for cid, offs in cur.items():
        known = set(exp.get(cid, []))
        add = [o for o in offs if o not in known]
        if add: added[cid] = add
        out[cid] = offs if allow_new else [o for o in offs if o in known]
    if added and not allow_new: return False, added
    data = {'note': 'Approved bake QA baseline (bake/validate/qa.py). expectedFailures: known violations of the shipped assets, shrink-only: qa.py fails on any offender not listed and on listed ones that disappeared; rewrite with --approve after a fix (new entries need --allow-new-failures). metrics: approved values; qa_thresholds.json baseline.* sets how far each may move.',
            'expectedFailures': {k: v for k, v in sorted(out.items()) if v}, 'metrics': dict(sorted(rep.metrics.items()))}
    Path(path).write_text(json.dumps(data, indent=1) + '\n')
    return True, added


# ---- report text ----------------------------------------------------------------------------------------------------------------
def text_report(rep, problems, seconds, A):
    lines = [f'bake QA of {A.root.name} ({"shipped assets" if A.shipped else "bake output"}): slots {", ".join(rep.details.get("slots", []))}; {seconds:.0f} s']
    for cid, c in rep.checks.items():
        mark = 'ok  ' if not c['count'] else ('FAIL' if c['level'] == 'fail' else 'warn')
        lines.append(f'{mark} {cid:28s} {c["count"]:5d}  {c["title"]}')
        for o in c['offenders'][:5 if c['count'] else 0]: lines.append(f'       {o}')
        if c['count'] > 5: lines.append(f'       ... {c["count"] - 5} more (qa.json)')
    for n in rep.notes: lines.append('note: ' + n)
    lines.append('')
    lines.append(f'{len(problems)} problem(s) against the baseline' if problems else 'matches the baseline')
    for p in problems[:40]: lines.append('  ' + p)
    if len(problems) > 40: lines.append(f'  ... {len(problems) - 40} more')
    return '\n'.join(lines) + '\n'


# ---- main --------------------------------------------------------------------------------------------------------------------
def run(root, thresholds, plan_path=None, objects_path=None, switches=None, slots=None, tiers=True, uv=None):
    t0 = time.time(); rep = Report(); A = Assets(root, uv); A.switches_file = switches
    T = thresholds
    plan = planlib.load(str(plan_path) if plan_path else None)
    objs = Objects(objects_path)
    if not objs.ok: rep.notes.append('objects.json not found: lamp group list and material albedo checks are limited')
    slots = [s for s in A.slots if not slots or s in slots]
    rep.details['slots'] = slots
    if not A.uv or not A.uv.exists(): rep.check('files-uv', 'lightmap_uv2.bin.gz present', 'fail', [f'lightmap_uv2.bin.gz{SEP}not found in {A.root.name}']); return rep, A
    header = read_units(A.uv); rep.details['atlas'] = header['atlas']
    check_files(rep, A, T); check_encodings(rep, A, T, slots)
    check_units(rep, A, T, header['units'], objs, plan, slots, tiers)
    check_probes(rep, A, T, plan, slots)
    check_refl(rep, A, T, plan, slots)
    rep.metric('units.count', len(header['units'])); rep.metric('atlas.width', header['atlas'][0]); rep.metric('atlas.height', header['atlas'][1])
    rep.details['seconds'] = round(time.time() - t0, 1)
    return rep, A


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dir', nargs='?', default=str(REPO / 'web/assets/lightmaps'))
    ap.add_argument('--out', default='qa.json'); ap.add_argument('--report', default=None)
    ap.add_argument('--thresholds', default=str(HERE / 'qa_thresholds.json')); ap.add_argument('--baseline', default=str(HERE / 'qa_baseline.json'))
    ap.add_argument('--no-baseline', action='store_true'); ap.add_argument('--approve', action='store_true'); ap.add_argument('--allow-new-failures', action='store_true')
    ap.add_argument('--plan'); ap.add_argument('--objects', default=str(REPO / 'web/tools/golden/objects.json')); ap.add_argument('--switches'); ap.add_argument('--uv')
    ap.add_argument('--slots'); ap.add_argument('--no-tiers', action='store_true')
    a = ap.parse_args(argv)
    if not Path(a.dir).is_dir(): print(f'not a folder: {a.dir}', file=sys.stderr); return 2
    T = json.loads(Path(a.thresholds).read_text())
    rep, A = run(a.dir, T, a.plan, a.objects, a.switches, a.slots.split(',') if a.slots else None, not a.no_tiers, a.uv)
    base = None if a.no_baseline else read_json(a.baseline)
    if a.approve:
        ok, added = write_baseline(a.baseline, rep, base, a.allow_new_failures)
        if not ok:
            print('refusing to add expected failures (use --allow-new-failures to accept them):', file=sys.stderr)
            for cid, offs in added.items():
                for o in offs[:10]: print(f'  {cid}: {o}', file=sys.stderr)
            return 1
        base = read_json(a.baseline); print(f'baseline written: {a.baseline}')
    problems = diff_baseline(rep, base, T) if base is not None else [f'NEW FAILURE {c}: {o}' for c, offs in rep.failures().items() for o in offs]
    seconds = rep.details.get('seconds', 0)
    text = text_report(rep, problems, seconds, A)
    out = dict(version=1, root=A.root.name, seconds=seconds, slots=rep.details.get('slots'), problems=problems, notes=rep.notes,
               checks=rep.checks, metrics=rep.metrics, details={k: v for k, v in rep.details.items() if k not in ('slots',)})
    Path(a.out).write_text(json.dumps(out, indent=1) + '\n')
    Path(a.report or Path(a.out).with_suffix('.txt')).write_text(text)
    sys.stdout.write(text)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
