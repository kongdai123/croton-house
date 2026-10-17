# Reflection probes: 360-degree panoramas at points through the house and garden, laid out in three's equirect convention
# (centre east, right south, top up), each with a box for parallax correction (reflprobe_layout.py: rooms from the plan,
# the garage and grounds from scene raycasts through glass and cloth).
#   day (default): one slot's daylight only (sky, sun, its bounces); no lamp, no lamp surface glows. Per slot.
#     blender -b scene.blend -P scripts/reflprobe.py -- '<slot json>' out_dir [i0 i1] --plan scripts/plan.json --layout refl_layout.json
#   lamps: the house's lamps by switch group, at the bake's physical level (lamp_groups.py scene: lights lampgrpNN_*,
#     lamp surfaces tagged lamp_group = NN), once for every slot. Per probe each group is measured with a quick render;
#     the brightest groups get a panorama of their own (up to --max-layers), the other visible groups share one, and the
#     site weighs every panorama by its groups' live switch levels (lightmap.js reflProbe, lamp_groups_pack.py refl).
#     One more panorama holds all of them, for small devices (one layer per probe, weighed by its groups' light shares).
#     blender -b lampgroups.blend -P scripts/reflprobe.py -- '{"slot": "dusk"}' out_dir [i0 i1] --lamps groups.json \
#       --plan scripts/plan.json --layout refl_layout.json [--max-layers 3]
#   --with-lamps: the old single-layer probes (every lamp at the slot's lamp level), for sites without lamp groups.
# --layout: points and boxes are computed once (by the first task to run, from the scene it renders) and every slot and
# lamp task reuses them, so the slots' boxes agree exactly (lightmap_slots.js refuses slots whose boxes differ).
import bpy, sys, json, math, os, time
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slots import resolve
from layer_lights import configure_world
import reflprobe_layout as L

argv = sys.argv[sys.argv.index('--') + 1:]
def option(flag, default=None, has_value=True):
    if flag not in argv: return default
    i = argv.index(flag)
    if not has_value: del argv[i]; return True
    v = argv[i + 1]; del argv[i:i + 2]; return v
PLAN = option('--plan'); LAYOUT = option('--layout'); LAMPS = option('--lamps')
MAXL = int(option('--max-layers', '3')); WITH_LAMPS = option('--with-lamps', False, False)
SIZE = [int(v) for v in option('--size', '512x256').split('x')]; SPP = int(option('--samples', '512'))
cfg = resolve(json.loads(argv[0])); out = argv[1]; os.makedirs(out, exist_ok=True)
scene = bpy.context.scene; c = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
c.device = 'GPU'
plan = L.load_plan(PLAN)
bpy.data.objects['mist'].hide_render = True; bpy.data.objects['mist'].hide_viewport = True
dg = bpy.context.evaluated_depsgraph_get()

# ---- layout: points and boxes
def see_through(obj, index):
    """Surfaces a reflection box should not stop at: glass, cloth (sheers, shades), alpha-blended or cut-out surfaces,
    the mist volume, anything hidden from the render."""
    if obj is None: return False
    if obj.name == 'mist' or obj.hide_render: return True
    if obj.type != 'MESH' or not obj.material_slots: return False
    try: mi = obj.data.polygons[index].material_index
    except (IndexError, AttributeError): mi = 0
    m = obj.material_slots[min(mi, len(obj.material_slots) - 1)].material
    if m is None: return False
    if 'sheer' in m.keys(): return True
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
    return b is not None and (b.inputs['Transmission Weight'].default_value > 0.5 or b.inputs['Alpha'].is_linked or b.inputs['Alpha'].default_value < 0.99)

def ray(p, d, limit=L.MAX_RAY):
    """Distance to the first surface along d that is not see-through, and whether that surface was hit from behind."""
    o = Vector(p); d = Vector(d).normalized(); travelled = 0.0
    for _ in range(64):
        hit, loc, nrm, index, obj, _m = scene.ray_cast(dg, o, d, distance=limit - travelled)
        if not hit: return limit, False
        travelled += (loc - o).length
        if not see_through(obj, index): return travelled, nrm.dot(d) > 0
        o = loc + d * 1e-4; travelled += 1e-4
    return limit, False

def scene_clearance(p):
    dists, back = [], 0
    for k in range(8):
        a = k * math.pi / 4; t, b = ray(p, (math.cos(a), math.sin(a), 0), 3.0); dists.append(t); back += b
    for d in ((0, 0, 1), (0, 0, -1)): back += ray(p, d, 3.0)[1]
    return min(dists), back

