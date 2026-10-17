# Switchable baked lamps, step 1: group the house's lamps by the light switches that control them and give every switch a
# physical light in the bake, then save a bake scene whose lamps and lamp surfaces carry their group.
# usage: blender -b scene_lm.blend --python-exit-code 1 -P scripts/lamp_groups.py -- switches.json out.blend groups.json
#   switches.json: export/switch_groups.mjs (the site's switches: live lights, fixture light spec, glowing surfaces)
# Groups: one per room and default state (see GROUPS), plus "always" for lamp surfaces no switch controls. Every group is
# baked alone at unit level (bake.py / probe.py with {"layer": "lamps", "lampGroup": g}); lamp_groups_pack.py packs them.
# Lights per switch: the scene's existing lamp (setup.py energies) where the switch has one; otherwise the fixture's own
# light spec at the energy setup.py gives a live light of its kind (recessed can and bedside lamp 30 W point, track head
# a third of the 70 W track spot), or a lamp at the glowing surface for fixtures without a spec. setup.py's 0.17 for
# bake-only cans is undone (the runtime's per-group gain sets their level). Lamp surfaces (shades, lenses) stop casting
# shadows so a lamp inside its shade lights the room like a translucent shade would.
import bpy, sys, json, math, os
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan as planlib

SWITCHES, OUT, GROUPS_OUT = sys.argv[sys.argv.index('--') + 1:][:3]
sw = json.load(open(SWITCHES))['switches']
scene = bpy.context.scene

# The room part of a lamp group: the plan space at p (plan.py; a point in a wall takes the room it faces) gives its
# lampGroup, or its id when it has none yet (hall closet, closets, laundry: no light); 'outside' outdoors.
PLAN = planlib.load()
def room(p):
    s = PLAN.space_at(p[0], p[1], 0.3)
    if s is None or s['zone'] == 'exterior': return 'outside'
    return s.get('lampGroup') or s['id']

def where(s):
    if s['lights']: return s['lights'][0]['p']
    if s['spec']: return s['spec']['p']
    if s['glows']: return [sum(g['c'][k] for g in s['glows']) / len(s['glows']) for k in range(3)]
    return s['root']

# Lamp groups. Rooms seen from the living-room camera keep their switches that had light in the earlier bake ("lit": on
# by default) apart from those that had none (off by default), so the default state reproduces the earlier look there.
def group_of(s):
    r = room(where(s)); i = s['id']
    if s['exterior']: return 'porch'
    if i == 'niche-recessed-can': return 'livingNiche'
    if r == 'living': return 'livingCenter' if i == 'decor-track-light' and abs(s['root'][0] - 0.2) < 0.3 else 'living'
    if r == 'kitchen': return 'kitchenPendant' if i == 'kitchen-pendant' else 'kitchenCabinet' if 'kitchen-west-run' in i else 'kitchen'
    if r == 'primary': return 'primaryLamps' if 'props-rooms' in i else 'primary'
    if r in ('bedroomB', 'bedroom3') and (i == 'nightstandPine' or 'props-rooms' in i): return r + 'Lamps'
    return r
ORDER = ['living', 'livingCenter', 'livingNiche', 'kitchenPendant', 'kitchen', 'kitchenCabinet', 'dining', 'family', 'primary', 'primaryLamps', 'primaryBath',
         'closet', 'bedroomB', 'bedroomBLamps', 'bathB', 'hallBath', 'bedroom3', 'bedroom3Lamps', 'hall', 'garage', 'porch', 'always']

# ---- the existing lamps (setup.py: lamp{i} = lights.json[i]) by position
old = {o.name: o for o in scene.objects if o.type == 'LIGHT' and o.name.startswith('lamp')}
def old_at(p, tol=0.06):
    best = min(old.values(), key=lambda o: (Vector(o.location) - Vector(p)).length, default=None)
    return best if best and (Vector(best.location) - Vector(p)).length < tol else None

def blackbody(ld):
    ld.use_nodes = True
    bb = ld.node_tree.nodes.new('ShaderNodeBlackbody'); bb.inputs[0].default_value = 3000
    em = next(n for n in ld.node_tree.nodes if n.type == 'EMISSION'); ld.node_tree.links.new(bb.outputs[0], em.inputs['Color'])

made = []
def add_light(g, kind, p, energy, size=None, spot=None, rect=None, rot=None, src=None):
    k = sum(1 for m in made if m['g'] == g)
    name = f'lampgrp{ORDER.index(g):02d}_{k:02d}'
    if src is not None:   # keep the existing lamp as it is, renamed into its group
        ob = src; ob.name = name; ob.data.name = name; del old[[n for n, o in old.items() if o is src][0]]
    else:
        ld = bpy.data.lights.new(name, kind); ld.energy = energy
        if kind == 'SPOT': ld.spot_size = spot; ld.spot_blend = 0.85; ld.shadow_soft_size = 0.08
        elif kind == 'AREA': ld.shape = 'RECTANGLE'; ld.size, ld.size_y = rect
        else: ld.shadow_soft_size = size or 0.12
        blackbody(ld)
        ob = bpy.data.objects.new(name, ld); ob.location = p; scene.collection.objects.link(ob)
        if rot: ob.rotation_euler = rot
    made.append({'g': g, 'name': name, 'type': ob.data.type, 'p': [round(v, 3) for v in ob.location], 'energy': round(ob.data.energy, 3)})
    return ob.data.energy

