# Check fixture_lights.py's emitter models in Cycles: each model, at 1000 lm, 2 m above a 40 x 40 m white floor; the floor's
# DIFFUSE bake (direct light, no colour: E / pi, as bake.py) integrated over its area is the flux that reached it, against
# the flux the model should put there (its intensity distribution integrated over the same square, numerically).
# A ratio of 1 means Cycles emits what fixture_lights.watts() assumes. Prints one line per model; exits 1 if any is off by
# more than 3%.
# usage: blender -b --python-exit-code 1 --factory-startup -P scripts/fixture_calibrate.py
import bpy, sys, os, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixture_lights as fl

H, HALF, RES, LM = 2.0, 20.0, 512, 1000.0
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene; scene.render.engine = 'CYCLES'; c = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
    for d in prefs.devices: d.use = d.type == 'OPTIX'
    c.device = 'GPU'
except Exception as e: print('CPU:', e)
scene.world = bpy.data.worlds.new('black'); scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
bpy.ops.mesh.primitive_plane_add(size=2 * HALF, location=(0, 0, 0)); floor = bpy.context.active_object
mat = bpy.data.materials.new('white'); mat.use_nodes = True
b = mat.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (1, 1, 1, 1); b.inputs['Roughness'].default_value = 1
floor.data.materials.append(mat)
img = bpy.data.images.new('e', RES, RES, float_buffer=True); img.colorspace_settings.name = 'Non-Color'
n = mat.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img; mat.node_tree.nodes.active = n
c.samples = 256; c.use_denoising = False; c.use_adaptive_sampling = False; c.max_bounces = 0


def expected(e):
    """Flux on the floor square from the model's intensity distribution (W of the model's power units, x LM_PER_W = lm)."""
    xs = (np.arange(400) + 0.5) / 400 * 2 * HALF - HALF; X, Y = np.meshgrid(xs, xs); dA = (2 * HALF / 400) ** 2
    r2 = X * X + Y * Y + H * H; cos = H / np.sqrt(r2)
    P = e['energy']
    if e['emitter'] == 'omni': I = P / (4 * math.pi) * np.ones_like(cos)
    elif e['emitter'] == 'linear': I = P / math.pi * cos   # Lambertian, the rectangle small against 2 m
    else:
        half = e['spot_size'] / 2; cc = math.cos(half); u = np.clip((cos - cc) / ((1 - cc) * e['blend']), 0, 1)
        I = P / (4 * math.pi) * u * u * (3 - 2 * u)
    return float((I * cos / r2 * dA).sum())


def measure(e):
    for o in [o for o in scene.objects if o.type == 'LIGHT']: bpy.data.objects.remove(o, do_unlink=True)
    kind = {'omni': 'POINT', 'linear': 'AREA', 'downlight': 'SPOT', 'spot': 'SPOT'}[e['emitter']]
    ld = bpy.data.lights.new('L', kind); ld.energy = e['energy']
    if kind == 'AREA': ld.shape = 'RECTANGLE'; ld.size, ld.size_y = 0.6, 0.06
    else: ld.shadow_soft_size = 0.02
    if kind == 'SPOT': ld.spot_size = e['spot_size']; ld.spot_blend = e['blend']
    ob = bpy.data.objects.new('L', ld); ob.location = (0, 0, H); scene.collection.objects.link(ob)
    for o in scene.objects: o.select_set(o is floor)
    bpy.context.view_layer.objects.active = floor
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT'}, margin=0, use_clear=True, target='IMAGE_TEXTURES')
    px = np.empty(RES * RES * 4, np.float32); img.pixels.foreach_get(px); v = px.reshape(-1, 4)[:, :3] @ np.array([0.2126, 0.7152, 0.0722])
    return float(v.sum() * math.pi * (2 * HALF / RES) ** 2)


bad = 0
for name, out in [('omni', {'lm': LM, 'emitter': 'omni'}), ('linear', {'lm': LM, 'emitter': 'linear'}),
                  ('downlight 105', {'lm': LM, 'emitter': 'downlight', 'beam': 105}), ('spot 40', {'lm': LM, 'emitter': 'spot', 'beam': 40})]:
    e = {'emitter': out['emitter'], 'energy': fl.watts(out)}
    if out['emitter'] in ('downlight', 'spot'): e['spot_size'], e['blend'], _ = fl.cone(out['beam'])
    got, want = measure(e), expected(e)
    r = got / want; bad += abs(r - 1) > 0.03
    print(f'CALIBRATE {name:14s} power {e["energy"]:.5f} W  floor flux {got * fl.LM_PER_W:8.1f} lm  model {want * fl.LM_PER_W:8.1f} lm  ratio {r:.4f}', flush=True)
sys.exit(1 if bad else 0)
