"""Group routing without importing Blender or starting a bake: lamp_groups.py takes every switch's lamp group and the group
order from the site's switch records (bake/export/switch_groups.mjs, the lighting manifest). The records are the headless
scene's, as web/tools/golden/objects.json (bakeSwitches) and spatial.json (order, from this script's order_of) hold them."""
import ast
import json
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bake/scripts'))
tree = ast.parse((ROOT / 'bake/scripts/lamp_groups.py').read_text())
keep = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('group_of', 'order_of')]
ns = {}
exec(compile(ast.Module(body=keep, type_ignores=[]), '<group routing>', 'exec'), ns)
GOLDEN = ROOT / 'web/tools/golden'


class LampGroups(unittest.TestCase):
    def setUp(self):
        self.switches = list(json.loads((GOLDEN / 'objects.json').read_text())['bakeSwitches'].values())
        self.order = json.loads((GOLDEN / 'spatial.json').read_text())['order']

    def test_records_carry_their_group(self):
        doc = dict(switches=self.switches, groups=self.order)
        order = ns['order_of'](doc)
        self.assertEqual(order, self.order)
        self.assertEqual(order[-1], 'always')
        self.assertEqual(len(order), len(set(order)))
        used = {ns['group_of'](s) for s in self.switches}
        self.assertEqual(used | {'always'}, set(order))
        for s in self.switches:
            self.assertEqual(s['exterior'], ns['group_of'](s) == 'porch', s['key'])
        for g in ('bathB', 'hallBath', 'closet', 'livingNiche', 'kitchenCabinet', 'bedroomBLamps', 'bedroom3Lamps'):
            self.assertIn(g, order)

    def test_records_without_groups_are_refused(self):
        with self.assertRaises(SystemExit):
            ns['order_of'](dict(switches=[{k: v for k, v in s.items() if k != 'group'} for s in self.switches]))
        with self.assertRaises(SystemExit):
            ns['order_of'](dict(switches=self.switches))


if __name__ == '__main__': unittest.main()
