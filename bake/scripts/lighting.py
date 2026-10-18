"""The lighting manifest for the bake: how every mesh and material is lit, as web/src/lighting_roles.js resolves it and
the GLB export writes it (glTF extras "lighting", a JSON string; Blender's glTF importer keeps it as the custom property
"lighting" of the object or material). unwrap.py, setup.py, foliage_bake.py, reflprobe.py and layer_lights.py read these
records instead of deciding from names, ids or coordinates. Stdlib only (Blender's Python and python3).

Records (the same keys as lighting_roles.js MESH_KEYS / MATERIAL_KEYS):
  mesh:     role, motion, bake, why, probeSide, sun {cast, track}, weather, zone, space, puddleMirror, fakeShadow
  material: surface, alphaCutout, twoSided, foliage, wet, weather, glass, sheer, emits, reflection, clearcoat, castsSun,
            bake, contact, zone
web/tools/test_lighting_roundtrip.mjs exports the real scene's records through the glTF exporter and checks this reader
gives back the same records and the same answers to the predicates below (run: python3 lighting.py --check file.json).
"""
import json, sys

MESH_KEYS = ('role', 'motion', 'bake', 'why', 'probeSide', 'sun', 'weather', 'zone', 'space', 'puddleMirror', 'fakeShadow')
MATERIAL_KEYS = ('surface', 'alphaCutout', 'twoSided', 'foliage', 'wet', 'weather', 'glass', 'sheer', 'emits', 'reflection',
                 'clearcoat', 'castsSun', 'bake', 'contact', 'zone')
ROLES = ('architecture', 'furniture', 'plant', 'ground', 'glass', 'cloth', 'mirror', 'emitter', 'fixture', 'door', 'movable', 'pet', 'visitor', 'presentation')
SURFACES = ('opaque', 'foliage', 'leafCard', 'glass', 'sheer', 'mirror', 'lamp', 'screen', 'indicator', 'fire', 'presentation')
EMIT_KINDS = ('lamp', 'screen', 'indicator', 'fire')
MOTIONS = ('static', 'still', 'moving', 'movable', 'door')
BAKES = ('lightmap', 'probe', 'none')


class ManifestError(Exception):
    pass


def _plain(v):
    """Blender ID property groups / arrays to plain dicts and lists."""
    if hasattr(v, 'to_dict'): return v.to_dict()
    if hasattr(v, 'to_list'): return v.to_list()
    return v


def parse(value):
    """A record from the extras value: the JSON string the export writes (or an already decoded dict)."""
    value = _plain(value)
    if value is None: return None
    if isinstance(value, (bytes, str)): return json.loads(value)
    if isinstance(value, dict): return dict(value)
    raise ManifestError(f'lighting record of unexpected type {type(value).__name__}')


def _get(holder, key):
    if holder is None: return None
    if isinstance(holder, dict): return holder.get(key)
    getter = getattr(holder, 'get', None)   # bpy ID (object, material) custom properties
    if getter is not None:
        try: return getter(key)
        except TypeError: pass
    extras = getattr(holder, 'extras', None)   # pygltflib Node / Material
    return extras.get(key) if isinstance(extras, dict) else None


def _record(holder, keys, kind, required):
    rec = parse(_get(holder, 'lighting'))
    if rec is None:
        if required: raise ManifestError(f'{kind} without a lighting record: export the scene again (bake/export/export.mjs)')
        return None
    missing = [k for k in keys if k not in rec]
    if missing: raise ManifestError(f'{kind} lighting record without {missing}')
    return {k: rec[k] for k in keys}


def mesh(holder, required=True):
    """The mesh record of a glTF node (extras dict, pygltflib node) or a Blender object."""
    r = _record(holder, MESH_KEYS, 'mesh', required)
    if r is not None:
        if r['role'] not in ROLES: raise ManifestError(f"unknown role {r['role']}")
        if r['motion'] not in MOTIONS: raise ManifestError(f"unknown motion {r['motion']}")
        if r['bake'] not in BAKES: raise ManifestError(f"unknown bake {r['bake']}")
    return r


