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


class BakeSceneReaders(unittest.TestCase):
    def test_blender_side_lookups_tolerate_bake_made_materials(self):
        """The scripts that walk a Blender bake scene meet materials and objects setup.py made itself (the mist volume,
        helpers): no manifest record. Every material() / mesh() lookup there passes required=False (foliage_bake.py's did
        not, and all four foliage tasks of the final rebake stopped with a ManifestError)."""
        import ast, os
        here = os.path.dirname(os.path.abspath(__file__)); bad = []
        for f in ('foliage_bake.py', 'reflprobe.py', 'layer_lights.py', 'bake.py', 'probe.py', 'lamp_groups.py', 'skypano.py'):
            tree = ast.parse(open(os.path.join(here, f)).read())
            for n in ast.walk(tree):
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ('material', 'mesh') \
                        and isinstance(n.func.value, ast.Name) and n.func.value.id in ('lighting', 'manifest'):
                    a = n.args[0] if n.args else None   # g.materials[i] / g.nodes[i]: the exported glTF, where every record exists
                    gltf = isinstance(a, ast.Subscript) and isinstance(a.value, ast.Attribute) and isinstance(a.value.value, ast.Name) and a.value.value.id == 'g'
                    if not gltf and not any(k.arg == 'required' and isinstance(k.value, ast.Constant) and k.value.value is False for k in n.keywords):
                        bad.append(f'{f}:{n.lineno}')
        self.assertFalse(bad, f'manifest lookups on a Blender scene without required=False: {bad}')


if __name__ == '__main__': unittest.main()
