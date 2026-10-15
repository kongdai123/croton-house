# Reflection probes: full-lighting 360-degree panoramas at points through the house and garden, laid out in three's
# equirect convention (centre east, right south, top up), plus a box from raycasts to the surroundings (6 axes) for
# parallax correction. usage: blender -b scene/scene.blend -P scripts/reflprobe.py -- '<slot json>' out_dir [i0 i1]
import bpy, sys, json, math, os
from mathutils import Vector
sys.path.insert(0, 'scripts')
from slots import resolve
from layer_lights import configure_world
args = sys.argv[sys.argv.index('--') + 1:]; cfg = resolve(json.loads(args[0])); out = args[1]; os.makedirs(out, exist_ok=True)
scene = bpy.context.scene; c = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
c.device = 'GPU'
configure_world(scene, cfg)
# full lighting as the bake slot: sky, sun, lamps at the walkthrough's level (scene.blend has movables and all)
s = cfg['sun']; az, el = math.radians(s['az']), math.radians(s['el'])
sun = bpy.data.objects['sun']; sun.rotation_euler = (math.radians(90) - el, 0, math.radians(180) - az)
sun.data.energy = s['strength']; sun.data.color = tuple(s['color']); sun.hide_render = s['strength'] <= 0
nt = scene.world.node_tree; sky = nt.nodes['Nishita']; sky.sun_elevation = el; sky.sun_rotation = (-az) % (2 * math.pi); sky.dust_density = cfg.get('dust', 0.8)
nt.nodes['sundot'].inputs[1].default_value = (math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))
lo, hi = cfg.get('clouds', [0.5, 0.68]); cr = nt.nodes['cloud_cover'].color_ramp; cr.elements[0].position = lo; cr.elements[1].position = hi
nt.nodes['skybg'].inputs['Strength'].default_value = cfg.get('sky', 0.45)
for o in scene.objects:
    if o.type == 'LIGHT' and o.name.startswith('lamp'):
        o.hide_render = False; o.data.energy *= cfg.get('lamps', 0.25)
        bb = next((n for n in o.data.node_tree.nodes if n.type == 'BLACKBODY'), None) if o.data.node_tree else None
        if bb: bb.inputs[0].default_value = cfg.get('lampK', 3000)
for m in bpy.data.materials:
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
    if b and b.inputs['Emission Strength'].default_value > 0: b.inputs['Emission Strength'].default_value *= cfg.get('lamps', 0.25)
bpy.data.objects['mist'].hide_render = True
cam = scene.camera; cam.data.type = 'PANO'
try: cam.data.panorama_type = 'EQUIRECTANGULAR'
except AttributeError: cam.data.cycles.panorama_type = 'EQUIRECTANGULAR'
cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2); cam.data.dof.use_dof = False
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 512, 256, 100
c.samples = 512; c.use_denoising = True; scene.use_nodes = False
scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'; scene.view_settings.exposure = 0
scene.render.image_settings.file_format = 'HDR'
# probe points (plan x east, y north, z up): a grid indoors, the patio, garden, front and sides outdoors
def inside(x, y):
    f = -5.94 if (x < -3.5 or x > 3.97) else -4.82
    return -8.1 <= x <= 8.1 and f <= y <= 5.62
pts = [(x, y, 1.3) for x in (-6.2, -2.8, 0.6, 4.0, 6.8) for y in (-3.6, 0.0, 3.6) if inside(x, y)]
pts += [(-5, 8, 1.3), (0, 8, 1.3), (5, 8, 1.3), (-6, 12.5, 1.3), (0, 12.5, 1.3), (6, 12.5, 1.3), (-5, -8.5, 1.3), (0, -8.5, 1.3), (5, -8.5, 1.3), (10.5, 0, 1.3), (-10.5, 0, 1.3)]
# the two small baths: the grid point (6.8, 0) sat 12 cm from the hall bath's mirror cabinet (a 47 cm box), and the
# bedroom bath had no probe (its mirror reflected the hall bath); one probe at the middle of each
pts[pts.index((6.8, 0.0, 1.3))] = (6.5, -0.53, 1.3); pts.append((6.5, 1.07, 1.3))
i0, i1 = (int(args[2]), int(args[3])) if len(args) > 3 else (0, len(pts))
dg = bpy.context.evaluated_depsgraph_get(); meta = []
for i in range(i0, min(i1, len(pts))):
    p = Vector(pts[i]); ext = []
    for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
        hit, loc, *_ = scene.ray_cast(dg, p, Vector(d), distance=30.0); ext.append(round((loc - p).length, 3) if hit else 30.0)
    cam.location = p; scene.render.filepath = os.path.join(out, f'probe_{i:02d}.hdr')
    bpy.ops.render.render(write_still=True)
    # three's frame: x east, y up, z south; box from the raycasts (x+, x-, north+, north-, up, down)
    meta.append({'i': i, 'p': [p.x, p.z, -p.y], 'min': [p.x - ext[1], p.z - ext[5], -p.y - ext[2]], 'max': [p.x + ext[0], p.z + ext[4], -p.y + ext[3]]})
    print('probe', i, pts[i], 'extents', ext, flush=True)
json.dump(meta, open(os.path.join(out, f'meta_{i0:02d}.json'), 'w'))
