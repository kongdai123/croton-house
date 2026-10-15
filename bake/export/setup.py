# Build the Blender scene for the "after the rain, sun just rising" stills.
# usage: blender -b -P setup.py -- croton.glb lights.json out.blend
# Plan coordinates map straight onto Blender's: x east, y north, z up (the glTF importer turns three's -z into +y).
import bpy, sys, json, math
from mathutils import Vector

DRY = '--dry' in sys.argv
GLB, LIGHTS, OUT = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB, merge_vertices=False)
scene = bpy.context.scene
for ob in [o for o in scene.objects if o.type == 'LIGHT']:
    bpy.data.objects.remove(ob, do_unlink=True)


def inside(x, y):
    front = -5.94 if (x < -3.5 or x > 3.97) else -4.82
    return -8.1 <= x <= 8.1 and front <= y <= 5.62


def bsdf_of(mat):
    if not mat or not mat.use_nodes:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)


# ---- classify materials by where their meshes sit
ground, plants, outdoor, glass = set(), set(), set(), set()
for ob in scene.objects:
    if ob.type != 'MESH':
        continue
    c = [ob.matrix_world @ Vector(v) for v in ob.bound_box]
    cx, cy = sum(v.x for v in c) / 8, sum(v.y for v in c) / 8
    zmax = max(v.z for v in c)
    span = max(max(v.x for v in c) - min(v.x for v in c), max(v.y for v in c) - min(v.y for v in c))
    out = not inside(cx, cy) and span < 40
    for slot in ob.material_slots:
        m = slot.material
        b = bsdf_of(m)
        if not b:
            continue
        if b.inputs['Transmission Weight'].default_value > 0.5 and 'sheer' not in m.keys():
            glass.add(m)
            continue
        if not out:
            continue
        if b.inputs['Alpha'].is_linked or b.inputs['Alpha'].default_value < 0.99 or m.name.startswith('garden-'):
            plants.add(m)
        elif zmax < 0.35:
            ground.add(m)
        else:
            outdoor.add(m)
print('materials: ground', len(ground), 'plants', len(plants), 'outdoor', len(outdoor), 'glass', len(glass))


def scale_input(nt, sock, factor, minimum=None):
    """Multiply a BSDF input by a factor, whether it is a plain value or linked to a texture."""
    if sock.is_linked:
        src = sock.links[0].from_socket
        if sock.type == 'RGBA':
            mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
            nt.links.new(src, mix.inputs[1]); mix.inputs[2].default_value = (factor, factor, factor, 1)
            nt.links.new(mix.outputs[0], sock)
        else:
            m = nt.nodes.new('ShaderNodeMath'); m.operation = 'MULTIPLY'; m.use_clamp = True
            nt.links.new(src, m.inputs[0]); m.inputs[1].default_value = factor
            nt.links.new(m.outputs[0], sock)
    else:
        if sock.type == 'RGBA':
            v = sock.default_value; sock.default_value = (v[0] * factor, v[1] * factor, v[2] * factor, v[3])
        else:
            sock.default_value = max(minimum or 0, sock.default_value * factor)


