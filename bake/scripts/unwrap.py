# Lightmap UVs for every static mesh in the exported scene, packed into one atlas.
# usage: .venv/bin/python scripts/unwrap.py scene/croton.glb scene/croton_lm.glb bakes/lightmap_uv.bin [resolution] [--reuse old.bin]
#
# Units: the exporter splits a multi-material mesh into one node per material that share the POSITION accessor, and
# meshes that share a geometry reuse it under different matrices. A unit is one runtime mesh: the parts that share a
# POSITION accessor, a node matrix and a lightmap id. The id (node extras "lm", web/src/batch.js) names the runtime mesh;
# nodes without one (animated plants, toggled curtains, the garden) and carried pieces (extras "lmSkip": "movable") get
# no unit. Plants (alpha-masked leaves), glass, and the huge or far ground planes are left out too; they are lit by the
# probe volume at run time. Exports without ids fall back to scene/movables.json and bounding-box matching.
#
# Outputs
#   croton_lm.glb : the scene for Blender, every unit re-indexed with split seams and a TEXCOORD_1 lightmap set
#   lightmap_uv.bin : for the site. Little-endian: u32 header length, JSON header, then per unit u32 xref (new vertex
#                     -> original vertex), u32 indices, u16 x2 normalised lightmap UVs. Units are found at run time by
#                     id, else by original vertex count and world bounding box; header "skipped" maps the ids left out
#                     to the reason, so the site can tell a deliberate probe-lit mesh from a stale bake.
import sys, json, struct, time
import numpy as np
import xatlas
from pygltflib import GLTF2, BufferView, Accessor

# --reuse old_lightmap_uv.bin: keep an earlier layout (and the denoiser guides rasterised from it) for a re-export that
# changed only materials: every unit must be in the old layout with the same id, vertices and triangles, else it stops
# and asks for a fresh unwrap. Units that are gone leave their charts unused.
REUSE = None
if '--reuse' in sys.argv: i = sys.argv.index('--reuse'); REUSE = sys.argv[i + 1]; del sys.argv[i:i + 2]
src, dst_glb, dst_bin = sys.argv[1:4]
RES = int(sys.argv[4]) if len(sys.argv) > 4 else 4096
import os
# movable objects (chairs and stools the visitor can carry): no lightmap, hidden in the bake, lit by probes at run time
MOVABLE = json.load(open('scene/movables.json'))['meshes'] if os.path.exists('scene/movables.json') else []
def movable(vc, lo, hi):
    # three's world (x, y, z) is what both the site and this export use
    # same vertex count and size; position within 0.6 m (placement can differ by centimetres between runs)
    size = [h - l for l, h in zip(lo, hi)]; ctr = [(h + l) / 2 for l, h in zip(lo, hi)]
    for m in MOVABLE:
        if m['vc'] != vc: continue
        ms = [h - l for l, h in zip(m['min'], m['max'])]; mc = [(h + l) / 2 for l, h in zip(m['min'], m['max'])]
        if max(abs(a - b) for a, b in zip(size, ms)) < 0.01 and sum((a - b) ** 2 for a, b in zip(ctr, mc)) ** 0.5 < 0.6: return True
    return False
t0 = time.time()
g = GLTF2().load(src)
blob = bytearray(g.binary_blob())
DT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5122: np.int16, 5120: np.int8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read(i):
    a = g.accessors[i]; v = g.bufferViews[a.bufferView]; dt = np.dtype(DT[a.componentType]); n = NC[a.type]
    off = (v.byteOffset or 0) + (a.byteOffset or 0); stride = v.byteStride or dt.itemsize * n
    raw = np.frombuffer(blob, dtype=np.uint8, count=stride * (a.count - 1) + dt.itemsize * n, offset=off)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a.count, dt.itemsize * n), strides=(stride, 1)).copy().view(dt).reshape(a.count, n)
    if a.normalized and dt != np.float32: out = out.astype(np.float32) / np.iinfo(dt).max
    return out


