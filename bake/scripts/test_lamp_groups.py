"""Group routing without importing Blender or starting a bake."""
import ast
import json
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bake/scripts'))
tree = ast.parse((ROOT / 'bake/scripts/lamp_groups.py').read_text())
keep = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('room', 'where', 'group_of') or
        isinstance(n, ast.Import) and any(a.name == 'plan' for a in n.names) or
        isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ('PLAN', 'ORDER') for t in n.targets)]
ns = {}
exec(compile(ast.Module(body=keep, type_ignores=[]), '<group routing>', 'exec'), ns)


class LampGroups(unittest.TestCase):
    def test_existing_and_new_fixtures(self):
        meta = json.loads((ROOT / 'web/assets/lightmaps/v2/lampgroups/encoding.json').read_text())
        reached = set()
        for g in meta['groups']:
            for m in g['members']:
                p = m['root'] if m['id'] != 'niche-recessed-can' else [3.65, 1.254, 2.41]
                if m['id'] == 'garage-garageDoorOpen': p = [p[0], -5.5, 2.2]
                s = dict(m, lights=[], spec={'p': p}, glows=[])
                actual = ns['group_of'](s)
                expected = g['name']
                if m['id'] == 'niche-recessed-can': expected = 'livingNiche'
                if 'kitchen-west-run' in m['id']: expected = 'kitchenCabinet'
                if expected in ('bedroomB', 'bedroom3') and m['id'] != 'decor-recessed-light': expected += 'Lamps'
                self.assertEqual(actual, expected, m['key'])
                reached.add(actual)
        for group, p, exterior in [('bathB', [6.15, 1.12, 2.4], False), ('hallBath', [6.15, -0.72, 2.4], False),
                                    ('closet', [-5.59, 0.8755, 2.4], False), ('porch', [-3.25, -10.1, 1.94], True)]:
            self.assertEqual(ns['group_of'](dict(id='decor-recessed-light', lights=[], spec={'p': p}, root=p, glows=[], exterior=exterior)), group)
            reached.add(group)
        self.assertEqual(reached | {'always'}, set(ns['ORDER']))
        self.assertEqual(len(ns['ORDER']), len(set(ns['ORDER'])))
        self.assertEqual((len(ns['ORDER']) + 2) // 3, 8)


if __name__ == '__main__': unittest.main()