def scene_point(p, need=0.4):
    """Outside the plan: keep the point if it is clear of the scene's surfaces, else the nearest clear spot."""
    t, back = scene_clearance(p)
    if t >= need and back < 2: return p
    for r in range(1, 21):
        best = None
        for i in range(-r, r + 1):
            for j in range(-r, r + 1):
                if max(abs(i), abs(j)) != r: continue
                q = (round(p[0] + 0.1 * i, 3), round(p[1] + 0.1 * j, 3), p[2]); t, back = scene_clearance(q)
                if t >= need and back < 2 and (best is None or math.hypot(i, j) < best[0]): best = (math.hypot(i, j), q)
        if best:
            print(f'reflection probe {p} is inside or against scene geometry: moved to {best[1]}', flush=True); return best[1]
    raise SystemExit(f'reflection probe {p}: no clear spot within 2 m')

def scene_extents(p):
    """As reflprobe_layout.plan_extents, against the scene: per side a fan of parallel rays (sideways offsets and two
    more heights), the QUANTILE-th distance; one ray up and down."""
    out = []
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        side = Vector((-dy, dx, 0)); ds = []
        for o in (-0.5, -0.25, 0.0, 0.25, 0.5):
            if o and ray(p, side * (1 if o > 0 else -1), abs(o) + 0.05)[0] < abs(o) + 0.05: continue   # offset start behind a wall
            ds.append(ray(Vector(p) + side * o, (dx, dy, 0))[0])
        for h in (0.6, 2.0):
            ds.append(ray((p[0], p[1], h), (dx, dy, 0))[0])
        ds.sort(); out.append(ds[min(len(ds) - 1, int(round(L.QUANTILE * (len(ds) - 1))))])
    out.append(ray(p, (0, 0, 1))[0]); out.append(ray(p, (0, 0, -1))[0])
    return [round(v, 3) for v in out]

def make_layout():
    rows = []
    for i, p in enumerate(L.points(plan)):
        if not L.in_plan(plan, p[0], p[1]) and not L.annex_of(plan, p[0], p[1]): p = scene_point(p)
        b = L.plan_box(plan, p) or L.box(p, scene_extents(p))
        rows.append(dict(i=i, b=list(p), **b, where=L.room_of(plan, p[0], p[1])))
    return rows

if LAYOUT and os.path.exists(LAYOUT): layout = json.load(open(LAYOUT)); print('layout from', LAYOUT, len(layout), 'probes')
else:
    layout = make_layout()
    if LAYOUT:
        tmp = f'{LAYOUT}.{os.getpid()}'; json.dump(layout, open(tmp, 'w'), indent=1); os.replace(tmp, LAYOUT); print('layout written to', LAYOUT)
for r in layout: print('layout', r['i'], r['b'], r['where'], 'min', [round(v, 2) for v in r['min']], 'max', [round(v, 2) for v in r['max']], flush=True)

# ---- lighting
configure_world(scene, cfg)
s = cfg['sun']; az, el = math.radians(s['az']), math.radians(s['el'])
sun = bpy.data.objects['sun']; sun.rotation_euler = (math.radians(90) - el, 0, math.radians(180) - az)
sun.data.energy = s['strength']; sun.data.color = tuple(s['color']); sun.hide_render = s['strength'] <= 0
nt = scene.world.node_tree; sky = nt.nodes['Nishita']; sky.sun_elevation = el; sky.sun_rotation = (-az) % (2 * math.pi); sky.dust_density = cfg.get('dust', 0.8)
nt.nodes['sundot'].inputs[1].default_value = (math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))
lo, hi = cfg.get('clouds', [0.5, 0.68]); cr = nt.nodes['cloud_cover'].color_ramp; cr.elements[0].position = lo; cr.elements[1].position = hi
nt.nodes['skybg'].inputs['Strength'].default_value = cfg.get('sky', 0.45)
lamps = [o for o in scene.objects if o.type == 'LIGHT' and o.name.startswith('lamp')]
def bsdf(m): return next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m and m.use_nodes else None
emissive = [(m, b, b.inputs['Emission Strength'].default_value) for m in bpy.data.materials for b in [bsdf(m)] if b and b.inputs['Emission Strength'].default_value > 0]
def lamp_surface(m): return 'lamp_group' in m.keys() or 'lightGlow' in m.keys() or m.get('emits') == 'lamp'
for o in lamps:
    bb = next((n for n in o.data.node_tree.nodes if n.type == 'BLACKBODY'), None) if o.data.node_tree else None
    if bb: bb.inputs[0].default_value = cfg.get('lampK', 3000)
if LAMPS:
    # lamps alone: no sky, no sun; each group at the bake's level
    nt.nodes['skybg'].inputs['Strength'].default_value = 0.0; sun.hide_render = True
    groups = json.load(open(LAMPS))['groups']
    if not any(o.name.startswith('lampgrp') for o in lamps): raise SystemExit('--lamps needs the lamp-group scene (scripts/lamp_groups.py)')
    def light_on(gs):
        for o in lamps: o.hide_render = not (o.name.startswith('lampgrp') and int(o.name[7:9]) in gs)
        for m, b, e in emissive: b.inputs['Emission Strength'].default_value = e if m.get('lamp_group') in gs else 0.0