def append(arr, target, ctype, typ, minmax=False):
    """Append an array to the binary blob as a new bufferView + accessor; returns the accessor index."""
    global blob
    while len(blob) % 4: blob.append(0)
    data = np.ascontiguousarray(arr).tobytes(); off = len(blob); blob += data
    g.bufferViews.append(BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
    acc = Accessor(bufferView=len(g.bufferViews) - 1, componentType=ctype, count=int(arr.shape[0]), type=typ)
    if minmax: acc.min = arr.min(0).tolist(); acc.max = arr.max(0).tolist()
    g.accessors.append(acc); return len(g.accessors) - 1


def world(n):
    m = np.array(n.matrix if n.matrix else np.eye(4).ravel(), dtype=np.float64).reshape(4, 4).T
    return m


def material_skip(mi):
    if mi is None: return False
    m = g.materials[mi]; name = (m.name or '')
    if m.alphaMode == 'MASK' or name.startswith('garden-') or name.startswith('plant'): return True
    if m.extensions and 'KHR_materials_transmission' in m.extensions: return True
    return False


# ---- gather units
extras = lambda n: n.extras if isinstance(n.extras, dict) else {}
# The exporter writes one glTF mesh for meshes that share both geometry and material (the leaves of a louvered bifold),
# and each unit's lightmap UVs go into its primitives below: shared, only the last unit's layout would reach Blender and
# all of them would bake into that one chart, leaving the others' empty. Every node gets its own mesh (primitives).
import copy
mesh_users = {}
for ni, n in enumerate(g.nodes):
    if n.mesh is not None: mesh_users.setdefault(n.mesh, []).append(ni)
for mi, users in mesh_users.items():
    for ni in users[1:]: g.meshes.append(copy.deepcopy(g.meshes[mi])); g.nodes[ni].mesh = len(g.meshes) - 1
IDS = any('lm' in extras(n) for n in g.nodes)
units = {}
for ni, n in enumerate(g.nodes):
    if n.mesh is None: continue
    for p in g.meshes[n.mesh].primitives:
        key = (p.attributes.POSITION, tuple(np.round(world(n).ravel(), 6)), extras(n).get('lm'))
        units.setdefault(key, []).append((ni, p))
keep, skipped, skip_ids = [], {'plant/glass': 0, 'ground/far': 0, 'movable': 0, 'dynamic': 0}, {}
for key, parts in units.items():
    lm, ex = key[2], extras(g.nodes[parts[0][0]])
    if IDS and ex.get('lmSkip') == 'movable':
        skipped['movable'] += 1
        for ni, _ in parts: g.nodes[ni].name = f'movable_{ni}'
        continue
    if IDS and not lm: skipped['dynamic'] += 1; continue
    if all(material_skip(p.material) for _, p in parts): skipped['plant/glass'] += 1; skip_ids[lm] = 'plant/glass'; continue
    M = world(g.nodes[parts[0][0]]); P = read(key[0]).astype(np.float64)
    W = (np.c_[P, np.ones(len(P))] @ M.T)[:, :3]
    # non-indexed parts draw their vertices in order
    idx = np.concatenate([read(p.indices).ravel() if p.indices is not None else np.arange(g.accessors[key[0]].count) for _, p in parts]).astype(np.uint32)
    tri = W[idx.reshape(-1, 3)]; area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1).sum()
    c = W.mean(0)
    if not IDS and movable(len(W), W.min(0), W.max(0)):
        skipped['movable'] += 1
        for ni, _ in parts: g.nodes[ni].name = f'movable_{ni}'
        continue
    if area > 300 or abs(c[0]) > 14 or -c[2] > 18 or -c[2] < -14: skipped['ground/far'] += 1; skip_ids[lm] = 'ground/far'; continue
    keep.append(dict(key=key, parts=parts, W=W.astype(np.float32), idx=idx, area=area))
print(f'units {len(units)}, ids {IDS}, kept {len(keep)}, skipped {skipped}, area {sum(u["area"] for u in keep):.0f} m2, {sum(len(u["idx"]) for u in keep) // 3} tris, {time.time() - t0:.0f} s')

# ---- unwrap and pack
# Texel density by class, by scaling each piece before packing (xatlas sizes charts by area): furniture gets the finest
# texels (crisp contact shading on small pieces), architecture medium, outdoor coarse. DENSITY scales all three.
def inside_plan(x, y):
    f = -5.94 if (x < -3.5 or x > 3.97) else -4.82
    return -8.1 <= x <= 8.1 and f <= y <= 5.62
def reuse(path):
    buf = open(path, 'rb').read(); n = struct.unpack('<I', buf[:4])[0]; old = json.loads(buf[4:4 + n]); base = 4 + n
    by = {u['id']: u for u in old['units'] if 'id' in u}
    new_ids = [u['key'][2] for u in keep]
    new = set(new_ids) - set(by)
    if len(by) != len(old['units']) or None in new_ids or len(new_ids) != len(set(new_ids)) or new:
        raise SystemExit(f'unit set changed ({len(old["units"])} old, {len(keep)} new, {len(new)} not in the old layout): unwrap again')
    gone = [u for u in old['units'] if u['id'] not in set(new_ids)]
    if gone: print(f'{len(gone)} units of the old layout are gone (their charts stay unused):', [(u['id'], u['vc'], u['min'], u['max']) for u in gone][:8])
    out = []
    for u in keep:
        o = by[u['key'][2]]; off = base + o['off']
        vmap = np.frombuffer(buf, np.uint32, o['nv'], off); nidx = np.frombuffer(buf, np.uint32, o['ni'], off + 4 * o['nv'])
        uv16 = np.frombuffer(buf, np.uint16, 2 * o['nv'], off + 4 * o['nv'] + 4 * o['ni']).reshape(-1, 2)
        W = u['W']
        same = o['vc'] == len(W) and o['ni'] == len(u['idx']) and np.array_equal(vmap[nidx], u['idx']) \
            and max(np.abs(np.array(o['min']) - W.min(0)).max(), np.abs(np.array(o['max']) - W.max(0)).max()) < 1e-3
        if not same: raise SystemExit(f'unit {u["key"][2]} changed: unwrap again')
        out.append((vmap.copy(), nidx.copy(), uv16.astype(np.float64) / 65535))
    print(f'reusing the layout of {path}: {len(out)} units identical, atlas {old["atlas"]}')
    return out, old['atlas']