def material(holder, required=True):
    """The material record of a glTF material (extras dict, pygltflib material) or a Blender material."""
    r = _record(holder, MATERIAL_KEYS, 'material', required)
    if r is not None:
        if r['surface'] not in SURFACES: raise ManifestError(f"unknown surface {r['surface']}")
        if r['emits'] and r['emits'].get('kind') not in EMIT_KINDS: raise ManifestError(f"unknown emitter {r['emits']}")
    return r


def canonical(rec):
    """The record as one canonical JSON string (sorted keys), for comparing the JS and Python sides."""
    return json.dumps(rec, sort_keys=True, separators=(',', ':'))


# ---- the predicates the bake scripts share (the same questions the site asks of the records) --------------------------------
def unit_skip(mesh_rec, material_recs):
    """Why a unit gets no lightmap (unwrap.py), or None: the mesh's reason, or plant/glass when every material says probe."""
    if mesh_rec['why'] and mesh_rec['why'] not in ('hidden',): return mesh_rec['why']
    if material_recs and all(m['bake'] == 'probe' for m in material_recs): return 'plant/glass'
    return None


def clear_glass(m): return bool(m['glass']) and m['glass'].get('export') == 'pane'   # window glass: clear, transmissive in Cycles
def sheer(m): return m['sheer']                                                      # { reflect, transmit } or None
def see_through(m): return m['surface'] == 'glass' or m['sheer'] is not None or m['alphaCutout']   # reflection-probe rays pass it
def emitter(m): return (m['emits'] or {}).get('kind')                                 # lamp / screen / indicator / fire, or None
def lamp_surface(m): return bool(m['emits']) and (m['emits'].get('kind') == 'lamp' or bool(m['emits'].get('switched')))
def baked_foliage(m): return bool(m['foliage']) and bool(m['foliage'].get('bakedPerVertex'))
def movable(mesh_rec): return mesh_rec['motion'] == 'movable'


PREDICATES = {
    'material': {'clearGlass': clear_glass, 'sheer': lambda m: sheer(m) is not None, 'seeThrough': see_through, 'emitter': emitter,
                 'lampSurface': lamp_surface, 'bakedFoliage': baked_foliage},
    'mesh': {'movable': movable, 'weather': lambda r: r['weather'], 'lightmap': lambda r: r['bake'] == 'lightmap'},
}


def check(path):
    """Round trip: the file web/tools/test_lighting_roundtrip.mjs writes (the glTF the exporter made, and the JS side's
    canonical records and predicate answers). Prints the mismatches; returns their number."""
    doc = json.load(open(path))
    bad = []
    if set(doc['schema']['meshKeys']) != set(MESH_KEYS) or set(doc['schema']['materialKeys']) != set(MATERIAL_KEYS): bad.append('record keys differ')
    for name, mine in (('roles', ROLES), ('surfaces', SURFACES), ('emitKinds', EMIT_KINDS), ('motions', MOTIONS), ('bakes', BAKES)):
        if list(doc['schema'][name]) != list(mine): bad.append(f'{name} differ: {doc["schema"][name]} vs {list(mine)}')
    gltf = doc['gltf']
    for kind, items, read in (('mesh', gltf.get('nodes', []), mesh), ('material', gltf.get('materials', []), material)):
        expect = doc['expect'][kind]
        got = [x for x in items if (x.get('extras') or {}).get('lighting') is not None]
        if len(got) != len(expect): bad.append(f'{kind}: {len(got)} records in the glTF, {len(expect)} expected')
        for x, e in zip(got, expect):
            r = read(x.get('extras'))
            if canonical(r) != e['record']: bad.append(f'{kind} {x.get("name")}: record {canonical(r)} != {e["record"]}')
            for p, fn in PREDICATES[kind].items():
                if fn(r) != e['answers'][p]: bad.append(f'{kind} {x.get("name")}: {p} {fn(r)!r} != {e["answers"][p]!r}')
    for b in bad[:20]: print(b)
    print(f'lighting.py round trip: {len(bad)} mismatches')
    return len(bad)


if __name__ == '__main__':
    if '--check' in sys.argv: sys.exit(1 if check(sys.argv[sys.argv.index('--check') + 1]) else 0)
