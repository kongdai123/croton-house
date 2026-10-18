"""The bake QA checker (bake/validate/qa.py) on small synthetic bakes: every check must fire on a planted defect and stay quiet
on a clean unit. No Blender, no GPU: python3 bake/scripts/test_qa.py"""
import copy, gzip, json, struct, sys, tempfile, unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bake/validate'))
import qa  # noqa: E402

T0 = json.loads((ROOT / 'bake/validate/qa_thresholds.json').read_text())
PLAN = qa.planlib.load(str(ROOT / 'web/data/plan.json'))
W = H = 64
K = 0.2
RECTS = {'A': (4, 4), 'D': (36, 4), 'B': (4, 36), 'E': (36, 36), 'F': (20, 20)}   # unit -> top-left of a 12 x 12 chart


def centre_of(space):
    r = PLAN.rect_of(space); return ((r['x0'] + r['x1']) / 2, (r['y0'] + r['y1']) / 2)


def write_webp(path, arr):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr.astype(np.uint8), 'RGB').save(path, format='WEBP', lossless=True, quality=100, method=0)


def unit_record(uid, name, x, y, size=12, space='kitchen'):
    cx, cy = centre_of(space)
    uv = np.array([[x, y], [x + size, y], [x + size, y + size], [x, y + size]], float) / (W, H)
    return dict(id=uid, vc=4, nv=4, ni=6, min=[cx - .2, 0.8, -cy - .2], max=[cx + .2, 1.2, -cy + .2]), np.round(uv * 65535).astype(np.uint16), np.array([0, 1, 2, 0, 2, 3], np.uint16)


def write_units(path, specs):
    """specs: [(id, topleft, space)]; a unit with topleft None has no triangles."""
    header = dict(atlas=[W, H], units=[], format=2, ownPrimitives=True, skipped={}); chunks = []; off = 0
    for uid, tl, space in specs:
        rec, uv, idx = unit_record(uid, uid, *(tl or (0, 0)), space=space)
        if tl is None: idx = idx[:0]; rec['ni'] = 0
        rec.update(x16=True, i16=True, off=off)
        parts = [np.arange(4, dtype=np.uint16).tobytes(), idx.tobytes(), uv.tobytes()]
        chunks += parts; off += sum(len(p) for p in parts); header['units'].append(rec)
    hj = json.dumps(header).encode()
    Path(path).write_bytes(gzip.compress(struct.pack('<I', len(hj)) + hj + b''.join(chunks)))


def fill(arr, tl, size, rgb):
    x, y = tl; arr[y:y + size, x:x + size] = rgb


def enc_value(lin):   # linear -> uint8 through the curve
    return int(round(np.sqrt(lin / (lin + K)) * 255))