elif WITH_LAMPS:
    level = cfg.get('lamps', 0.25)
    for o in lamps: o.hide_render = False; o.data.energy *= level
    for m, b, e in emissive: b.inputs['Emission Strength'].default_value = e * level
else:
    for o in lamps: o.hide_render = True
    for m, b, e in emissive:
        if lamp_surface(m): b.inputs['Emission Strength'].default_value = 0.0

cam = scene.camera; cam.data.type = 'PANO'
try: cam.data.panorama_type = 'EQUIRECTANGULAR'
except AttributeError: cam.data.cycles.panorama_type = 'EQUIRECTANGULAR'
cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2); cam.data.dof.use_dof = False
scene.use_nodes = False; scene.render.use_persistent_data = True
scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'; scene.view_settings.exposure = 0
def settings(w, h, spp, denoise, fmt):
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = w, h, 100
    c.samples = spp; c.use_denoising = denoise; scene.render.image_settings.file_format = fmt
    if fmt == 'OPEN_EXR': scene.render.image_settings.color_depth = '32'
def render(path):
    scene.render.filepath = path; bpy.ops.render.render(write_still=True)
TMP = os.path.join(os.environ.get('TMPDIR', '/tmp'), f'croton_refl_{os.getpid()}.exr')
def measure():
    """Mean luminance over the sphere of a quick 64x32 panorama (solid-angle weighted)."""
    settings(64, 32, 32, False, 'OPEN_EXR'); render(TMP)
    img = bpy.data.images.load(TMP, check_existing=False); w, h = img.size; ch = img.channels
    px = np.empty(w * h * ch, np.float32); img.pixels.foreach_get(px); bpy.data.images.remove(img); px = px.reshape(h, w, ch)[..., :3]
    lat = (np.arange(h) + 0.5) / h * math.pi - math.pi / 2; wgt = np.cos(lat)[:, None]
    return float(((px @ np.array([0.2126, 0.7152, 0.0722], np.float32)) * wgt).sum() / (wgt.sum() * w))

i0, i1 = (int(argv[2]), int(argv[3])) if len(argv) > 3 else (0, len(layout))
meta = []; t0 = time.time()
for r in layout[i0:min(i1, len(layout))]:
    i = r['i']; cam.location = Vector(r['b'])
    entry = {k: r[k] for k in ('i', 'p', 'min', 'max')}
    if not LAMPS:
        settings(SIZE[0], SIZE[1], SPP, True, 'HDR'); render(os.path.join(out, f'probe_{i:02d}.hdr'))
        meta.append(entry); print('probe', i, r['b'], f'{time.time() - t0:.0f} s', flush=True); continue
    # lamps: measure every group alone, then panoramas for the brightest groups and one for the rest
    energy = {}
    for g in groups:
        light_on({g['index']}); energy[g['index']] = measure()
    total = sum(energy.values()) or 1.0
    order = sorted(((e, gi) for gi, e in energy.items() if e > 0), reverse=True)
    own = [gi for e, gi in order if e >= 0.05 * total][:MAXL]
    rest = [gi for e, gi in order if gi not in own and e >= 0.002 * total]
    layers = [[gi] for gi in own] + ([rest] if rest else [])
    names = {g['index']: g['name'] for g in groups}
    entry['energy'] = {names[gi]: round(e, 6) for gi, e in sorted(energy.items()) if e > 0}; entry['layers'] = []
    for k, gs in enumerate(layers):
        light_on(set(gs)); settings(SIZE[0], SIZE[1], SPP, True, 'HDR'); f = f'lamp_{i:02d}_{k}.hdr'; render(os.path.join(out, f))
        e = sum(energy[g] for g in gs) or 1.0
        entry['layers'].append({'file': f, 'groups': {names[g]: round(energy[g] / e, 5) for g in gs}, 'energy': round(e, 6)})
    # every kept group in one panorama too, for small devices (one layer per probe; lightmap.js picks by tier)
    gs = [g for layer in layers for g in layer]
    if len(layers) > 1:
        light_on(set(gs)); settings(SIZE[0], SIZE[1], SPP, True, 'HDR'); f = f'lamp_{i:02d}_all.hdr'; render(os.path.join(out, f))
    elif layers: f = entry['layers'][0]['file']
    if layers:
        e = sum(energy[g] for g in gs) or 1.0
        entry['merged'] = {'file': f, 'groups': {names[g]: round(energy[g] / e, 5) for g in gs}, 'energy': round(e, 6)}
    meta.append(entry)
    print('probe', i, r['b'], 'lamp layers', [list(l['groups']) for l in entry['layers']],
          'dropped', [names[g] for e, g in order if g not in own and g not in rest], f'{time.time() - t0:.0f} s', flush=True)
json.dump(meta, open(os.path.join(out, f'{"lamps" if LAMPS else "meta"}_{i0:02d}.json'), 'w'))
if os.path.exists(TMP): os.remove(TMP)
