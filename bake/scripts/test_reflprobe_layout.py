"""Reflection probe layout against the floor plan, without Blender: python3 bake/scripts/test_reflprobe_layout.py"""
import json, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bake/scripts'))
import reflprobe_layout as L
plan = L.load_plan(ROOT / 'web/data/house.json')


class Layout(unittest.TestCase):
    def test_points_clear_of_walls(self):
        pts = L.points(plan); rects = L.walls_at(plan, L.PROBE_Z)
        self.assertEqual(len(pts), 27)
        for i, (x, y, z) in enumerate(pts):
            if L.in_plan(plan, x, y): self.assertGreaterEqual(L.wall_distance(rects, x, y), L.WALL_CLEARANCE - 1e-6, i)
        self.assertEqual(pts[9][:2], (3.3, -3.6))   # was inside the living / front-bedroom partition

    def test_nudge(self):
        x, y, d = L.clear(plan, 4.0, -3.6)   # the partition itself: moved out, the nearest side
        self.assertGreaterEqual(d, L.WALL_CLEARANCE); self.assertLess(abs(x - 4.0) + abs(y + 3.6), 0.8)

    def test_boxes_follow_rooms(self):
        boxes = {i: L.plan_box(plan, p) for i, p in enumerate(L.points(plan))}
        for i, b in boxes.items():
            if b is None: continue
            p = b['p']
            for k in range(3): self.assertTrue(b['min'][k] <= p[k] <= b['max'][k], (i, k))
            self.assertEqual((b['min'][1], b['max'][1]), (0.0, 2.44))
        # the great room's boxes stop at its east wall: none reaches into the front bedroom (x > 4.08, plan y < -2.14)
        for i in (3, 4, 6, 7, 9): self.assertLessEqual(boxes[i]['max'][0], 3.98, i)
        self.assertGreaterEqual(boxes[12]['min'][0], 4.08)
        # the hall bath's box runs to its east wall (the shower glass is not a wall), bath B has its own
        self.assertGreater(boxes[13]['max'][0], 7.8); self.assertGreater(boxes[26]['max'][0], 7.8)
        self.assertLess(-boxes[13]['min'][2], 0.25); self.assertGreater(-boxes[26]['max'][2], 0.25)


if __name__ == '__main__': unittest.main()
