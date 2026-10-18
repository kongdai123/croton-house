# Gate (c): Cycles references through the gate's cameras, one Blender session per slot (the scene loads once).
# usage: blender -b <scene.blend> --python-exit-code 1 -P validate/cycles_refs.py -- '<json>'
# json: {"cameras": "cameras.json", "state": "sunrise" | "noon" | "golden" | "dusk_allon", "out": "<cycles dir>",
#        "render_py": "<the scene's export/render.py>", "res": [960, 540], "samples": 256, "only": [ids], "limit": n}
# Writes <out>/<state>/<camera>.png and <camera>.json (its cache key). The key hashes the .blend (size and mtime),
# render.py, this script, the slot config, the camera and the render settings: a frame whose key matches is skipped,
# so a rerun after a scene change renders only what changed (all of it, after a rebake's new scene).
# Lamps: render.py sets every lamp at the slot's level (sunrise 0.25, noon 0, golden 0.7, dusk 1), which is the site's
# all-switches-on state at that level, not its per-slot default switches: compare dusk_allon with "dusk_allon"; the
# daytime slots differ from the site where a default-off lamp group lights a room (compare.py treats Cycles as advisory).
# Scenes (bake/REBAKE.md step 3): sunrise scene.blend (wet), noon and golden scene_dry.blend, dusk_allon
# scene_dusk.blend (sheers drawn) where it exists, else scene_dry.blend.
import bpy, sys, json, os, hashlib, time

arg = sys.argv[sys.argv.index('--') + 1]
cfg = json.load(open(arg)) if arg.endswith('.json') else json.loads(arg)
state = cfg['state']; slot = state.split('_')[0]
cams = json.load(open(cfg['cameras']))['cameras']
if cfg.get('only'): cams = [c for c in cams if c['id'] in cfg['only']]
if cfg.get('limit'): cams = cams[:cfg['limit']]
res, samples = cfg.get('res', [960, 540]), cfg.get('samples', 256)
out = os.path.join(cfg['out'], state); os.makedirs(out, exist_ok=True)
render_py = cfg['render_py']
blend = bpy.data.filepath; st = os.stat(blend)
base = hashlib.sha1()
for part in (f'{os.path.basename(blend)}:{st.st_size}:{int(st.st_mtime)}', open(render_py).read(), open(os.path.abspath(__file__)).read(),
             json.dumps({'slot': slot, 'res': res, 'samples': samples}, sort_keys=True)):
    base.update(part.encode())
key = lambda c: hashlib.sha1(base.hexdigest().encode() + json.dumps(c, sort_keys=True).encode()).hexdigest()[:16]
todo = []
for c in cams:
    kp = os.path.join(out, c['id'] + '.json')
    if os.path.exists(os.path.join(out, c['id'] + '.png')) and os.path.exists(kp) and json.load(open(kp)).get('key') == key(c): continue
    todo.append(c)
print(f'cycles_refs {state}: {len(cams) - len(todo)} cached, {len(todo)} to render')
if not todo: sys.exit(0)

sc = bpy.context.scene
sc.cycles.use_denoising = True
try: sc.cycles.denoiser = 'OPTIX'
except TypeError: pass
cam_cfg = lambda c: {k: c[k] for k in ('x', 'y', 'z', 'h', 'p', 'lens')}
# the first camera through render.py itself: world, sun, sky, lamps at the slot's level, fixed exposure (slot ev)
first = todo[0]
job = {'slot': slot, 'cam': cam_cfg(first), 'res': res, 'samples': samples, 'out': os.path.join(out, first['id'] + '.png')}
if state.endswith('_allon'): job['lamps'] = 1.0
ns = {'__file__': render_py, '__name__': '__render__'}
argv = sys.argv; sys.argv = [argv[0], '--', json.dumps(job)]
t0 = time.time()
exec(compile(open(render_py).read(), render_py, 'exec'), ns)
sys.argv = argv
json.dump({'key': key(first), 'seconds': round(time.time() - t0, 1)}, open(os.path.join(out, first['id'] + '.json'), 'w'))
# the others: only the camera moves (the same transform as render.py)
import math
cam = sc.camera
for c in todo[1:]:
    cam.location = (c['x'], c['y'], c.get('z', 1.45))
    cam.rotation_euler = (math.radians(90) + c.get('p', 0), 0, -math.radians(c['h']))
    cam.data.lens = c.get('lens', 24)
    t0 = time.time()
    ns['render'](os.path.join(out, c['id'] + '.png'), 100, samples)
    json.dump({'key': key(c), 'seconds': round(time.time() - t0, 1)}, open(os.path.join(out, c['id'] + '.json'), 'w'))
    print(f'RENDERED {c["id"]} in {time.time() - t0:.0f} s', flush=True)