def build(root, bleed=True):
    """A shipped-style folder: v2/noon (full, half, quarter), probes and reflection probes, and 4 units (A good, D bleeds at the
    tiers, B black on a white material, C without texels, E good, F in the garage lit only by the 'living' lamp group)."""
    root = Path(root); v2 = root / 'v2'; slot = v2 / 'noon'
    specs = [('aaaa', RECTS['A'], 'kitchen'), ('dddd', RECTS['D'], 'kitchen'), ('bbbb', RECTS['B'], 'kitchen'), ('cccc', None, 'kitchen'), ('eeee', RECTS['E'], 'kitchen'), ('ffff', RECTS['F'], 'garage')]
    v2.mkdir(parents=True); write_units(v2 / 'lightmap_uv2.bin.gz', specs)
    good, other = (enc_value(0.05),) * 3, (enc_value(0.08), enc_value(0.04), enc_value(0.02))
    full = np.zeros((H, W, 3), np.uint8)
    for u in 'ADEF': fill(full, RECTS[u], 12, other if u == 'D' else good)
    fill(full, RECTS['B'], 12, (1, 1, 1))                    # a black chart: every texel at the 1/255 floor
    lamps = np.zeros_like(full); fill(lamps, RECTS['A'], 12, good)
    json.dump({'curve': 'sqrt(x/(x+K))', 'K': {'slot': K, 'lamps': K}}, open((slot.mkdir(parents=True) or slot) / 'encoding.json', 'w'))
    write_webp(slot / 'slot.webp', full); write_webp(slot / 'lamps.webp', lamps)
    for tier, f in (('half', 2), ('quarter', 4)):
        t = full[::f, ::f].copy(); tl = lamps[::f, ::f].copy()
        if bleed: fill(t, (RECTS['D'][0] // f, RECTS['D'][1] // f), 12 // f, (enc_value(0.3), enc_value(0.12), enc_value(0.01)))   # orange from a neighbour chart
        write_webp(slot / tier / 'slot.webp', t); write_webp(slot / tier / 'lamps.webp', tl)
        json.dump({'curve': 'sqrt(x/(x+K))', 'K': {'slot': K, 'lamps': K}}, open(slot / tier / 'encoding.json', 'w'))
    # lamp groups: living lights only the garage unit, kitchen the good unit, always nothing
    lg = v2 / 'lampgroups'; lg.mkdir()
    names = ['kitchen', 'living', 'always']
    json.dump({'version': 1, 'curve': 'sqrt(x/(x+K))', 'lampK': 3000, 'textures': 1, 'size': [W, H],
               'groups': [dict(name=n, index=i, always=n == 'always', exterior=False, members=[], tex=0, ch=i, K=K, color=[1, 1, 1]) for i, n in enumerate(names)]}, open(lg / 'encoding.json', 'w'))
    g = np.zeros((H, W, 3), np.uint8); fill(g, RECTS['A'], 12, (enc_value(0.5), 0, 0)); g[RECTS['F'][1]:RECTS['F'][1] + 12, RECTS['F'][0]:RECTS['F'][0] + 12, 1] = enc_value(0.5)
    write_webp(lg / 'lampgroups_0.webp', g)
    for tier, f in (('half', 2), ('quarter', 4)): write_webp(lg / tier / 'lampgroups_0.webp', g[::f, ::f])
    write_probes(root / 'noon' / 'probes.bin')
    write_refl(root / 'noon' / 'refl')
    return root


def write_probes(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    wall = next(p for p in PLAN.pieces if p['kind'] == 'solid' and p['z0'] == 0)
    wx, wy = (wall['x0'] + wall['x1']) / 2, (wall['y0'] + wall['y1']) / 2
    kx, ky = centre_of('kitchen')
    pts = [[kx, 1.0, -ky], [wx, 1.0, -wy], [100.0, 1.0, 0.0], [kx + .3, 1.0, -ky], [kx - .3, 1.0, -ky], [kx, 1.5, -ky]]   # 1: in a wall, 2: outside the lot
    N = len(pts); valid = np.ones(N, np.uint8)
    layer = np.zeros((N, 27), np.float32); layer[:, 0:3] = 1.0
    layers = {l: layer.copy() for l in ('sky', 'sunind', 'lamps')}
    layers['sky'][3, 5] = np.nan                        # non-finite coefficient
    layers['sunind'][4, 3:6] = (3, 0, 0)                # |L1| / L0 = 3 > sqrt 3: not a radiance
    layers['lamps'][5, 0:3] = -1.0                      # negative L0
    header = json.dumps({'count': N, 'layers': ['sky', 'sunind', 'lamps'], 'points': pts}).encode()
    body = struct.pack('<I', len(header)) + header + valid.tobytes()
    body += b'\0' * (-len(body) % 4)
    for l in ('sky', 'sunind', 'lamps'): body += layers[l].tobytes()
    path.write_bytes(body)


def rle_hdr(w, h, rgb_rows):
    """Radiance file with new-style RLE scanlines (runs of equal bytes)."""
    out = b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n' % (h, w)
    for row in rgb_rows:
        out += bytes([2, 2, w >> 8, w & 255])
        for c in range(4):
            ch = row[:, c]; x = 0
            while x < w:
                run = 1
                while x + run < w and ch[x + run] == ch[x] and run < 127: run += 1
                if run >= 4: out += bytes([128 + run, int(ch[x])]); x += run
                else:
                    n = min(w - x, 4); out += bytes([n]) + bytes(int(v) for v in ch[x:x + n]); x += n
    return out


def write_refl(d):
    d.mkdir(parents=True)
    wall = next(p for p in PLAN.pieces if p['kind'] == 'solid' and p['z0'] == 0)
    wx, wy = (wall['x0'] + wall['x1']) / 2, (wall['y0'] + wall['y1']) / 2
    kx, ky = centre_of('kitchen')
    meta = [dict(i=0, p=[wx, 1.3, -wy], min=[wx - 1, 0, -wy - 1], max=[wx + 1, 2.44, -wy + 1]),
            dict(i=1, p=[kx, 1.3, -ky], min=[kx - 1, 0, -ky - 1], max=[kx + 1, 2.44, -ky + 1])]
    json.dump(meta, open(d / 'meta.json', 'w'))
    (d / 'probe_00.hdr').write_bytes(rle_hdr(8, 4, [np.zeros((8, 4), np.uint8)] * 4))                 # all black
    ok = np.zeros((8, 4), np.uint8); ok[:, 0:3] = (np.arange(8)[:, None] * 20 + 60); ok[:, 3] = 130
    (d / 'probe_01.hdr').write_bytes(rle_hdr(8, 4, [ok] * 4))


class Fixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(); cls.root = build(cls.tmp.name)
        objs = {'meshes': {'lm:aaaa': {'materials': ['m#white'], 'region': 'house'}, 'lm:dddd': {'materials': ['m#white'], 'region': 'house'}, 'lm:bbbb': {'materials': ['m#white'], 'region': 'house'},
                           'lm:cccc': {'materials': ['m#white'], 'region': 'house'}, 'lm:eeee': {'materials': ['m#white'], 'region': 'house'}, 'lm:ffff': {'materials': ['m#white'], 'region': 'house'}},
                'materials': {'m#white': {'color': 'ffffff', 'emissive': '000000'}}, 'placed': {'kitchen.table': {'bbox': [-50, 0, -50, 50, 3, 50], 'id': 'table', 'name': 'Table'}}}
        cls.objects = Path(cls.tmp.name) / 'objects.json'; cls.objects.write_text(json.dumps(objs))
        cls.switches = Path(cls.tmp.name) / 'switches.json'
        cls.switches.write_text(json.dumps([dict(group='kitchen', space='kitchen', circuit='main', exterior=False), dict(group='living', space='living', circuit='main', exterior=False), dict(group='garage', space='garage', circuit='main', exterior=False)]))
        cls.T = copy.deepcopy(T0); cls.T['tiers']['maxZeroForLuminance'] = 0.3   # the one-texel raster fringe of a 12 x 12 chart is 15% zero
        cls.rep, cls.A = qa.run(cls.root, cls.T, ROOT / 'web/data/plan.json', cls.objects, cls.switches)

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def keys(self, cid): return {o.split(qa.SEP)[0].split('@')[0] for o in self.rep.checks[cid]['offenders']}


class Units(Fixture):
    def test_layout_found(self):
        self.assertTrue(self.A.shipped); self.assertEqual(self.A.slots, ['noon'])

    def test_no_texels(self): self.assertEqual(self.keys('units-no-texels'), {'cccc'})

    def test_black_on_white_material(self):
        self.assertEqual(self.keys('units-black'), {'bbbb'})
        self.assertIn('Table', self.rep.checks['units-black']['offenders'][0])   # named through objects.json placed boxes

    def test_dim_material_is_not_flagged(self):
        t = copy.deepcopy(self.T); objs = json.loads(self.objects.read_text()); objs['materials']['m#white']['color'] = '000000'
        p = Path(self.tmp.name) / 'dim.json'; p.write_text(json.dumps(objs))
        rep, _ = qa.run(self.root, t, ROOT / 'web/data/plan.json', p, self.switches)
        self.assertEqual(rep.checks['units-black']['count'], 0)

    def test_coverage_counts_black_charts_as_covered(self):
        self.assertNotIn('bbbb', self.keys('units-coverage'))
        self.assertIn('cccc', self.keys('units-no-texels'))

    def test_clean_units_pass(self):
        bad = self.keys('units-black') | self.keys('units-no-texels') | self.keys('units-coverage')
        self.assertFalse({'aaaa', 'eeee', 'dddd'} & bad)


class Tiers(Fixture):
    def test_bleed_found_on_both_tiers(self):
        offenders = self.rep.checks['tiers-consistency']['offenders']
        self.assertEqual({o.split(qa.SEP)[0] for o in offenders}, {'dddd@noon/half', 'dddd@noon/quarter'})

    def test_clean_tiers_pass(self):
        with tempfile.TemporaryDirectory() as d:
            build(d, bleed=False)
            rep, _ = qa.run(d, self.T, ROOT / 'web/data/plan.json', self.objects, self.switches)
            self.assertEqual(rep.checks['tiers-consistency']['count'], 0)
            self.assertEqual(rep.checks['files-present']['count'], 0); self.assertEqual(rep.checks['files-sizes-match']['count'], 0)

    def test_missing_tier_and_wrong_size(self):
        with tempfile.TemporaryDirectory() as d:
            build(d); (Path(d) / 'v2/noon/quarter/slot.webp').unlink()
            write_webp(Path(d) / 'v2/noon/half/slot.webp', np.zeros((30, 32, 3)))
            rep, _ = qa.run(d, self.T, ROOT / 'web/data/plan.json', self.objects, self.switches)
            self.assertTrue(any('quarter/slot.webp' in o for o in rep.checks['files-present']['offenders']))
            self.assertTrue(any('half/slot.webp' in o for o in rep.checks['files-sizes-match']['offenders']))


class Groups(Fixture):
    def test_order_against_the_manifest(self):
        off = self.rep.checks['lamp-groups-order']['offenders']
        self.assertEqual(sorted(o.split(qa.SEP)[0] for o in off), ['garage'])   # the manifest has garage, the encoding does not

    def test_expected_order_follows_the_plan(self):
        recs = [dict(group='b', space='living', circuit='lamps'), dict(group='a', space='living', circuit='main'), dict(group='p', space='porch', exterior=True), dict(group='k', space='kitchen', circuit='main')]
        self.assertEqual(qa.lamp_group_order(PLAN, recs), ['k', 'a', 'b', 'p', 'always'])

    def test_switches_json_shape(self):
        recs = json.loads(self.switches.read_text()); p = Path(self.tmp.name) / 'sw2.json'
        p.write_text(json.dumps({'switches': recs, 'groups': ['kitchen', 'living', 'garage', 'always']}))
        rep, _ = qa.run(self.root, self.T, ROOT / 'web/data/plan.json', self.objects, p)
        self.assertEqual(sorted(o.split(qa.SEP)[0] for o in rep.checks['lamp-groups-order']['offenders']), ['garage'])
        p.write_text(json.dumps({'switches': recs, 'groups': ['living', 'kitchen', 'garage', 'always']}))   # not the canonical order
        rep, _ = qa.run(self.root, self.T, ROOT / 'web/data/plan.json', self.objects, p)
        self.assertIn('switches.json', ' '.join(rep.checks['lamp-groups-order']['offenders']))

    def test_zero_energy(self): self.assertEqual(self.keys('lamp-groups-energy'), {'always'})

    def test_footprint_leak(self):
        self.assertEqual(self.keys('lamp-groups-footprint'), {'living'})   # lights a unit in the garage only; kitchen's own light stays home


class Probes(Fixture):
    def test_wall_and_lot(self):
        self.assertEqual({o.split(qa.SEP)[0] for o in self.rep.checks['probes-walls']['offenders']}, {'noon probe 1', 'noon probe 2'})

    def test_sh(self):
        off = ' '.join(self.rep.checks['probes-sh']['offenders'])
        self.assertIn('non-finite', off); self.assertIn('ratio up to', off); self.assertIn('negative L0', off)

    def test_flags(self):
        t = copy.deepcopy(self.T); t['probes']['maxInvalidFraction'] = -1
        with tempfile.TemporaryDirectory() as d:
            build(d)
            rep, _ = qa.run(d, t, ROOT / 'web/data/plan.json', self.objects, self.switches)
            self.assertEqual(rep.checks['probes-flags']['count'], 1)


class Refl(Fixture):
    def test_layout_mismatch(self):
        self.assertTrue(self.rep.checks['refl-layout']['count'] >= 1)
        self.assertIn('2 probes in meta.json', ' '.join(self.rep.checks['refl-layout']['offenders']))

    def test_probe_in_wall(self):
        off = ' '.join(self.rep.checks['refl-placement']['offenders'])
        self.assertIn('probe 0', off); self.assertIn('wall', off)

    def test_black_panorama_only(self):
        self.assertEqual({o.split(qa.SEP)[0] for o in self.rep.checks['refl-black']['offenders']}, {'noon probe 0'})

    def test_hdr_rle_decode(self):
        row = np.zeros((8, 4), np.uint8); row[:, 0] = np.arange(8) * 10 + 128; row[:, 3] = 129   # runs and literals
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'x.hdr'; p.write_bytes(rle_hdr(8, 2, [row, row]))
            img = qa.read_hdr(p)
        self.assertEqual(img.shape, (2, 8, 3)); np.testing.assert_allclose(img[1, :, 0], (np.arange(8) * 10 + 128) * 2.0 ** (129 - 136), rtol=1e-6)


class Files(Fixture):
    def test_size_cap(self):
        t = copy.deepcopy(self.T); t['files']['maxBytes'] = 500
        rep, _ = qa.run(self.root, t, ROOT / 'web/data/plan.json', self.objects, self.switches)
        self.assertTrue(rep.checks['files-size']['count'] >= 2)

    def test_bad_k(self):
        with tempfile.TemporaryDirectory() as d:
            build(d); p = Path(d) / 'v2/noon/encoding.json'; e = json.loads(p.read_text()); e['K']['slot'] = -1; e['K']['lamps'] = float('nan'); p.write_text(json.dumps(e))
            rep, _ = qa.run(d, self.T, ROOT / 'web/data/plan.json', self.objects, self.switches)
            self.assertEqual(rep.checks['encoding-valid']['count'], 2)


class Baseline(Fixture):
    def test_expected_failures_are_shrink_only(self):
        base = {'expectedFailures': {k: v for k, v in self.rep.failures().items()}, 'metrics': dict(self.rep.metrics)}
        self.assertEqual(qa.diff_baseline(self.rep, base, self.T), [])
        # a failure that is not expected is reported
        base2 = copy.deepcopy(base); base2['expectedFailures']['units-black'] = []
        self.assertTrue(any(p.startswith('NEW FAILURE units-black: bbbb') for p in qa.diff_baseline(self.rep, base2, self.T)))
        # an expected failure that vanished must leave the baseline
        base3 = copy.deepcopy(base); base3['expectedFailures']['units-black'].append('gone')
        self.assertTrue(any(p.startswith('FIXED') and 'gone' in p for p in qa.diff_baseline(self.rep, base3, self.T)))

    def test_metric_tolerance(self):
        base = {'expectedFailures': self.rep.failures(), 'metrics': dict(self.rep.metrics)}
        key = 'slot.noon.meanIrradiance'; base['metrics'][key] *= 1.5
        self.assertTrue(any(p.startswith('METRIC ' + key) for p in qa.diff_baseline(self.rep, base, self.T)))
        base['metrics'][key] = self.rep.metrics[key] * 1.01
        self.assertFalse(any(p.startswith('METRIC ' + key) for p in qa.diff_baseline(self.rep, base, self.T)))

    def test_approve_refuses_new_failures(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'base.json'
            ok, added = qa.write_baseline(path, self.rep, None, False)
            self.assertFalse(ok); self.assertIn('units-black', added); self.assertFalse(path.exists())
            ok, _ = qa.write_baseline(path, self.rep, None, True); self.assertTrue(ok)
            data = json.loads(path.read_text()); self.assertEqual(data['expectedFailures']['units-black'], ['bbbb'])

    def test_main_exit_code(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d) / 'base.json'; out = Path(d) / 'qa.json'
            args = [str(self.root), '--out', str(out), '--baseline', str(base), '--plan', str(ROOT / 'web/data/plan.json'), '--objects', str(self.objects), '--switches', str(self.switches)]
            self.assertEqual(qa.main(args), 1)                                              # no baseline: every failure is new
            self.assertEqual(qa.main(args + ['--approve']), 1)                              # refuses to add
            self.assertEqual(qa.main(args + ['--approve', '--allow-new-failures']), 0)
            self.assertEqual(qa.main(args), 0)                                              # now expected
            self.assertEqual(json.loads(out.read_text())['problems'], [])
            self.assertEqual(qa.main([str(Path(d) / 'nope')]), 2)


if __name__ == '__main__': unittest.main()