members = {g: [] for g in ORDER}
for s in sw:
    g = group_of(s); energy = 0; spec = s['spec'] or {}
    lit = bool(s['lights']) or bool(spec.get('bake')) or (s['id'] == 'decor-track-light' and abs(s['root'][0] - 3.0) < 0.3 and abs(s['root'][1] + 2.35) < 0.6)
    if s['id'] == 'decor-track-light':
        # one spot per head, a third of setup.py's 70 W track spot (which sat at the middle head), straight down
        o = old_at(spec['p']) if spec else None
        if o is not None and o.data.type == 'SPOT':
            del old[o.name]; bpy.data.objects.remove(o, do_unlink=True)
        # just below the head's housing (at the head itself the housing swallowed ~90% of the light: Cycles, 2026-10-15)
        energy += add_light(g, 'SPOT', (s['root'][0], s['root'][1], spec.get('p', [0, 0, 2.38])[2] - 0.2), 70 / 3, spot=min(math.pi, 2 * (spec.get('angle') or 0.6)))
    elif s['lights']:
        for L in s['lights']:
            o = old_at(L['p'])
            if o is None: print('no bake lamp for', s['key'], L['p']); continue
            if o.data.type == 'POINT' and o.data.energy < 10: o.data.energy = 30   # setup.py's bake-only 0.17, undone
            energy += add_light(g, None, None, None, src=o)
    elif spec:
        o = old_at(spec['p'])
        if o is not None:
            if o.data.energy < 10: o.data.energy = 30
            energy += add_light(g, None, None, None, src=o)
        elif spec.get('type') == 'spot': energy += add_light(g, 'SPOT', spec['p'], 70, spot=min(math.pi, 2 * (spec.get('angle') or 0.6)))
        elif spec.get('type') == 'rect': energy += add_light(g, 'AREA', spec['p'], 35, rect=(spec.get('w') or 0.5, spec.get('h') or 0.5))
        else: energy += add_light(g, 'POINT', spec['p'], 30)
    else:
        c = [sum(gl['c'][k] for gl in s['glows']) / len(s['glows']) for k in range(3)]
        if 'kitchen-west-run' in s['id']: energy += add_light(g, 'SPOT', (c[0], c[1], c[2] - 0.03), 10, spot=2.0)   # range hood lamp
        elif 'garage' in s['id']: energy += add_light(g, 'POINT', c, 15)                                        # opener lamp
        else: energy += add_light(g, 'POINT', c, 30)                                                            # table / floor lamp
    members[g].append({'key': s['key'], 'id': s['id'], 'root': s['root'], 'name': s['name'], 'exterior': s['exterior'], 'lit': lit, 'energy': round(energy, 3)})
for name, o in old.items():   # existing lamps no switch controls (none expected): the always-on group
    print('unswitched lamp', name, tuple(o.location)); add_light('always', None, None, None, src=o)

# ---- lamp surfaces: every emitting object, by the nearest switch glow (bounding-box centres, plan = Blender world)
glows = [(Vector(gl['c']), group_of(s)) for s in sw for gl in s['glows']]
def emits(m):
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m and m.use_nodes else None
    return b is not None and b.inputs['Emission Strength'].default_value > 0
owner = {}
for ob in scene.objects:
    if ob.type != 'MESH' or not any(emits(sl.material) for sl in ob.material_slots): continue
    c = sum((ob.matrix_world @ Vector(v) for v in ob.bound_box), Vector()) / 8
    d, g = min(((c - p).length, g) for p, g in glows) if glows else (9, 'always')
    owner[ob] = g if d < 0.3 else 'always'
    if d < 0.3: ob.visible_shadow = False
# one material per group: duplicate a lamp material shared across groups
users = {}
for ob, g in owner.items():
    for sl in ob.material_slots:
        if emits(sl.material): users.setdefault(sl.material, set()).add(g)
for ob, g in owner.items():
    for sl in ob.material_slots:
        m = sl.material
        if not emits(m): continue
        if len(users[m]) > 1 and m.get('lamp_group', ORDER.index(g)) != ORDER.index(g):
            copy = m.copy(); copy['lamp_group'] = ORDER.index(g); sl.link = 'OBJECT'; sl.material = copy
        else: m['lamp_group'] = ORDER.index(g)
count = {g: sum(1 for v in owner.values() if v == g) for g in ORDER}
groups = []
for i, g in enumerate(ORDER):
    ms = members[g]; tot = sum(m['energy'] for m in ms) or 1
    for m in ms: m['w'] = round(m['energy'] / tot, 4)
    groups.append({'name': g, 'index': i, 'members': ms, 'always': g == 'always', 'exterior': any(m['exterior'] for m in ms),
                   'lights': [m for m in made if m['g'] == g], 'surfaces': count[g]})
    print(f'{i:2d} {g:15s} switches {len(ms):2d} lights {len(groups[-1]["lights"]):2d} ({sum(m["energy"] for m in made if m["g"] == g):6.1f} W) surfaces {count[g]:3d} lit {[m["lit"] for m in ms]}')
json.dump({'version': 1, 'lampK': 3000, 'groups': groups}, open(GROUPS_OUT, 'w'), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('saved', OUT, GROUPS_OUT)
