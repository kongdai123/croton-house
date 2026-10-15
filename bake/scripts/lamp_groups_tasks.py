# Switchable baked lamps, step 2: one bake task per (lamp group, object group) and the group's light probes, into a task
# queue directory (cluster worker: each task file is a bash script run from the cluster root).
# usage: python3 scripts/lamp_groups_tasks.py <groups.json> <scene.blend> <out dir> <queue dir> <lightmap_uv.bin>
#        [--samples 4096] [--objgroups 8] [--probe-samples 128] [--chunks 4] [--reach 7] [--scripts DIR] [--probes PATH]
#   out dir: <out>/gNN/lamps_gKK.exr and probes_cKK.json per group (lamp_groups_pack.py merges them)
#   scripts DIR: a folder holding bake.py, probe.py, layer_lights.py, slots.py (each task runs from its parent)
# Every group bakes at unit level with the sunrise slot's lamp colour temperature (3000 K; no sun, no sky: layer lamps).
import argparse, json, os, struct
from slots import SLOTS
ap = argparse.ArgumentParser()
for a in ('groups', 'scene', 'out', 'queue', 'uv'): ap.add_argument(a)
ap.add_argument('--samples', type=int, default=4096); ap.add_argument('--objgroups', type=int, default=8)
ap.add_argument('--probe-samples', type=int, default=128); ap.add_argument('--chunks', type=int, default=4)
ap.add_argument('--reach', type=float, default=7.0); ap.add_argument('--scripts', default='scripts')
ap.add_argument('--probes', default='scene/probes.json')
args = ap.parse_args()
B = os.environ.get('BLENDER', 'blender')
groups = json.load(open(args.groups))['groups']
with open(args.uv, 'rb') as f: n = struct.unpack('<I', f.read(4))[0]; W, H = json.loads(f.read(n))['atlas']
os.makedirs(os.path.join(args.queue, 'pending'), exist_ok=True)
run = os.path.dirname(os.path.abspath(args.scripts)); scene = os.path.abspath(args.scene); out = os.path.abspath(args.out); probes = os.path.abspath(args.probes)
base = dict(SLOTS['sunrise'], layer='lamps')
def task(name, script, cfg):
    path = os.path.join(args.queue, 'pending', name)
    if os.path.exists(cfg['out']): return 0
    with open(path, 'w') as f:
        f.write(f"#!/bin/bash\ncd {run} && {B} -b --python-exit-code 1 {scene} -P {os.path.basename(args.scripts)}/{script} -- '{json.dumps(cfg)}'\n")
    return 1
count = 0
for g in groups:
    i = g['index']; d = os.path.join(out, f'g{i:02d}'); os.makedirs(d, exist_ok=True)
    for k in range(args.objgroups):
        count += task(f'a_g{i:02d}_k{k:02d}', 'bake.py', dict(base, lampGroup=i, group=k, groups=args.objgroups, samples=args.samples, size=[W, H], out=f'{d}/lamps_g{k:02d}.exr'))
for g in groups:
    i = g['index']; d = os.path.join(out, f'g{i:02d}'); near = [L['p'] for L in g['lights']]
    for k in range(args.chunks):
        count += task(f'b_g{i:02d}_c{k:02d}', 'probe.py', dict(base, lampGroup=i, chunk=k, chunks=args.chunks, samples=args.probe_samples, probes=probes,
                                                             near=near, maxDist=args.reach, out=f'{d}/probes_c{k:02d}.json'))
print('queued', count, 'tasks in', args.queue)