def puddles(mat):
    """Flat glossy puddles where a world-space noise dips: roughness to near zero, colour darkened, bumps flattened."""
    nt = mat.node_tree; b = bsdf_of(mat)
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 0.35; noise.inputs['Detail'].default_value = 4; noise.inputs['Roughness'].default_value = 0.55
    nt.links.new(geo.outputs['Position'], noise.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.56; ramp.color_ramp.elements[1].position = 0.6
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    for name, wet_value in (('Roughness', 0.02),):
        s = b.inputs[name]
        mix = nt.nodes.new('ShaderNodeMixRGB'); nt.links.new(ramp.outputs['Color'], mix.inputs[0])
        if s.is_linked: nt.links.new(s.links[0].from_socket, mix.inputs[1])
        else: mix.inputs[1].default_value = (s.default_value,) * 3 + (1,)
        mix.inputs[2].default_value = (wet_value,) * 3 + (1,)
        nt.links.new(mix.outputs[0], s)
    s = b.inputs['Base Color']
    mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; nt.links.new(ramp.outputs['Color'], mix.inputs[0])
    if s.is_linked: nt.links.new(s.links[0].from_socket, mix.inputs[1])
    else: mix.inputs[1].default_value = s.default_value
    mix.inputs[2].default_value = (0.55, 0.55, 0.58, 1)
    nt.links.new(mix.outputs[0], s)
    n = b.inputs['Normal']
    if n.is_linked and n.links[0].from_node.type == 'NORMAL_MAP':
        nm = n.links[0].from_node
        inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1
        nt.links.new(ramp.outputs['Color'], inv.inputs[1]); nt.links.new(inv.outputs[0], nm.inputs['Strength'])


# ---- after the rain: everything outdoors is wet
if not DRY:
    for m in ground:
        b = bsdf_of(m)
        scale_input(m.node_tree, b.inputs['Base Color'], 0.62)
        scale_input(m.node_tree, b.inputs['Roughness'], 0.3, 0.06)
        b.inputs['Specular IOR Level'].default_value = 0.5
        puddles(m)
    for m in plants:
        b = bsdf_of(m)
        scale_input(m.node_tree, b.inputs['Roughness'], 0.45, 0.12)
        b.inputs['Specular IOR Level'].default_value = 0.6
        b.inputs['Coat Weight'].default_value = 0.35; b.inputs['Coat Roughness'].default_value = 0.08
    for m in outdoor:
        b = bsdf_of(m)
        scale_input(m.node_tree, b.inputs['Base Color'], 0.85)
        scale_input(m.node_tree, b.inputs['Roughness'], 0.55, 0.08)

# ---- glass: clear for camera and reflection rays, open for light (no caustic dead end through the panes)
for m in glass:
    nt = m.node_tree; b = bsdf_of(m); outp = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    b.inputs['Roughness'].default_value = 0.0; b.inputs['IOR'].default_value = 1.5
    lp = nt.nodes.new('ShaderNodeLightPath')
    mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
    nt.links.new(lp.outputs['Is Shadow Ray'], mx.inputs[0]); nt.links.new(lp.outputs['Is Diffuse Ray'], mx.inputs[1])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mx.outputs[0], mix.inputs[0]); nt.links.new(b.outputs[0], mix.inputs[1]); nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], outp.inputs['Surface'])

# ---- sheer voile (web: decor.js sheerMat, userData.sheer -> glTF extras): translucent cloth, not a glowing one.
# Coverage (the alpha map: gaps between threads) mixes in a Transparent BSDF; the fibres reflect diffusely and scatter
# `transmit` of the light from behind through a Translucent BSDF, so daylight passes softly into the room. Older exports
# (no extras) are recognised by sheen + alpha; their walkthrough emission (a raster daytime glow) is dropped.
def is_sheer(m, b):
    return 'sheer' in m.keys() or (b.inputs['Sheen Weight'].default_value > 0.2 and (b.inputs['Alpha'].is_linked or b.inputs['Alpha'].default_value < 0.99)
                                   and b.inputs['Transmission Weight'].default_value <= 0.5)
for m in bpy.data.materials:
    b = bsdf_of(m)
    if not b or not is_sheer(m, b):
        continue
    nt = m.node_tree; outp = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    s = m.get('sheer'); transmit = float(s['transmit']) if s and 'transmit' in s else 0.7
    b.inputs['Emission Strength'].default_value = 0; b.inputs['Transmission Weight'].default_value = 0
    b.inputs['Sheen Weight'].default_value = min(b.inputs['Sheen Weight'].default_value, 0.3); b.inputs['Roughness'].default_value = 1.0
    alpha = b.inputs['Alpha']; cover = alpha.links[0].from_socket if alpha.is_linked else None; cover_value = alpha.default_value
    if cover: nt.links.remove(alpha.links[0])
    alpha.default_value = 1.0
    tl = nt.nodes.new('ShaderNodeBsdfTranslucent')
    if b.inputs['Base Color'].is_linked: nt.links.new(b.inputs['Base Color'].links[0].from_socket, tl.inputs['Color'])
    else: tl.inputs['Color'].default_value = b.inputs['Base Color'].default_value
    fibre = nt.nodes.new('ShaderNodeMixShader'); fibre.name = 'sheer_fibre'; fibre.inputs[0].default_value = transmit
    nt.links.new(b.outputs[0], fibre.inputs[1]); nt.links.new(tl.outputs[0], fibre.inputs[2])
    gaps = nt.nodes.new('ShaderNodeMixShader'); tp = nt.nodes.new('ShaderNodeBsdfTransparent')
    if cover: nt.links.new(cover, gaps.inputs[0])
    else: gaps.inputs[0].default_value = cover_value
    nt.links.new(tp.outputs[0], gaps.inputs[1]); nt.links.new(fibre.outputs[0], gaps.inputs[2])
    nt.links.new(gaps.outputs[0], outp.inputs['Surface'])
    print('sheer voile:', m.name, 'transmit', transmit)

