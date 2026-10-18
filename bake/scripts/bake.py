# Bake one lightmap layer for one group of objects into a full-size atlas (charts of other groups stay empty).
# usage: blender -b scene/scene_lm.blend -P scripts/bake.py -- '<json>'
#   {"layer": "sky"|"sunind"|"lamps", "group": g, "groups": G, "out": path.exr, "samples": n, "size": 4096,
#    "sun": {"az", "el", "strength", "color"}, "sky": strength, "dust": d, "clouds": [lo, hi], "lampK": k,
#    "only": [lightmap ids] (optional: a targeted test of those units alone, "group"/"groups" then ignored)}
# Layers (summed at run time): sky = sky light direct + all its bounces; sunind = only the sun's bounces (its direct
# light is drawn live); lamps = the house's lamps, direct + bounces, at unit level. Bakes the DIFFUSE light without
# colour, i.e. what three.js multiplies by albedo (lightMapIntensity = PI converts it to irradiance).
import bpy, sys, json, math, time, os
import numpy as np
cfg = json.loads(sys.argv[sys.argv.index('--') + 1]); t0 = time.time()
scene = bpy.context.scene; c = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
c.device = 'GPU'; print('devices', [d.name for d in prefs.devices if d.use])
# ---- the light for this layer
sys.path.insert(0, 'scripts'); from layer_lights import configure
layer = configure(scene, cfg)
# ---- this group's objects: everything with a lightmap UV set, split by lightmap area so groups take equal time
objs = sorted([o for o in scene.objects if o.type == 'MESH' and len(o.data.uv_layers) >= 2], key=lambda o: o.name)
def uv_area(o):
    uv = np.empty(len(o.data.loops) * 2, dtype=np.float32); o.data.uv_layers[1].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    tot = np.empty(len(o.data.polygons), dtype=np.int32); o.data.polygons.foreach_get('loop_total', tot)
    start = np.empty(len(o.data.polygons), dtype=np.int32); o.data.polygons.foreach_get('loop_start', start)
    tri = tot == 3; a = uv[start[tri]]; b = uv[start[tri] + 1]; cc = uv[start[tri] + 2]
    return float(np.abs((b[:, 0] - a[:, 0]) * (cc[:, 1] - a[:, 1]) - (cc[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])).sum() / 2) + 1e-9
areas = [(uv_area(o), o) for o in objs]; areas.sort(key=lambda t: (-t[0], t[1].name))
G = cfg['groups']; load = [0.0] * G; members = [[] for _ in range(G)]
for a, o in areas: k = min(range(G), key=lambda i: load[i]); load[k] += a; members[k].append(o)
mine = members[cfg['group']]
if cfg.get('only'):   # a targeted test bake: only the units with these lightmap ids (node extras "lm", unwrap.py), in one group
    only = set(cfg['only']); mine = [o for a, o in areas if str(o.get('lm') or o.data.get('lm') or '') in only]
    print(f'only: {len(only)} lightmap ids -> {len(mine)} objects ({len({str(o.get("lm") or o.data.get("lm")) for o in mine})} ids found)')
    if not mine: raise SystemExit('only: no object carries those lightmap ids')
print(f'layer {layer} group {cfg["group"]}/{G}: {len(mine)} objects, uv share {load[cfg["group"]]:.4f}, setup {time.time() - t0:.0f} s')
# ---- bake target
size = cfg.get('size', [4096, 4096]); size = size if isinstance(size, list) else [size, size]
img = bpy.data.images.new('lightmap', size[0], size[1], alpha=True, float_buffer=True); img.generated_color = (0, 0, 0, 0)
# raw numbers: without this Blender sRGB-encodes the float buffer when saving it (found on 2026-10-14)
img.colorspace_settings.name = 'Non-Color'
# one bake call for the whole group: Cycles re-syncs the scene (every texture) per baked object, so join them first
for o in scene.objects: o.select_set(False)
for o in mine: o.select_set(True)
bpy.context.view_layer.objects.active = mine[0]
# Vertex colours: the glTF importer multiplies COLOR_0 into the base colour through a Color Attribute node with no name,
# i.e. the mesh's default colour attribute. Joined into an object without one, the merged mesh had the attribute but no
# default, the node read black, and the DIFFUSE bake (light divided by the albedo) wrote black: every vertex-coloured
# mesh that was not its group's first object baked black (the walnut shelf cabinet; then filled from neighbouring
# charts). Every member gets the attribute (white where it had none) and the joined mesh keeps it as the default.
VC = sorted({a.name for o in mine for a in o.data.color_attributes})
for o in mine:
    for name in VC:
        if name not in o.data.color_attributes:
            a = o.data.color_attributes.new(name, 'BYTE_COLOR', 'CORNER'); a.data.foreach_set('color', [1.0] * (4 * len(o.data.loops)))
if len(mine) > 1: bpy.ops.object.join()
ca = bpy.context.view_layer.objects.active.data.color_attributes
if len(ca):
    first = ca.get('Color') or ca[0]; idx = list(ca).index(first)
    ca.active_color_index = idx; ca.render_color_index = idx
target = bpy.context.view_layer.objects.active; mine = [target]
for o in mine:
    o.select_set(True)
    lm = o.data.uv_layers.get('UVMap.001') or o.data.uv_layers[1]; o.data.uv_layers.active = lm
    for slot in o.material_slots:
        if not slot.material or not slot.material.use_nodes: continue
        mt = slot.material.node_tree; n = mt.nodes.get('lightmap_target') or mt.nodes.new('ShaderNodeTexImage')
        n.name = 'lightmap_target'; n.image = img; mt.nodes.active = n
bpy.context.view_layer.objects.active = mine[0]
c.samples = cfg.get('samples', 1024); c.use_denoising = False; c.use_adaptive_sampling = False   # every texel gets all samples
c.sample_clamp_indirect = 8; c.max_bounces = 12; c.diffuse_bounces = 6
t1 = time.time()
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'INDIRECT'} if layer == 'sunind' else {'DIRECT', 'INDIRECT'}, margin=0, use_clear=True, target='IMAGE_TEXTURES')
print(f'bake {time.time() - t1:.0f} s')
os.makedirs(os.path.dirname(cfg['out']), exist_ok=True)
img.filepath_raw = cfg['out']; img.file_format = 'OPEN_EXR'
scene.render.image_settings.color_depth = '16'; scene.render.image_settings.exr_codec = 'ZIP'
img.save_render(cfg['out']) if False else img.save()
print(f'saved {cfg["out"]} total {time.time() - t0:.0f} s')
