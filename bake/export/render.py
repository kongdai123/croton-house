# Render one still from the prepared scene.
# usage: blender -b scene.blend -P render.py -- '<json>'
# json: {"out": path, "res": [w, h], "samples": n, "cam": {"x","y","z","h","p","lens","fstop","focus"},
#        "sun": {"az","el","strength"}, "ev": bias, "exposure": fixed or null, "mist": density, "clouds": [lo, hi],
#        "raw": true for Standard view transform and no lens compositing}
# Plan coordinates: x east, y north, z up. Heading h: 0 north, clockwise. Sun azimuth likewise.
import bpy, sys, json, math, os, time
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../scripts'))
from slots import resolve
from layer_lights import configure_world

arg = sys.argv[sys.argv.index('--') + 1]
cfg = json.load(open(arg)) if arg.endswith('.json') else json.loads(arg)
cfg = resolve(cfg)
scene = bpy.context.scene; c = scene.cycles
if 'slot' in cfg or 'sky_tint' in cfg: configure_world(scene, cfg)
if 'slot' in cfg and 'exposure' not in cfg: cfg['exposure'] = cfg['ev']
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
c.device = 'GPU'

# camera
cam = scene.camera; k = cfg['cam']
cam.location = (k['x'], k['y'], k.get('z', 1.45))
cam.rotation_euler = (math.radians(90) + k.get('p', 0), 0, -math.radians(k['h']))
cam.data.lens = k.get('lens', 24); cam.data.sensor_width = 36
cam.data.dof.use_dof = bool(k.get('fstop'))
if k.get('fstop'):
    cam.data.dof.aperture_fstop = k['fstop']; cam.data.dof.aperture_blades = 7
    cam.data.dof.focus_distance = k.get('focus', 6)

# sun and sky
s = cfg.get('sun', {}); az, el = math.radians(s.get('az', 72)), math.radians(s.get('el', 5))
sun = bpy.data.objects['sun']
sun.rotation_euler = (math.radians(90) - el, 0, math.radians(180) - az)
sun.data.energy = s.get('strength', 3.5); sun.hide_render = sun.data.energy <= 0
sun.data.color = tuple(s.get('color', (1.0, 0.64, 0.38)))
nt = scene.world.node_tree
sky = nt.nodes['Nishita']; sky.sun_elevation = el; sky.sun_rotation = (-az) % (2 * math.pi)
sd = (math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))
nt.nodes['sundot'].inputs[1].default_value = sd
nt.nodes['skybg'].inputs['Strength'].default_value = cfg.get('sky', 0.35)
lo, hi = cfg.get('clouds', [0.55, 0.78])
cr = nt.nodes['cloud_cover'].color_ramp; cr.elements[0].position = lo; cr.elements[1].position = hi
bpy.data.materials['mist'].node_tree.nodes['scatter'].inputs['Density'].default_value = cfg.get('mist', 0.006)
sky.dust_density = cfg.get('dust', 2.5)
tint = nt.nodes.get('slot_cloud_tint') or next(n for n in nt.nodes if n.type == 'MIX_RGB' and tuple(round(v, 2) for v in n.inputs[1].default_value[:3]) == (0.62, 0.66, 0.78))
tint.inputs[1].default_value = tuple(cfg.get('cloud_shade', [0.62, 0.66, 0.78])) + (1,)
tint.inputs[2].default_value = tuple(cfg.get('cloud_lit', [2.6, 1.45, 0.95])) + (1,)
for o in scene.objects:
    if o.type == 'LIGHT' and o.name.startswith('lamp'):
        o.data.energy *= cfg.get('lamps', 1.0)
        bb = next((n for n in o.data.node_tree.nodes if n.type == 'BLACKBODY'), None) if o.data.node_tree else None
        if bb: bb.inputs[0].default_value = cfg.get('lampK', cfg.get('lamp_k', 2700))
# every glowing surface (lamp shades and lenses, screens) dims with the lamps: the lamps bake holds all emission at unit
# level and the site scales that layer and the emissive materials by the lamp level (lightmap.js syncEmissionCopies), so
# a reference with full-strength shades at sunrise's 0.25 was brighter than the site could be (living view +6%)
for m in bpy.data.materials:
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
    if b and b.inputs['Emission Strength'].default_value > 0: b.inputs['Emission Strength'].default_value *= cfg.get('lamps', 1.0)

w, h = cfg.get('res', [2560, 1440])
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_depth = '8'
scene.view_settings.exposure = 0
if cfg.get('raw'): scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'


def render(path, pct, samples):
    scene.render.resolution_percentage = pct; c.samples = samples
    scene.render.filepath = path
    t0 = time.time(); bpy.ops.render.render(write_still=True); return time.time() - t0


# exposure: like a camera meter, from a quick low-sample pass of the linear image
if cfg.get('exposure') is None:
    tmp = os.path.splitext(cfg['out'])[0] + '_meter.exr'
    scene.use_nodes = False
    scene.render.image_settings.file_format = 'OPEN_EXR'; scene.render.image_settings.color_depth = '32'
    render(tmp, 20, 24)
    img = bpy.data.images.load(tmp); px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    lum = 0.2126 * px[:, 0] + 0.7152 * px[:, 1] + 0.0722 * px[:, 2]
    avg = float(np.exp(np.mean(np.log(1e-4 + np.clip(lum, 0, None)))))
    ev = math.log2(0.18 / avg) + cfg.get('ev', 0)
    bpy.data.images.remove(img); os.remove(tmp)
    scene.use_nodes = True
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_depth = '8'
    print(f'meter: average {avg:.4f}, exposure {ev:+.2f} EV')
else:
    ev = cfg['exposure']
scene.view_settings.exposure = ev
scene.use_nodes = not cfg.get('raw')
sec = render(cfg['out'], cfg.get('pct', 100), cfg.get('samples', 512))
print(f'RENDERED {cfg["out"]} in {sec:.0f} s at exposure {ev:+.2f}')
