"""lighting.py, the bake's reader of the lighting manifest, without Blender: records from the extras string, from a decoded
dict and from a Blender-like ID (custom property access), the refusal of exports without records, and unit_skip."""
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lighting as L

MESH = dict(role='furniture', motion='static', bake='lightmap', why=None, probeSide='none', sun=dict(cast=True, track='static'),
            weather=None, zone='interior', space='kitchen', puddleMirror=True, fakeShadow=False)
MAT = dict(surface='opaque', alphaCutout=False, twoSided=False, foliage=None, wet='auto', weather='auto', glass=None, sheer=None,
           emits=None, reflection='probe', clearcoat=None, castsSun=True, bake='lightmap', contact=True, zone=None)


class ID(dict):   # a Blender ID: custom properties by .get
    pass


class Reader(unittest.TestCase):
    def test_sources(self):
        for holder in ({'lighting': json.dumps(MESH)}, {'lighting': dict(MESH)}, ID(lighting=json.dumps(MESH))):
            self.assertEqual(L.mesh(holder), MESH)
        self.assertEqual(L.material({'lighting': json.dumps(MAT)}), MAT)

    def test_refusals(self):
        with self.assertRaises(L.ManifestError): L.mesh({})
        self.assertIsNone(L.mesh({}, required=False))
        with self.assertRaises(L.ManifestError): L.mesh({'lighting': json.dumps({k: v for k, v in MESH.items() if k != 'bake'})})
        with self.assertRaises(L.ManifestError): L.material({'lighting': json.dumps(dict(MAT, surface='chrome'))})

    def test_unit_skip(self):
        glass = dict(MAT, surface='glass', bake='probe', glass=dict(overlay=True, export='pane'), castsSun=False)
        self.assertIsNone(L.unit_skip(MESH, [MAT]))
        self.assertEqual(L.unit_skip(MESH, [glass]), 'plant/glass')
        self.assertIsNone(L.unit_skip(MESH, [glass, MAT]))
        self.assertEqual(L.unit_skip(dict(MESH, why='movable', motion='movable', bake='probe'), [MAT]), 'movable')
        self.assertTrue(L.clear_glass(glass)); self.assertTrue(L.see_through(glass)); self.assertFalse(L.see_through(MAT))


if __name__ == '__main__': unittest.main()
