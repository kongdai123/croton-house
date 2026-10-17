"""Python side of the spatial golden (web/tools/harness/spatial.mjs): every room / "inside the house" classifier the
bake scripts own, sampled on the same 5 cm lattice over the lot, as run-length label grids, plus the lamp group of each
switch the site exports. Pure Python: functions are lifted out of the Blender scripts by AST (as test_lamp_groups.py does) or
imported (reflprobe_layout.py), so nothing here needs bpy.

usage: python3 -I bake/scripts/capture_spatial.py [--switches switches.json] [--step-mm 50]   prints JSON on stdout
       python3 -I bake/scripts/capture_spatial.py --reflection-layout    the reflection probes reflprobe_layout.py would place now
                                                                          ([{i, p, min, max}], boxes null outdoors; three's frame as meta.json)
  switches.json: {"switches": [...]} in the shape bake/export/switch_groups.mjs writes (the harness builds it from the real scene)
"""
import ast, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bake/scripts'))
GRID = dict(x0=-16000, y0=-15000, step=50, nx=641, ny=701)   # mm, must equal GRID in web/tools/harness/spatial.mjs


def lift(path, names):
    """Module-level functions and assignments called `names` from a Blender script, executed in a bare namespace."""
    tree = ast.parse(Path(path).read_text())
    keep = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names
            or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets)]
    ns = {}
    exec(compile(ast.Module(body=keep, type_ignores=[]), str(path), 'exec'), ns)
    return ns


def encode(label, grid):
    raw = []
    values = set()
    for j in range(grid['ny']):
        y = (grid['y0'] + j * grid['step']) / 1000
        row = [str(label((grid['x0'] + i * grid['step']) / 1000, y)) for i in range(grid['nx'])]
        values.update(row); raw.append(row)
    labels = sorted(values)
    index = {v: k for k, v in enumerate(labels)}
    rows = []
    for row in raw:
        out = []; prev = -1; run = 0
        for v in row:
            k = index[v]
            if k == prev: run += 1
            else:
                if run: out += [prev, run]
                prev = k; run = 1
        out += [prev, run]; rows.append(out)
    return dict(labels=labels, rows=rows)


def js_bool(v):   # the JS side stringifies booleans as true/false
    return 'true' if v else 'false'


def main():
    args = sys.argv[1:]
    switches = None
    if '--switches' in args:
        switches = json.load(open(args[args.index('--switches') + 1]))['switches']
    grid = dict(GRID)
    if '--step-mm' in args:
        grid['step'] = int(args[args.index('--step-mm') + 1]); grid['nx'] = (32000 // grid['step']) + 1; grid['ny'] = (35000 // grid['step']) + 1
    if '--reflection-layout' in args:
        import reflprobe_layout as rl
        plan = rl.load_plan(str(ROOT / 'web/data/house.json'))
        out = []
        for i, p in enumerate(rl.points(plan)):
            b = rl.plan_box(plan, p)
            out.append(dict(i=i, p=[p[0], p[2], -p[1]], min=b['min'] if b else None, max=b['max'] if b else None))
        json.dump(out, sys.stdout); return
    lg = lift(ROOT / 'bake/scripts/lamp_groups.py', {'ROOMS', 'room', 'where', 'group_of', 'ORDER'})
    import reflprobe_layout as rl
    plan = rl.load_plan(str(ROOT / 'web/data/house.json'))
    import plan as planlib
    P = planlib.load(str(ROOT / 'web/data/plan.json'))
    unwrap = lift(ROOT / 'bake/scripts/unwrap.py', {'inside_plan'})
    setup = lift(ROOT / 'bake/export/setup.py', {'inside'})
    tasks = lift(ROOT / 'bake/scripts/make_tasks.py', {'inside'})
    C = [
        ('py:lamp_groups.room', 'bake/scripts/lamp_groups.py:24 room() (first of 13 rects, else outside)', lambda x, y: lg['room']([x, y, 0])),
        ('py:reflprobe_layout.inside_lot', 'bake/scripts/reflprobe_layout.py:24', lambda x, y: js_bool(rl.inside_lot(x, y))),
        ('py:reflprobe_layout.in_plan', 'bake/scripts/reflprobe_layout.py:79 (footprint polygon)', lambda x, y: js_bool(rl.in_plan(plan, x, y))),
        ('py:reflprobe_layout.annex_of', 'bake/scripts/reflprobe_layout.py:82 (ANNEX rect)', lambda x, y: rl.annex_of(x, y) or ''),
        ('py:reflprobe_layout.room_of', 'bake/scripts/reflprobe_layout.py:86 (annex, note areas, room polygons, plan, outside)', lambda x, y: rl.room_of(plan, x, y)),
        ('py:unwrap.inside_plan', 'bake/scripts/unwrap.py:125', lambda x, y: js_bool(unwrap['inside_plan'](x, y))),
        ('py:setup.inside', 'bake/export/setup.py:16', lambda x, y: js_bool(setup['inside'](x, y))),
        ('py:make_tasks.inside', 'bake/scripts/make_tasks.py:24', lambda x, y: js_bool(tasks['inside'](x, y))),
        # the plan model (bake/scripts/plan.py over web/data/plan.json), same answers as web/src/plan.js
        ('py:plan.space_at', 'bake/scripts/plan.py space_at (exact, empty in walls)', lambda x, y: (P.space_at(x, y) or {}).get('id', '')),
        ('py:plan.is_inside', 'bake/scripts/plan.py is_inside, default margin', lambda x, y: js_bool(P.is_inside(x, y))),
    ]
    out = {}
    for name, source, fn in C:
        out[name] = dict(source=source, **encode(fn, grid))
    groups = {}
    if switches is not None:
        for s in switches:
            try: groups[s['key']] = dict(room=lg['room'](lg['where'](s)), group=lg['group_of'](s), inOrder=lg['group_of'](s) in lg['ORDER'])
            except Exception as e: groups[s['key']] = dict(error=type(e).__name__)
    json.dump(dict(grid=grid, classifiers=out, lampGroups=groups, order=lg['ORDER']), sys.stdout, separators=(',', ':'))


if __name__ == '__main__':
    main()
