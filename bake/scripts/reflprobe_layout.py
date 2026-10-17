# Reflection probe layout: where the probes stand and the parallax box each one projects onto. Pure Python (no Blender),
# shared by reflprobe.py and its CPU check; run it to print the layout against the plan model (plan.py, plan.json):
#   python3 bake/scripts/reflprobe_layout.py [web/data/plan.json]
# Coordinates: plan x east, y north, z up (Blender's frame); the boxes are written in three's frame (x east, y up,
# z south), as lightmap.js loadReflections reads them.
#
# Points: a 3.4 m grid indoors, the patio, garden, front and sides outdoors, then the plan's per-room seeds (spaces'
# reflProbe: where a grid point fell in or against a wall, and extra rooms). Every point is checked against the plan's
# wall pieces at the probe's height (patches applied, annex included)
# and moved to the nearest spot with WALL_CLEARANCE when it is too close, so a later plan change cannot put a probe
# inside a partition again (probe 9 sat in the living / front-bedroom wall: 66% of its panorama was black).
# Boxes: inside the plan footprint the box is the room around the probe from the plan alone (walls with their doors and
# windows closed, floor to ceiling), so furniture, door gaps and glass do not shape it: a fan of parallel rays per side,
# the 30th-percentile distance (a doorway beside the probe is ignored, an open-plan side is not). Spaces marked
# reflBox "bbox" (the garage, its sectional door raised: scene raycasts ran out through the open door) take their
# bbox. The grounds' boxes come from scene raycasts (reflprobe.py), through glass and cloth.
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan as planlib

PROBE_Z = 1.3
WALL_CLEARANCE = 0.45   # metres from any wall face at probe height
FAN = (-0.6, -0.4, -0.2, 0.0, 0.2, 0.4, 0.6)
QUANTILE = 0.3
MAX_RAY = 30.0


GRID = [(x, y) for x in (-6.2, -2.8, 0.6, 4.0, 6.8) for y in (-3.6, 0.0, 3.6)]
OUTDOOR = [(-5, 8), (0, 8), (5, 8), (-6, 12.5), (0, 12.5), (6, 12.5), (-5, -8.5), (0, -8.5), (5, -8.5), (10.5, 0), (-10.5, 0)]


def load_plan(path=None):
    """The plan model (plan.py); path = plan.json, default as plan.py finds it."""
    P = planlib.load(str(path) if path else None)
    if 'spaces' not in P.data: raise SystemExit(f'{path}: not a plan.json (house.json is only the Zillow import now)')
    return P


def seeds(plan):
    """The plan's per-room probe seeds: {grid point: where it moves} and the extra points, in plan order."""
    fix, extra = {}, []
    for s in plan.spaces:
        for r in s.get('reflProbe', []):
            if 'replaces' in r: fix[tuple(r['replaces'])] = tuple(r['at'])
            else: extra.append(tuple(r['at']))
    return fix, extra


def walls_at(plan, z):
    """Wall pieces (solid, lintel, sill) that stand at height z, as (x0, x1, y0, y1)."""
    return [(p['x0'], p['x1'], p['y0'], p['y1']) for p in plan.walls_at(z)]


def full_walls(plan):
    """Every wall with its openings closed: the room boundary a reflection box follows."""
    return [(w['x0'], w['x1'], w['y0'], w['y1']) for w in plan.walls]


def wall_distance(rects, x, y):
    best = math.inf
    for x0, x1, y0, y1 in rects:
        dx = max(x0 - x, 0.0, x - x1); dy = max(y0 - y, 0.0, y - y1); best = min(best, math.hypot(dx, dy))
    return best


def in_plan(plan, x, y):
    """Under the roof (the plan's outline): the box comes from the walls (or the space's bbox)."""
    return plan.is_inside(x, y, 0)


def annex_of(plan, x, y):
    """The space at (x, y) whose box is its bbox (reflBox 'bbox': the garage), or None."""
    s = plan.space_at(x, y)
    return s['id'] if s and s.get('reflBox') == 'bbox' else None


def room_of(plan, x, y):
    s = plan.space_at(x, y, 0.3)
    return s['id'] if s else 'plan' if in_plan(plan, x, y) else 'outside'


def clear(plan, x, y, need=WALL_CLEARANCE, z=PROBE_Z):
    """Move (x, y) to the nearest point at least `need` from every wall face at height z (searched outward on a 5 cm
    grid up to 1.5 m); points outside the plan are returned unchanged (reflprobe.py checks them in the scene)."""
    a = annex_of(plan, x, y)
    if a:
        b = plan.rect_of(a); d = min(x - b['x0'], b['x1'] - x, y - b['y0'], b['y1'] - y)
        if d < need: raise SystemExit(f'reflection probe ({x}, {y}) is {d:.2f} m from the {a} walls: move it (a reflProbe seed in plan_overlay.json)')
        return x, y, d
    if not in_plan(plan, x, y): return x, y, None
    rects = walls_at(plan, z)
    d0 = wall_distance(rects, x, y)
    if d0 >= need: return x, y, d0
    best = None
    for r in range(1, 31):
        for i in range(-r, r + 1):
            for j in range(-r, r + 1):
                if max(abs(i), abs(j)) != r: continue
                px, py = x + 0.05 * i, y + 0.05 * j
                if not in_plan(plan, px, py): continue
                d = wall_distance(rects, px, py)
                if d >= need:
                    cand = (math.hypot(px - x, py - y), -d, round(px, 3), round(py, 3))
                    if best is None or cand < best: best = cand
        if best: return best[2], best[3], -best[1]
    raise SystemExit(f'reflection probe at ({x}, {y}) has no spot {need} m clear of the walls within 1.5 m')


