# Per-vertex baked light for the plants, which have no lightmap. Every plant primitive of the exported scene is rebuilt
# as one Blender mesh in the glTF's own vertex order (the importer may drop or reorder vertices), the imported plant
# objects are removed, and Cycles bakes each lightmap layer (layer_lights.py) to a colour attribute on its vertices.
# Leaves are two-sided cards: at the baked point only (a camera ray in a bake, but not the shadow rays leaving it, which
# carry the camera flag too) the surface becomes half white diffuse, half white translucent, so a vertex holds the mean
# of the light on its two faces; every other ray sees the real alpha-masked leaves, so the plant shades itself and its
# neighbours. Same units as bake.py: radiance of a white surface = irradiance / PI. A fourth bake, sunvis, keeps the
# part of the sun's disc each vertex sees (0..1): the live sun's shadow map is too coarse for a canopy shading itself.
# Units keep the export's stable mesh id (node extras 'lm', batch.js) where the plant holds still; swaying plants have none.
# usage: blender -b scene/stableid/scene_lm.blend -P scripts/foliage_bake.py -- '<json>'
#   {"glb": scene/stableid/croton_lm.glb, "out": bakes/stableid/sunrise/foliage/foliage.npz, "samples": n,
#    "layers": [lamps, sky, sunind, sunvis], "shrink": m, ...the slot's light settings (make_tasks.py)}
import bpy, sys, os, json, time, math
if os.environ.get('CROTON_SITE_PACKAGES'): sys.path.append(os.environ['CROTON_SITE_PACKAGES'])
import numpy as np
from pygltflib import GLTF2
sys.path.insert(0, 'scripts'); from layer_lights import configure
import lighting   # the lighting manifest: which materials take the per-vertex foliage bake
from slots import resolve
cfg = resolve(json.loads(sys.argv[sys.argv.index('--') + 1])); t0 = time.time()
scene = bpy.context.scene; c = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
c.device = 'GPU'

# ---- plant units from the glTF: the parts sharing a POSITION accessor and a node matrix (as unwrap.py) whose material
# takes the per-vertex foliage bake (lighting manifest foliage.bakedPerVertex: the modelled plants; the garden's leaf
# cards are instanced at run time and left out)
g = GLTF2().load(cfg['glb']); blob = g.binary_blob()
DT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5122: np.int16, 5120: np.int8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def read(i):
    a = g.accessors[i]; v = g.bufferViews[a.bufferView]; dt = np.dtype(DT[a.componentType]); n = NC[a.type]
    off = (v.byteOffset or 0) + (a.byteOffset or 0); stride = v.byteStride or dt.itemsize * n
    raw = np.frombuffer(blob, dtype=np.uint8, count=stride * (a.count - 1) + dt.itemsize * n, offset=off)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a.count, dt.itemsize * n), strides=(stride, 1)).copy().view(dt).reshape(a.count, n)
    if a.normalized and dt != np.float32: out = out.astype(np.float32) / np.iinfo(dt).max
    return out
def plant(mi): return mi is not None and lighting.baked_foliage(lighting.material(g.materials[mi]))
units = {}
for ni, n in enumerate(g.nodes):
    if n.mesh is None: continue
    M = np.array(n.matrix or np.eye(4).ravel(), np.float64).reshape(4, 4).T
    for p in g.meshes[n.mesh].primitives:
        if plant(p.material): units.setdefault((p.attributes.POSITION, tuple(np.round(M.ravel(), 6))), (M, [], (n.extras or {}).get('lm')))[1].append(p)