# ---- soft warm lamps inside, from the walkthrough's own fixtures (dusk state: everything that can be on)
data = json.load(open(LIGHTS))
for i, L in enumerate(data['lights']):
    if 'fire' in (L['name'] or '') or 'sconce' in (L['name'] or '').lower():
        continue
    x, y, z = L['p']
    if L['type'] == 'RectAreaLight':
        ld = bpy.data.lights.new(f'lamp{i}', 'AREA'); ld.shape = 'RECTANGLE'; ld.size = L['w'] or 0.5; ld.size_y = L['h'] or 0.5
        ld.energy = 35 if L['intensity'] < 100 else 60
    elif L['type'] == 'SpotLight':
        ld = bpy.data.lights.new(f'lamp{i}', 'SPOT'); ld.spot_size = min(math.pi, 2 * (L['angle'] or 0.6)); ld.spot_blend = 0.85
        ld.energy = 70; ld.shadow_soft_size = 0.08
    else:
        ld = bpy.data.lights.new(f'lamp{i}', 'POINT'); ld.energy = 30 if L['intensity'] < 10 else 55; ld.shadow_soft_size = 0.12
    # fixtures with no live light that are lamps in the bake only (lights.mjs bakeOnly: the primary bath's and the hall's
    # cans) burn low: at full power two cans in a 1.1 m hall lit it ~10x brighter than the living room (Cycles, 2026-10-15)
    if L.get('bakeOnly'): ld.energy *= 0.17
    ld.use_nodes = True
    bb = ld.node_tree.nodes.new('ShaderNodeBlackbody'); bb.inputs[0].default_value = 2700
    em = next(n for n in ld.node_tree.nodes if n.type == 'EMISSION'); ld.node_tree.links.new(bb.outputs[0], em.inputs['Color'])
    ob = bpy.data.objects.new(f'lamp{i}', ld); ob.location = (x, y, z); scene.collection.objects.link(ob)
    if L.get('t') and L['type'] != 'PointLight':
        d = Vector(L['t']) - Vector((x, y, z)); ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    elif L['type'] == 'RectAreaLight':
        ob.rotation_euler = (0, 0, 0)  # ceiling panels face down
# ---- emission: only real light sources (web: materials.js emitsLight, exported as material extras lightGlow = a lamp
# surface of a switched fixture, emits = lamp / screen / indicator / fire). The walkthrough's daytime glow on everything
# else (cellular shades, sheers: lighting.js lifts them to 0.12, a raster stand-in for light through the cloth) would
# light the rooms (about half the light on the living-room walls came from the curtains), so it is dropped. The lamp
# surfaces glow gently (x2.5). Older exports without the markers keep the old rule: every warm emissive x2.5.
def source(m):
    return 'lightGlow' in m.keys() or 'emits' in m.keys()
marked = any(source(m) for m in bpy.data.materials)
if not marked: print('WARNING: no emission markers in the export: every emissive material glows')
dropped, lamps = [], []
for m in bpy.data.materials:
    b = bsdf_of(m)
    if not b or b.inputs['Emission Strength'].default_value <= 0: continue
    if marked and not source(m):
        if any(c > 0 for c in b.inputs['Emission Color'].default_value[:3]) or b.inputs['Emission Color'].is_linked: dropped.append(m.name)
        b.inputs['Emission Strength'].default_value = 0
        continue
    if any(c > 0.3 for c in b.inputs['Emission Color'].default_value[:3]) and (not marked or 'lightGlow' in m.keys() or m.get('emits') == 'lamp'):
        b.inputs['Emission Strength'].default_value = min(4.0, b.inputs['Emission Strength'].default_value * 2.5); lamps.append(m.name)
print('emission: lamp surfaces', len(lamps), 'dropped (not a light source)', len(dropped), dropped[:12])