def points(plan):
    """The probe points [(x, y, z)] in order (the index is the probe's id in meta.json and its file name): the grid
    points inside the house (seeds applied), the outdoor points, then the extra seeds."""
    fix, extra = seeds(plan)
    pts = [fix.get(p, p) for p in GRID if plan.is_inside(*p)] + OUTDOOR + extra
    out = []
    for x, y in pts:
        nx, ny, _ = clear(plan, x, y)
        if (nx, ny) != (x, y): print(f'reflection probe ({x}, {y}) is within {WALL_CLEARANCE} m of a wall: moved to ({nx}, {ny})', flush=True)
        out.append((float(nx), float(ny), PROBE_Z))
    return out


def ray_rect(x, y, dx, dy, r):
    """Distance along (dx, dy) from (x, y) to rectangle r, or None (slab test; a start inside counts as 0)."""
    x0, x1, y0, y1 = r; t0, t1 = -math.inf, math.inf
    for o, d, lo, hi in ((x, dx, x0, x1), (y, dy, y0, y1)):
        if abs(d) < 1e-12:
            if o < lo or o > hi: return None
        else:
            a, b = (lo - o) / d, (hi - o) / d
            t0, t1 = max(t0, min(a, b)), min(t1, max(a, b))
    if t1 < max(t0, 0.0): return None
    return max(t0, 0.0)


def cast(rects, x, y, dx, dy):
    ts = [t for t in (ray_rect(x, y, dx, dy, r) for r in rects) if t is not None]
    return min(ts) if ts else MAX_RAY


def plan_extents(plan, x, y):
    """Distances to the room boundary toward +x, -x, +y, -y: a fan of parallel rays per side (offsets limited to the
    probe's own clearance sideways), the QUANTILE-th distance of the fan."""
    rects = full_walls(plan); out = []
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        px, py = -dy, dx   # sideways
        side = (cast(rects, x, y, px, py), cast(rects, x, y, -px, -py))
        ds = []
        for o in FAN:
            if (o > 0 and o > side[0] - 0.05) or (o < 0 and -o > side[1] - 0.05): continue
            ds.append(cast(rects, x + px * o, y + py * o, dx, dy))
        ds.sort(); out.append(ds[min(len(ds) - 1, int(round(QUANTILE * (len(ds) - 1))))])
    return out


def box(p, ext):
    """meta.json entry body from a plan point and its extents (x+, x-, north+, north-, up, down), in three's frame."""
    x, y, z = p
    return {'p': [x, z, -y], 'min': [x - ext[1], z - ext[5], -y - ext[2]], 'max': [x + ext[0], z + ext[4], -y + ext[3]]}


def plan_box(plan, p):
    """The box for a probe under the roof: its space's bbox (reflBox 'bbox') or the room from the walls, floor to
    ceiling. None outside (reflprobe.py raycasts the scene)."""
    x, y, z = p; ceil = float(plan.levels['ceiling']); a = annex_of(plan, x, y)
    if a:
        b = plan.rect_of(a); x0, x1, y0, y1 = b['x0'], b['x1'], b['y0'], b['y1']
        return box(p, [round(v, 3) for v in (x1 - x, x - x0, y1 - y, y - y0, ceil - z, z)])
    if not in_plan(plan, x, y): return None
    e = plan_extents(plan, x, y)
    return box(p, [round(v, 3) for v in e] + [round(ceil - z, 3), round(z, 3)])


if __name__ == '__main__':
    plan = load_plan(sys.argv[1] if len(sys.argv) > 1 else None)
    for i, p in enumerate(points(plan)):
        b = plan_box(plan, p); rects = walls_at(plan, p[2])
        where = room_of(plan, p[0], p[1]); clearance = wall_distance(rects, p[0], p[1]) if in_plan(plan, p[0], p[1]) else None
        if b: span = f"x {b['min'][0]:6.2f}..{b['max'][0]:6.2f}  y(north) {-b['max'][2]:6.2f}..{-b['min'][2]:6.2f}  h 0..{b['max'][1]:.2f}"
        else: span = 'scene raycasts'
        print(f'{i:2d} ({p[0]:6.2f}, {p[1]:6.2f})  {where:18s} clear {clearance if clearance is None else round(clearance, 2)!s:5s} {span}')
