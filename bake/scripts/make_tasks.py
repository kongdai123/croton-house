# Fill tasks/pending with one bake task per (layer, group) for a time slot.
# usage: python3 scripts/make_tasks.py <slot> <groups> [samples] [version] [probes]
#   version: scene/<version>/scene_lm.blend -> bakes/<version>/<slot>/; the light probes (probe.py, 8 chunks per layer)
#   come along without a version, or with one when 'probes' is given (packed by probe_pack.py)
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slots import SLOTS
import plan as planlib
slot, G = sys.argv[1], int(sys.argv[2]); samples = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
VER = sys.argv[4] if len(sys.argv) > 4 else ''
SCENE = f'scene/{VER}/scene_lm.blend' if VER else 'scene/scene_lm.blend'
BAKES = f'bakes/{VER}' if VER else 'bakes'
WITH_PROBES = not VER or 'probes' in sys.argv[5:]
if slot not in SLOTS: raise SystemExit(f'unknown slot {slot}; choose {", ".join(SLOTS)}')
# New slots reuse the time-independent sunrise lamps. Explicit --layers can rebake them.
def option(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default
SCENE = option('--scene', SCENE if slot == 'sunrise' else SCENE.replace('scene_lm.blend', 'scene_lm_dry.blend'))
LAYERS = tuple(option('--layers', 'sky,sunind,lamps' if slot == 'sunrise' else 'sky,sunind').split(','))
if not set(LAYERS) <= {'sky', 'sunind', 'lamps'}: raise SystemExit('invalid --layers')
B = os.environ.get('BLENDER', 'blender')   # Blender 4.5 LTS
os.makedirs('tasks/pending', exist_ok=True)
import struct
with open(f'{BAKES}/lightmap_uv.bin', 'rb') as f: n = struct.unpack('<I', f.read(4))[0]; W, H = json.loads(f.read(n))['atlas']
# probe grid: 0.5 m inside the house, 1 m outside near it, at three heights a movable piece can stand at; "inside" is
# the plan's outline grown by its inside margin (plan.py, as the site's plan.js)
PLAN = planlib.load()
def inside(x, y):
    return PLAN.is_inside(x, y)
pts = []
for z in (0.35, 0.95, 1.55):
    for i in range(33):
        for j in range(24):
            x, y = -7.85 + 0.5 * i, -5.85 + 0.5 * j
            if inside(x, y): pts.append((x, y, z))
    for i in range(25):
        for j in range(27):
            x, y = -12 + i, -11 + j
            if not inside(x, y): pts.append((x, y, z))
json.dump({'points': [{'b': [round(x, 3), round(y, 3), z], 't': [round(x, 3), z, round(-y, 3)]} for x, y, z in pts]}, open('scene/probes.json', 'w'))
print('probes', len(pts))
PROBE_CHUNKS = 8
for layer in (LAYERS if WITH_PROBES else ()):
    for k in range(PROBE_CHUNKS):
        cfg = dict(SLOTS[slot], layer=layer, chunk=k, chunks=PROBE_CHUNKS, samples=256, probes='scene/probes.json', out=f'{BAKES}/{slot}/probes_{layer}_c{k:02d}.json')
        name = f'{VER + "_" if VER else ""}{slot}_probes_{layer}_c{k:02d}'
        if os.path.exists(cfg['out']) or os.path.exists(f'tasks/done/{name}'): continue
        with open(f'tasks/pending/{name}', 'w') as f:
            f.write(f"#!/bin/bash\n{B} -b --python-exit-code 1 {SCENE} -P scripts/probe.py -- '{json.dumps(cfg)}'\n")
for layer in LAYERS:
    for g in range(G):
        cfg = dict(SLOTS[slot], layer=layer, group=g, groups=G, samples=samples, size=[W, H], out=f'{BAKES}/{slot}/{layer}_g{g:02d}.exr')
        name = f'{VER + "_" if VER else ""}{slot}_{layer}_g{g:02d}'
        if os.path.exists(cfg['out']) or os.path.exists(f'tasks/done/{name}'): continue
        with open(f'tasks/pending/{name}', 'w') as f:
            f.write(f"#!/bin/bash\n{B} -b --python-exit-code 1 {SCENE} -P scripts/bake.py -- '{json.dumps(cfg)}'\n")
print('pending', len(os.listdir('tasks/pending')))
