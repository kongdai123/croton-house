"""The bake's lamps without Blender: fixture_lights.py turns every switch record of the headless scene (web/tools/golden/
objects.json bakeSwitches, the records switch_groups.mjs exports) into one physical light; its emitter models convert the
declared lumens exactly (fixture_calibrate.py checks them in Cycles), and the lights stand where their fixtures are."""
import json
import math
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bake/scripts'))
import fixture_lights as fl   # noqa: E402

SWITCHES = list(json.loads((ROOT / 'web/tools/golden/objects.json').read_text())['bakeSwitches'].values())
ORDER = json.loads((ROOT / 'web/tools/golden/spatial.json').read_text())['order']
smooth = lambda u: u * u * (3 - 2 * u)


class Cone(unittest.TestCase):
    def test_half_intensity_at_half_the_beam(self):
        for beam in (20, 40, 90, 105, 120):
            size, blend, omega = fl.cone(beam)
            c = math.cos(size / 2); u = (math.cos(math.radians(beam) / 2) - c) / ((1 - c) * blend)
            self.assertAlmostEqual(smooth(u), 0.5, places=9)
            self.assertLessEqual(size, math.pi + 1e-12)

    def test_solid_angle_is_the_attenuation_integral(self):
        for beam in (40, 105):
            size, blend, omega = fl.cone(beam); c = math.cos(size / 2); n = 20000; tot = 0.0
            for i in range(n):
                t = (i + 0.5) / n * size / 2; u = min(1.0, max(0.0, (math.cos(t) - c) / ((1 - c) * blend)))
                tot += smooth(u) * 2 * math.pi * math.sin(t) * (size / 2 / n)
            self.assertAlmostEqual(tot / omega, 1.0, places=4)

    def test_beams_beyond_lambertian_refused(self):
        with self.assertRaises(ValueError): fl.cone(150)


class Watts(unittest.TestCase):
    def test_flux_is_lumens_over_the_constant(self):
        for e in ('omni', 'linear'):
            self.assertAlmostEqual(fl.watts({'lm': 640, 'emitter': e}), 640 / fl.LM_PER_W)
        for beam in (40, 105):
            P = fl.watts({'lm': 640, 'emitter': 'downlight', 'beam': beam})
            self.assertAlmostEqual(P / (4 * math.pi) * fl.cone(beam)[2], 640 / fl.LM_PER_W)


class SceneLights(unittest.TestCase):
    def setUp(self):
        self.plan = fl.plan({'switches': SWITCHES, 'groups': ORDER})

    def test_one_light_per_switch_in_its_group(self):
        self.assertEqual(len(self.plan), len(SWITCHES))
        for g, s, L in self.plan:
            self.assertEqual(ORDER[g], s['group'])
            self.assertGreater(L['energy'], 0, s['key'])
            self.assertEqual(L['lm'], s['output']['lm'])

    def test_lights_stand_at_their_fixtures(self):
        for g, s, L in self.plan:
            near = [s['spec']['p']] if s.get('spec') else []
            near += [gl['c'] for gl in s['glows']] + [l['p'] for l in s['lights']] + [s['root']]
            d = min(math.dist(L['p'], q) for q in near)
            self.assertLess(d, 0.25 if s['output']['emitter'] == 'spot' else 0.08, f'{s["key"]}: light {L["p"]} {d:.3f} m from its fixture')

    def test_downlights_below_their_lens_aimed_down(self):
        for g, s, L in self.plan:
            if L['emitter'] != 'downlight': continue
            lens = min(s['glows'], key=lambda gl: gl['size'][0] * gl['size'][1])
            self.assertLess(L['p'][2], lens['c'][2] - lens['size'][2] / 2, s['key'])
            self.assertLess(L['aim'][2], -0.8, s['key'])   # down (the alcove can leans toward its wall)

    def test_closet_and_hall_cans_are_smaller(self):
        for g, s, L in self.plan:
            if s['kind'] == 'ceiling' and s['group'] in ('hall', 'closet', 'linen', 'laundry', 'hallCloset', 'bedroomBCloset', 'primaryBathCloset'):
                self.assertLessEqual(L['lm'], 500, s['key'])

    def test_linear_emitters_follow_their_fixture(self):
        for g, s, L in self.plan:
            if L['emitter'] != 'linear': continue
            long = max(s['glows'], key=lambda gl: max(gl['size'][:2]))
            along_y = long['size'][1] > long['size'][0]
            self.assertAlmostEqual(abs(math.sin(L['yaw'])), 1.0 if along_y else 0.0, places=3, msg=s['key'])


if __name__ == '__main__': unittest.main()
