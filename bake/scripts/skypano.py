# The slot's sky (exactly what the bake used) as an equirectangular HDR laid out for three.js:
# centre = east (+x), right = south (+z), top = up, which is three's equirect convention.
# usage: blender -b scene/scene_lm.blend -P scripts/skypano.py -- '<slot json>' out.hdr
import bpy, sys, json, math
sys.path.insert(0, 'scripts'); from layer_lights import configure
from slots import resolve
args = sys.argv[sys.argv.index('--') + 1:]; cfg = resolve(json.loads(args[0])); cfg['layer'] = 'sky'
scene = bpy.context.scene; c = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
c.device = 'GPU'
configure(scene, cfg)
for o in scene.objects:
    if o.type != 'CAMERA': o.hide_render = True
cam = scene.camera; cam.data.type = 'PANO'
try: cam.data.panorama_type = 'EQUIRECTANGULAR'
except AttributeError: cam.data.cycles.panorama_type = 'EQUIRECTANGULAR'
cam.location = (0, 0, 1.6); cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)   # forward east, right south, up up
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 2048, 1024, 100
c.samples = 64; c.use_denoising = False; scene.use_nodes = False
scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'; scene.view_settings.exposure = 0
scene.render.image_settings.file_format = 'HDR'; scene.render.filepath = args[1]
bpy.ops.render.render(write_still=True); print('saved', args[1])