# ---- sun and sky (placed by render.py), clouds clearing after rain
sun_data = bpy.data.lights.new('sun', 'SUN'); sun_data.angle = math.radians(1.2)
sun = bpy.data.objects.new('sun', sun_data); scene.collection.objects.link(sun)
world = bpy.data.worlds.new('sky'); scene.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputWorld')
bg = nt.nodes.new('ShaderNodeBackground')
sky = nt.nodes.new('ShaderNodeTexSky'); sky.name = 'Nishita'; sky.sky_type = 'NISHITA'; sky.sun_disc = False
sky.air_density = 1.0; sky.dust_density = 2.5; sky.ozone_density = 1.0; sky.altitude = 10
# cloud deck: noise projected on a plane overhead, thinning toward the horizon, warm where it faces the sun
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sep.inputs[0])
zoff = nt.nodes.new('ShaderNodeMath'); zoff.operation = 'ADD'; zoff.inputs[1].default_value = 0.06; nt.links.new(sep.outputs['Z'], zoff.inputs[0])
u = nt.nodes.new('ShaderNodeMath'); u.operation = 'DIVIDE'; nt.links.new(sep.outputs['X'], u.inputs[0]); nt.links.new(zoff.outputs[0], u.inputs[1])
v = nt.nodes.new('ShaderNodeMath'); v.operation = 'DIVIDE'; nt.links.new(sep.outputs['Y'], v.inputs[0]); nt.links.new(zoff.outputs[0], v.inputs[1])
uv = nt.nodes.new('ShaderNodeCombineXYZ'); nt.links.new(u.outputs[0], uv.inputs[0]); nt.links.new(v.outputs[0], uv.inputs[1])
cn = nt.nodes.new('ShaderNodeTexNoise'); cn.inputs['Scale'].default_value = 0.45; cn.inputs['Detail'].default_value = 10; cn.inputs['Roughness'].default_value = 0.62
nt.links.new(uv.outputs[0], cn.inputs['Vector'])
cr = nt.nodes.new('ShaderNodeValToRGB'); cr.name = 'cloud_cover'; cr.color_ramp.elements[0].position = 0.55; cr.color_ramp.elements[1].position = 0.78
nt.links.new(cn.outputs['Fac'], cr.inputs['Fac'])
hz = nt.nodes.new('ShaderNodeMapRange'); hz.inputs['From Min'].default_value = 0.0; hz.inputs['From Max'].default_value = 0.25
nt.links.new(sep.outputs['Z'], hz.inputs['Value'])
dens = nt.nodes.new('ShaderNodeMath'); dens.operation = 'MULTIPLY'; nt.links.new(cr.outputs['Color'], dens.inputs[0]); nt.links.new(hz.outputs['Result'], dens.inputs[1])
sundot = nt.nodes.new('ShaderNodeVectorMath'); sundot.name = 'sundot'; sundot.operation = 'DOT_PRODUCT'; nt.links.new(tc.outputs['Generated'], sundot.inputs[0])
warm = nt.nodes.new('ShaderNodeMapRange'); warm.inputs['From Min'].default_value = 0.2; warm.inputs['From Max'].default_value = 1.0
nt.links.new(sundot.outputs['Value'], warm.inputs['Value'])
tint = nt.nodes.new('ShaderNodeMixRGB'); tint.inputs[1].default_value = (0.62, 0.66, 0.78, 1); tint.inputs[2].default_value = (2.6, 1.45, 0.95, 1)
nt.links.new(warm.outputs['Result'], tint.inputs[0])
bw = nt.nodes.new('ShaderNodeRGBToBW'); nt.links.new(sky.outputs['Color'], bw.inputs[0])
cloud = nt.nodes.new('ShaderNodeMixRGB'); cloud.blend_type = 'MULTIPLY'; cloud.inputs[0].default_value = 1
nt.links.new(bw.outputs[0], cloud.inputs[1]); nt.links.new(tint.outputs[0], cloud.inputs[2])
final = nt.nodes.new('ShaderNodeMixRGB'); nt.links.new(dens.outputs[0], final.inputs[0]); nt.links.new(sky.outputs['Color'], final.inputs[1]); nt.links.new(cloud.outputs[0], final.inputs[2])
nt.links.new(final.outputs[0], bg.inputs['Color']); bg.inputs['Strength'].default_value = 0.35; bg.name = 'skybg'
nt.links.new(bg.outputs[0], out.inputs['Surface'])

