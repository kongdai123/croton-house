# Switchable baked lamps, step 1: the bake scene of the lamp groups and their list. Every light switch of the site is ONE
# physical light of its fixture's declared output (scripts/fixture_lights.py: the same lights setup.py puts in every scene,
# so the Cycles references and every bake see one light set), named lampgrpNN_KK after its lamp group; its lamp surfaces
# carry the group (material property lamp_group). Rebuilt here from the records, so a scene made before the records changed
# still bakes the current lights.
# usage: blender -b scene_lm.blend --python-exit-code 1 -P scripts/lamp_groups.py -- switches.json out.blend groups.json
#   switches.json: export/switch_groups.mjs (the site's switches: lamp group, fixture kind, default slots, photometric
#   output, live lights, fixture light spec, glowing surfaces; and the group order)
# Groups: the switches' (one per room circuit), plus "always" for lamp surfaces no switch controls. Every group is baked
# alone at its physical level (bake.py / probe.py with {"layer": "lamps", "lampGroup": g}); lamp_groups_pack.py packs them.
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixture_lights import order_of, LM_PER_W   # noqa: F401  (order_of: test_lamp_groups.py)


def group_of(s): return s['group']


if __name__ == '__main__':
    import bpy
    import fixture_lights
    SWITCHES, OUT, GROUPS_OUT = sys.argv[sys.argv.index('--') + 1:][:3]
    doc = json.load(open(SWITCHES))
    sw, ORDER = doc['switches'], order_of(doc)
    scene = bpy.context.scene
    order, made = fixture_lights.build(scene, doc)
    count = {}
    for m in bpy.data.materials:
        if 'lamp_group' in m.keys(): count[m['lamp_group']] = count.get(m['lamp_group'], 0) + sum(1 for o in scene.objects if o.type == 'MESH' and any(sl.material == m for sl in o.material_slots))
    groups = []
    for i, g in enumerate(fixture_lights.groups_of(doc, made)):
        name = g['name']; mine = [m for m in made if m['g'] == i]
        members = []
        for s in sw:
            if group_of(s) != name: continue
            e = sum(m['energy'] for m in mine if m['key'] == s['key']); glow = next((m['luminance'] for m in mine if m['key'] == s['key']), None)
            # luminance: its lamp surfaces' glow (fixture_lights.py surfaces), the strength the site draws them at when on
            members.append({'key': s['key'], 'id': s['id'], 'root': s['root'], 'name': s['name'], 'exterior': s['exterior'], 'space': s.get('space'),
                            'lm': s['output']['lm'], 'emitter': s['output']['emitter'], 'lit': True, 'energy': round(e, 6),
                            **({'luminance': round(glow, 6)} if glow is not None else {})})
        tot = sum(m['energy'] for m in members) or 1
        for m in members: m['w'] = round(m['energy'] / tot, 4)
        groups.append(dict(g, members=members, lights=[{k: m[k] for k in ('g', 'name', 'type', 'p', 'energy', 'lm', 'emitter')} for m in mine],
                           surfaces=count.get(i, 0)))
        print(f'{i:2d} {name:18s} switches {len(members):2d} lights {len(mine):2d} {g["lm"]:7.0f} lm ({sum(m["energy"] for m in mine):8.4f} W) '
              f'surfaces {count.get(i, 0):3d} default {g["defaultOn"]}')
    json.dump({'version': 2, 'lampK': fixture_lights.LAMP_K, 'lmPerW': LM_PER_W, 'groups': groups}, open(GROUPS_OUT, 'w'), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print('saved', OUT, GROUPS_OUT)
