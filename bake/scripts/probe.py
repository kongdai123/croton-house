# Light probes for movable objects: at each grid point, render a small 360-degree view in Cycles and project it to
# order-2 spherical harmonics (9 coefficients per colour) in three.js's world frame and basis order, so the site can
# evaluate shGetIrradianceAt() directly. Points inside geometry (mostly back faces around them) are marked invalid.
# usage: blender -b scene/scene_lm.blend -P scripts/probe.py -- '<json>'
#   {"layer", "chunk", "chunks", "probes": "scene/probes.json", "out": "bakes/<slot>/probes_<layer>_cNN.json",
#    "samples": n, ... the slot's light settings (see layer_lights.py); optional "near": [[x, y, z]...] and "maxDist"
#    skip points farther than maxDist from every near point (zeros: a lamp group's light does not reach them)}
import bpy, sys, json, math, time, os
import numpy as np
from mathutils import Vector
sys.path.insert(0, 'scripts'); from layer_lights import configure
from slots import resolve
cfg = resolve(json.loads(sys.argv[sys.argv.index('--') + 1])); t0 = time.time()
scene = bpy.context.scene; c = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
c.device = 'GPU'
layer = configure(scene, cfg)
if layer == 'lamps':
    # lamps must be seen by camera rays, or the probes would miss their direct light
    for o in scene.objects:
        if o.type == 'LIGHT' and o.name.startswith('lamp'): o.visible_camera = True

W, H = 64, 32
cam = scene.camera
cam.data.type = 'PANO'
try: cam.data.panorama_type = 'EQUIRECTANGULAR'
except AttributeError: cam.data.cycles.panorama_type = 'EQUIRECTANGULAR'
cam.rotation_euler = (math.pi / 2, 0, 0)          # looks north (+Y), up is +Z
cam.data.dof.use_dof = False
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = W, H, 100
c.samples = cfg.get('samples', 256); c.use_denoising = False; c.use_adaptive_sampling = False
scene.render.use_persistent_data = True
scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'; scene.view_settings.exposure = 0
# each probe view goes to a float EXR on the node's local disk (scene-linear radiance), read straight back
scene.use_nodes = False
scene.render.image_settings.file_format = 'OPEN_EXR'; scene.render.image_settings.color_depth = '32'
TMP = os.path.join(os.environ.get('TMPDIR', '/tmp'), f'croton_probe_{os.getpid()}.exr')
scene.render.filepath = TMP

def grab():
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(TMP, check_existing=False); w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32); img.pixels.foreach_get(px); ch = img.channels
    bpy.data.images.remove(img)
    return px.reshape(h, w, ch)[..., :3]

# ---- calibrate the panorama layout once: where do east (+X) and up (+Z) land in the image?
def calibrate():
    hidden = [(o, o.hide_render) for o in scene.objects]
    for o, _ in hidden: o.hide_render = True
    bg = scene.world.node_tree.nodes['skybg'].inputs['Strength']; bgv = bg.default_value; bg.default_value = 0
    mat = bpy.data.materials.new('calib'); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 50; out = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], out.inputs['Surface'])
    found = []
    for offset in ((4, 0, 0), (0, 0, 4)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.8, location=Vector(cam.location) + Vector(offset)); s = bpy.context.active_object; s.data.materials.append(mat)
        img = grab().sum(-1); y, x = np.unravel_index(np.argmax(img), img.shape); found.append((x, y))
        bpy.data.objects.remove(s, do_unlink=True)
    for o, h in hidden: o.hide_render = h
    bg.default_value = bgv
    (ex, ey), (ux, uy) = found
    east_right = ex > W / 2; up_high = uy > H / 2
    print('calibration east at', (ex, ey), 'up at', (ux, uy), '-> east_right', east_right, 'up_high', up_high)
    return (1 if east_right else -1), (1 if up_high else -1)

cam.location = (0.3, -1.0, 1.4)
sx, sy = calibrate()
# per-pixel directions in three's world frame, solid angles, and the SH basis (three.js SphericalHarmonics3 order)
u = (np.arange(W) + 0.5) / W - 0.5; v = (np.arange(H) + 0.5) / H - 0.5
lon = sx * u[None, :] * 2 * math.pi; lat = sy * v[:, None] * math.pi
bx = np.sin(lon) * np.cos(lat); by = np.cos(lon) * np.cos(lat); bz = np.sin(lat) * np.ones_like(lon)
x, y, z = bx, bz, -by                         # Blender (x east, y north, z up) -> three (x east, y up, z south)
dw = (2 * math.pi / W) * (math.pi / H) * np.cos(lat) * np.ones_like(lon)
Y = np.stack([0.282095 * np.ones_like(x), 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z,
              0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)], -1) * dw[..., None]

probes = json.load(open(cfg['probes']))['points']
mine = [i for i in range(len(probes)) if i % cfg['chunks'] == cfg['chunk']]
dg = bpy.context.evaluated_depsgraph_get()
dirs = [Vector(d) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
results = []; t1 = time.time()
# a lamp group's probes (lamp_groups_tasks.py): points farther than maxDist from all of its lights get no light (zeros)
near = [Vector(q) for q in cfg.get('near', [])]; far = cfg.get('maxDist')
for n, i in enumerate(mine):
    bxp, byp, bzp = probes[i]['b']
    p = Vector((bxp, byp, bzp))
    if far and (not near or min((p - q).length for q in near) > far):
        results.append([i, 1] + [0.0] * 27); continue
    # inside geometry: rays leave through back faces
    back = 0
    for d in dirs:
        hit, loc, nrm, *_ = scene.ray_cast(dg, p, d, distance=3.0)
        if hit and nrm.dot(d) > 0: back += 1
    valid = back < 2
    sh = [0.0] * 27
    if valid:
        cam.location = p; img = grab()
        coef = np.einsum('hwk,hwc->kc', Y, img)   # 9 x 3
        sh = coef.ravel().round(6).tolist()
    results.append([i, int(valid)] + sh)
    if n % 50 == 0: print(f'{n}/{len(mine)} probes, {time.time() - t1:.0f} s', flush=True)
os.makedirs(os.path.dirname(cfg['out']), exist_ok=True)
json.dump(results, open(cfg['out'], 'w'))
print(f'saved {cfg["out"]}: {len(results)} probes, {sum(r[1] for r in results)} valid, {time.time() - t0:.0f} s')