# ---- morning mist: a thin scattering volume around the lot (a world volume would hide the sky)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 4, 10))
mist = bpy.context.active_object; mist.name = 'mist'; mist.scale = (90, 90, 20)
mm = bpy.data.materials.new('mist'); mm.use_nodes = True; mnt = mm.node_tree; mnt.nodes.clear()
mo = mnt.nodes.new('ShaderNodeOutputMaterial'); vs = mnt.nodes.new('ShaderNodeVolumeScatter'); vs.name = 'scatter'
vs.inputs['Density'].default_value = 0.006; vs.inputs['Anisotropy'].default_value = 0.65
mnt.links.new(vs.outputs[0], mo.inputs['Volume']); mist.data.materials.append(mm)
mist.visible_shadow = False

# ---- render settings
c = scene.cycles; scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
c.device = 'GPU'
c.use_adaptive_sampling = True; c.adaptive_threshold = 0.01
c.use_denoising = True; c.denoiser = 'OPENIMAGEDENOISE'; c.denoising_input_passes = 'RGB_ALBEDO_NORMAL'; c.denoising_prefilter = 'ACCURATE'
try: c.denoising_use_gpu = True
except AttributeError: pass
c.use_light_tree = True
c.max_bounces = 12; c.diffuse_bounces = 5; c.glossy_bounces = 4; c.transmission_bounces = 12; c.volume_bounces = 1; c.transparent_max_bounces = 64
c.caustics_reflective = False; c.caustics_refractive = False; c.blur_glossy = 0.8; c.sample_clamp_indirect = 8
c.volume_step_rate = 4
scene.render.use_simplify = True; c.texture_limit_render = '2048'
scene.render.use_persistent_data = True
scene.view_settings.view_transform = 'AgX'
try: scene.view_settings.look = 'AgX - Medium High Contrast'
except TypeError: pass

# ---- lens: a little glare, chromatic fringe and vignette in the compositor
scene.use_nodes = True; ct = scene.node_tree; ct.nodes.clear()
rl = ct.nodes.new('CompositorNodeRLayers'); comp = ct.nodes.new('CompositorNodeComposite')
glare = ct.nodes.new('CompositorNodeGlare'); glare.glare_type = 'FOG_GLOW'
def setp(node, prop, sock, value):
    if sock in node.inputs: node.inputs[sock].default_value = value
    elif hasattr(node, prop): setattr(node, prop, value)
setp(glare, 'threshold', 'Threshold', 1.2); setp(glare, 'mix', 'Strength', 0.12) if 'Strength' in glare.inputs else setp(glare, 'mix', 'Mix', -0.88)
setp(glare, 'size', 'Size', 0.5 if 'Size' in glare.inputs else 8)
lens = ct.nodes.new('CompositorNodeLensdist'); lens.inputs['Dispersion'].default_value = 0.012; lens.use_fit = True
ell = ct.nodes.new('CompositorNodeEllipseMask')
if 'Size' in ell.inputs: ell.inputs['Size'].default_value = (1.05, 1.0)
else: ell.width = 1.05; ell.height = 1.0
blur = ct.nodes.new('CompositorNodeBlur'); blur.filter_type = 'GAUSS'
if 'Size' in blur.inputs: blur.inputs['Size'].default_value = (300, 300)
else: blur.use_relative = True; blur.factor_x = 25; blur.factor_y = 25
vmap = ct.nodes.new('CompositorNodeMapRange'); vmap.inputs['To Min'].default_value = 0.68; vmap.inputs['To Max'].default_value = 1.0
vig = ct.nodes.new('CompositorNodeMixRGB'); vig.blend_type = 'MULTIPLY'; vig.inputs[0].default_value = 1
ct.links.new(rl.outputs['Image'], glare.inputs['Image']); ct.links.new(glare.outputs['Image'], lens.inputs['Image'])
ct.links.new(ell.outputs['Mask'], blur.inputs['Image']); ct.links.new(blur.outputs['Image'], vmap.inputs['Value'])
ct.links.new(lens.outputs['Image'], vig.inputs[1]); ct.links.new(vmap.outputs['Value'], vig.inputs[2])
ct.links.new(vig.outputs['Image'], comp.inputs['Image'])

cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('saved', OUT)