P, N, UV, COL, F, FM, meta, base = [], [], [], [], [], [], [], 0
mats = []
for (pa, _), (M, prims, lm) in units.items():
    W = (np.c_[read(pa).astype(np.float64), np.ones(g.accessors[pa].count)] @ M.T)[:, :3]
    a0 = prims[0].attributes
    nrm = read(a0.NORMAL) @ np.linalg.inv(M[:3, :3]) if a0.NORMAL is not None else np.zeros_like(W)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
    uv = read(a0.TEXCOORD_0) if a0.TEXCOORD_0 is not None else np.zeros((len(W), 2))
    col = read(a0.COLOR_0) if a0.COLOR_0 is not None else np.ones((len(W), 4))
    if col.shape[1] == 3: col = np.c_[col, np.ones(len(W))]
    for p in prims:
        name = g.materials[p.material].name
        if name not in mats: mats.append(name)
        idx = read(p.indices).ravel() if p.indices is not None else np.arange(len(W))
        F.append(idx.reshape(-1, 3) + base); FM.append(np.full(len(idx) // 3, mats.index(name)))
    meta.append({'m': g.materials[prims[0].material].name, 'vc': len(W), 'min': W.min(0).round(4).tolist(), 'max': W.max(0).round(4).tolist(), **({'id': lm} if lm else {})})
    P.append(W); N.append(nrm); UV.append(uv); COL.append(col); base += len(W)
# three (x, y up, z south) -> Blender (x, y north, z up)
to_b = lambda a: np.c_[a[:, 0], -a[:, 2], a[:, 1]]
P, N, UV, COL, F, FM = to_b(np.concatenate(P)), to_b(np.concatenate(N)), np.concatenate(UV), np.concatenate(COL), np.concatenate(F), np.concatenate(FM)
print(f'{len(meta)} plant units, {len(P)} vertices, {len(F)} triangles, {len(mats)} materials, {time.time() - t0:.0f} s', flush=True)

# ---- swap the imported plants for one mesh in glTF vertex order
# (a material the bake scene made itself, setup.py's mist and helpers, has no manifest record: not foliage)
def foliage_material(m):
    rec = lighting.material(m, required=False) if m else None
    return rec is not None and lighting.baked_foliage(rec)
for o in [o for o in scene.objects if o.type == 'MESH' and o.material_slots and all(foliage_material(s.material) for s in o.material_slots)]:
    bpy.data.objects.remove(o, do_unlink=True)
# Every triangle gets its own corners, pulled `shrink` metres toward its centre: a sample exactly on a vertex sits on
# the edges of its neighbours too, and Cycles (which only skips the triangle a ray leaves) finds them in the way of
# many shadow rays. A vertex's value is the mean of its corners.
T = len(F); Q = P[F]; ctr = Q.mean(1, keepdims=True); d = Q - ctr
f = np.clip(1 - cfg.get('shrink', 0.002) / np.maximum(np.linalg.norm(d, axis=2, keepdims=True), 1e-9), 0.5, 1)
QP = (ctr + d * f).reshape(-1, 3); uvq = UV[F]; uvq = (uvq.mean(1, keepdims=True) + (uvq - uvq.mean(1, keepdims=True)) * f).reshape(-1, 2)
me = bpy.data.meshes.new('foliage')
me.vertices.add(3 * T); me.vertices.foreach_set('co', QP.astype(np.float32).ravel())
me.loops.add(3 * T); me.loops.foreach_set('vertex_index', np.arange(3 * T, dtype=np.int32))
me.polygons.add(T); me.polygons.foreach_set('loop_start', np.arange(0, 3 * T, 3, dtype=np.int32))
me.polygons.foreach_set('material_index', FM.astype(np.int32)); me.polygons.foreach_set('use_smooth', np.ones(T, bool))
uvl = me.uv_layers.new(name='UVMap')
uvl.data.foreach_set('uv', np.c_[uvq[:, 0], 1 - uvq[:, 1]].astype(np.float32).ravel())   # the importer's v flip
ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT'); ca.data.foreach_set('color', COL[F].reshape(-1, 4).astype(np.float32).ravel())
tgt = me.color_attributes.new('fol', 'FLOAT_COLOR', 'POINT')
me.update(); me.validate(clean_customdata=False)
me.normals_split_custom_set_from_vertices(N[F].reshape(-1, 3).astype(np.float32))
assert len(me.vertices) == 3 * T, 'validate dropped vertices'
lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', lv); kept = np.zeros(3 * T, bool); kept[lv] = True
cnt = np.zeros(len(P)); np.add.at(cnt, F.ravel()[kept], 1)
def per_vertex(c):
    acc = np.zeros((len(P), c.shape[1])); np.add.at(acc, F.ravel()[kept], c[kept]); return acc / np.maximum(cnt, 1)[:, None]
me.color_attributes.render_color_index = me.color_attributes.find('Color'); me.color_attributes.active_color = tgt
ob = bpy.data.objects.new('foliage', me); scene.collection.objects.link(ob)
for name in mats:
    m = bpy.data.materials.get(name); assert m, name
    me.materials.append(m)
    # the baked point: half diffuse, half translucent, white; every other ray: the real leaf
    nt = m.node_tree; out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    for n in nt.nodes:
        if n.type == 'VERTEX_COLOR' and not n.layer_name: n.layer_name = 'Color'
    src = out.inputs['Surface'].links[0].from_socket
    lp = nt.nodes.new('ShaderNodeLightPath'); dif = nt.nodes.new('ShaderNodeBsdfDiffuse'); tr = nt.nodes.new('ShaderNodeBsdfTranslucent')
    for b in (dif, tr): b.inputs['Color'].default_value = (1, 1, 1, 1)
    two = nt.nodes.new('ShaderNodeMixShader'); two.inputs[0].default_value = 0.5; nt.links.new(dif.outputs[0], two.inputs[1]); nt.links.new(tr.outputs[0], two.inputs[2])
    here = nt.nodes.new('ShaderNodeMath'); here.operation = 'SUBTRACT'; here.use_clamp = True
    nt.links.new(lp.outputs['Is Camera Ray'], here.inputs[0]); nt.links.new(lp.outputs['Is Shadow Ray'], here.inputs[1])
    mix = nt.nodes.new('ShaderNodeMixShader'); mix.name = 'fol_mix'; nt.links.new(here.outputs[0], mix.inputs[0]); nt.links.new(src, mix.inputs[1]); nt.links.new(two.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    # sun visibility: white and facing the sun (a diffuse for front faces, a translucent for back faces), so its direct
    # light is the visible part of the sun's disc
    svd = nt.nodes.new('ShaderNodeBsdfDiffuse'); svt = nt.nodes.new('ShaderNodeBsdfTranslucent'); sv = nt.nodes.new('ShaderNodeAddShader'); sv.name = 'fol_sunvis'
    sd = nt.nodes.new('ShaderNodeCombineXYZ'); sd.name = 'fol_sundir'; neg = nt.nodes.new('ShaderNodeVectorMath'); neg.operation = 'SCALE'; neg.inputs['Scale'].default_value = -1
    nt.links.new(sd.outputs[0], svd.inputs['Normal']); nt.links.new(sd.outputs[0], neg.inputs[0]); nt.links.new(neg.outputs[0], svt.inputs['Normal'])
    for b in (svd, svt): b.inputs['Color'].default_value = (1, 1, 1, 1)
    nt.links.new(svd.outputs[0], sv.inputs[0]); nt.links.new(svt.outputs[0], sv.inputs[1])
    two.name = 'fol_two'
for o in scene.objects: o.select_set(False)
ob.select_set(True); bpy.context.view_layer.objects.active = ob

# ---- one bake per layer (lamps first: configure() switches lamp shades off for the others)
c.samples = cfg.get('samples', 512); c.use_denoising = False; c.use_adaptive_sampling = False
c.sample_clamp_indirect = 8; c.max_bounces = 12; c.diffuse_bounces = 6; c.transparent_max_bounces = 64
res = {}
# sunvis: the fraction of the sun's disc each vertex sees (leaves, stems and the house in the way), for the live sun
for layer in cfg.get('layers', ['lamps', 'sky', 'sunind', 'sunvis']):
    configure(scene, dict(cfg, layer='sunind' if layer == 'sunvis' else layer)); t1 = time.time()
    s = cfg.get('sun', {}); az, el = math.radians(s.get('az', 58)), math.radians(s.get('el', 8))
    for name in mats:
        nt = bpy.data.materials[name].node_tree; sv = nt.nodes['fol_sunvis']
        for k, x in enumerate((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))): nt.nodes['fol_sundir'].inputs[k].default_value = x
        nt.links.new((sv if layer == 'sunvis' else nt.nodes['fol_two']).outputs[0], nt.nodes['fol_mix'].inputs[2])
    passes = {'DIRECT'} if layer == 'sunvis' else {'INDIRECT'} if layer == 'sunind' else {'DIRECT', 'INDIRECT'}
    bpy.ops.object.bake(type='COMBINED', pass_filter=passes | {'DIFFUSE', 'TRANSMISSION'}, target='VERTEX_COLORS', use_clear=True)
    v = np.empty(3 * T * 4, np.float32); tgt.data.foreach_get('color', v); res[layer] = per_vertex(v.reshape(-1, 4)[:, :3]).astype(np.float32)
    if layer == 'sunvis':   # white diffuse facing a sun of known irradiance: radiance = visible fraction * E / PI
        col = np.array(s.get('color', (1.0, 0.68, 0.45))); res[layer] = np.clip(res[layer] @ [0.2126, 0.7152, 0.0722] * math.pi / max(s.get('strength', 20.0) * (col @ [0.2126, 0.7152, 0.0722]), 1e-8), 0, 1)[:, None].repeat(3, 1)
    print(f'{layer}: {time.time() - t1:.0f} s, mean {res[layer].mean(0).round(4).tolist()}, zero {(res[layer].max(1) <= 0).mean():.4f}', flush=True)
os.makedirs(os.path.dirname(cfg['out']), exist_ok=True)
np.savez_compressed(cfg['out'], meta=json.dumps(meta), pos=P.astype(np.float32), **res)
print(f'saved {cfg["out"]}, {time.time() - t0:.0f} s')
