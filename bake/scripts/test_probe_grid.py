"""The light-probe grid (probe_grid.py) against the plan: no point that is rendered stands inside a wall piece at its height
or outside the lot (bake QA probes-walls; probe 668 did), and the grid keeps its order and positions (probes.bin and the
lamp groups' probes index it). python3 bake/scripts/test_probe_grid.py"""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan as planlib
import probe_grid


class ProbeGrid(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.P = planlib.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'data', 'plan.json'))
        cls.pts = probe_grid.points(cls.P)

    def test_order(self):
        """The grid make_tasks.py has always written: indoor 0.5 m, then outdoor 1 m, per height."""
        old = []
        for z in (0.35, 0.95, 1.55):
            old += [(-7.85 + 0.5 * i, -5.85 + 0.5 * j, z) for i in range(33) for j in range(24) if self.P.is_inside(-7.85 + 0.5 * i, -5.85 + 0.5 * j)]
            old += [(-12 + i, -11 + j, z) for i in range(25) for j in range(27) if not self.P.is_inside(-12 + i, -11 + j)]
        self.assertEqual([p[:3] for p in self.pts], old)

    def test_no_rendered_probe_in_a_wall(self):
        lot = self.P.data['lot']; bad = []
        for k, (x, y, z, solid) in enumerate(self.pts):
            if solid: continue
            if not (lot['x0'] <= x <= lot['x1'] and lot['y0'] <= y <= lot['y1']): bad.append((k, x, y, z, 'outside the lot'))
            for w in self.P.walls_at(z):
                if w['x0'] - 0.002 < x < w['x1'] + 0.002 and w['y0'] - 0.002 < y < w['y1'] + 0.002: bad.append((k, x, y, z, w['wall'])); break
        self.assertFalse(bad, f'{len(bad)} rendered probes inside a wall piece, first {bad[:5]}')

    def test_probe_668(self):
        """(7.65, -5.85, 0.35): 0.3 mm inside bedroom 3's south wall, shipped valid by the ray test alone."""
        x, y, z, solid = self.pts[668]
        self.assertEqual((x, y, z), (7.65, -5.85, 0.35)); self.assertTrue(solid)

    def test_json(self):
        doc = probe_grid.probes_json(self.P)
        self.assertEqual(len(doc['points']), len(self.pts))
        self.assertEqual(sum(1 for p in doc['points'] if p.get('solid')), sum(p[3] for p in self.pts))
        self.assertEqual(doc['points'][668]['t'], [7.65, 0.35, 5.85])


if __name__ == '__main__':
    unittest.main()