SCALE = {'furniture': 2.5, 'architecture': 1.25, 'outdoor': 0.75}
TPU = float(sys.argv[5]) if len(sys.argv) > 5 else 64.0   # texels per metre
# Units too small to hold a few texels (switch-plate and outlet labels, 1 cm decals: 15 texel centres or fewer) bake no
# usable light: Cycles' rasteriser misses most of their centres and the fill finds no surface facing the same way. They
# take the probe volume at run time ("tiny" in the sidecar's skipped list), as plants and glass do.
MIN_TEXELS = 16
counts = {}; tiny = []
for u in keep:
    W = u['W']; size = W.max(0) - W.min(0); c = W.mean(0)
    k = 'outdoor' if not inside_plan(c[0], -c[2]) else ('architecture' if size.max() > 3.0 or u['area'] > 12 else 'furniture')
    u['class'] = k
    if u['area'] * (TPU * SCALE[k]) ** 2 < MIN_TEXELS: tiny.append(u)
    else: counts[k] = counts.get(k, 0) + 1
for u in tiny: skip_ids[u['key'][2]] = 'tiny'
keep = [u for u in keep if u not in tiny]
print(f'{len(tiny)} units under {MIN_TEXELS} texels left to the probes')
if REUSE: layout, ATLAS = reuse(REUSE)
atlas = xatlas.Atlas()
for u in keep:
    if not REUSE: atlas.add_mesh((u['W'] * SCALE[u['class']]).astype(np.float32), u['idx'].reshape(-1, 3))
print('classes', counts, 'scales', SCALE)
co = xatlas.ChartOptions(); po = xatlas.PackOptions()
po.resolution = RES; po.padding = 4; po.bilinear = True; po.texels_per_unit = TPU; po.bruteForce = False
if not REUSE:
    atlas.generate(co, po, verbose=False)
    print(f'atlas {atlas.width}x{atlas.height}, count {atlas.atlas_count}, utilisation {[round(atlas.get_utilization(i), 3) for i in range(atlas.atlas_count)]}, {time.time() - t0:.0f} s')
    if atlas.atlas_count > 1: print('WARNING: more than one atlas; raise the resolution')
    layout, ATLAS = None, [atlas.width, atlas.height]

# ---- write the Blender scene and the site sidecar
header = {'atlas': list(ATLAS), 'units': [], 'ownPrimitives': True}; chunks = []; offset = 0   # the site trusts shared-geometry units
if IDS: header['skipped'] = {k: v for k, v in skip_ids.items() if k}
for i, u in enumerate(keep):
    vmap, nidx, uvs = layout[i] if REUSE else atlas[i]
    vmap = vmap.astype(np.uint32); nidx = nidx.astype(np.uint32).ravel()
    pos_acc = u['key'][0]
    # every attribute of the unit's parts, re-ordered through vmap; TEXCOORD_1 is the lightmap
    first = u['parts'][0][1].attributes
    new_attr = {}
    for name in ('POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'COLOR_0'):
        ai = getattr(first, name)
        if ai is None: continue
        a = g.accessors[ai]; arr = read(ai)[vmap]
        if arr.dtype != np.float32: arr = arr.astype(np.float32)
        new_attr[name] = append(arr, 34962, 5126, a.type, minmax=(name == 'POSITION'))
    if 'TEXCOORD_0' not in new_attr: new_attr['TEXCOORD_0'] = append(np.zeros((len(vmap), 2), np.float32), 34962, 5126, 'VEC2')
    new_attr['TEXCOORD_1'] = append(uvs.astype(np.float32), 34962, 5126, 'VEC2')
    start = 0
    for ni, p in u['parts']:
        count = g.accessors[p.indices].count if p.indices is not None else g.accessors[pos_acc].count
        p.indices = append(nidx[start:start + count].astype(np.uint32), 34963, 5125, 'SCALAR'); start += count
        for k, v in new_attr.items(): setattr(p.attributes, k, v)
    W = u['W']
    rec = {'vc': int(len(W)), 'min': W.min(0).round(4).tolist(), 'max': W.max(0).round(4).tolist(), 'nv': int(len(vmap)), 'ni': int(len(nidx))}
    if u['key'][2]: rec['id'] = u['key'][2]
    uv16 = np.clip(np.round(uvs * 65535), 0, 65535).astype(np.uint16)
    for arr in (vmap, nidx, uv16): chunks.append(arr.tobytes())
    rec['off'] = offset; offset += vmap.nbytes + nidx.nbytes + uv16.nbytes
    header['units'].append(rec)
g.buffers[0].byteLength = len(blob)
g.set_binary_blob(bytes(blob))
g.save_binary(dst_glb)
hj = json.dumps(header).encode()
with open(dst_bin, 'wb') as f:
    f.write(struct.pack('<I', len(hj))); f.write(hj)
    for c in chunks: f.write(c)
print(f'wrote {dst_glb} and {dst_bin} ({offset / 1e6:.1f} MB of UV data), {time.time() - t0:.0f} s')
