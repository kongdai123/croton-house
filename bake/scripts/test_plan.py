"""plan.py against the shared test vectors (web/tools/golden/plan_vectors.json, generated from web/src/plan.js): the bake and
the site must answer every plan question the same way."""
import json, math, os, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bake/scripts'))
import plan as planlib

V = json.loads((ROOT / 'web/tools/golden/plan_vectors.json').read_text())
P = planlib.load(str(ROOT / 'web/data/plan.json'))
r9 = lambda v: planlib.jround(v * 1e9) / 1e9


class PlanReader(unittest.TestCase):
    def test_points(self):
        bad = []
        for row in V['points']:
            x, y = row[0], row[1]
            s, n, rn = P.space_at(x, y), P.space_at(x, y, 0.3), P.room_name(x, y)
            got = [x, y, s['id'] if s else None, n['id'] if n else None, rn['en'], rn['zh'], rn['outside'],
                   *[P.is_inside(x, y, m) for m in V['margins']], r9(P.outline_distance(x, y)), r9(P.indoor_weight(x, y, 1.0)), r9(P.indoor_weight(x, y, 2.8))]
            if got != row: bad.append((row, got))
        self.assertFalse(bad, f'{len(bad)} points differ from plan.js, first {bad[:3]}')

    def test_walls_neighbors_openings(self):
        for z, idx in V['wallsAt'].items():
            self.assertEqual([P.pieces.index(p) for p in P.walls_at(float(z))], idx, f'walls_at({z})')
        for sid, nb in V['neighbors'].items(): self.assertEqual(P.neighbors(sid), nb, sid)
        for oid, (a, b) in V['otherSide'].items():
            o = P.opening(oid); cx, cy = (o['x0'] + o['x1']) / 2, (o['y0'] + o['y1']) / 2; d = (0, 1) if o['dir'] == 'H' else (1, 0)
            self.assertEqual([P.other_side(oid, cx - d[0], cy - d[1])['id'], P.other_side(oid, cx + d[0], cy + d[1])['id']], [a, b], oid)
        for sid, r in V['rectOf'].items(): self.assertEqual(P.rect_of(sid), r, sid)

    def test_inside_rects_and_glsl(self):
        for m in V['margins']:
            self.assertEqual(P.inside_rects(m), V['insideRects'][str(m)], f'margin {m}')
            self.assertEqual(P.inside_glsl('outsideHouse', m), V['insideGLSL'][str(m)], f'margin {m}')

    def test_frames(self):
        self.assertEqual([planlib.to_scene(1, 2, 3), planlib.to_plan(1, 3, -2)], V['toScene'])


if __name__ == '__main__': unittest.main()
