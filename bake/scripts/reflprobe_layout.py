# Reflection probe layout: where the probes stand and the parallax box each one projects onto. Pure Python (no Blender),
# shared by reflprobe.py and its CPU check; run it to print the layout against the floor plan:
#   python3 bake/scripts/reflprobe_layout.py web/data/house.json
# Coordinates: plan x east, y north, z up (Blender's frame); the boxes are written in three's frame (x east, y up,
# z south), as lightmap.js loadReflections reads them.
#
# Points: a 3.4 m grid indoors, the patio, garden, front and sides outdoors, then fixes where a grid point fell in or
# against a wall (POINT_FIX). Every point is checked against the plan's walls (house.json pieces at the probe's height)
# and moved to the nearest spot with WALL_CLEARANCE when it is too close, so a later plan change cannot put a probe
# inside a partition again (probe 9 sat in the living / front-bedroom wall: 66% of its panorama was black).
# Boxes: inside the plan footprint the box is the room around the probe from the plan alone (walls with their doors and
# windows closed, floor to ceiling), so furniture, door gaps and glass do not shape it: a fan of parallel rays per side,
# the 30th-percentile distance (a doorway beside the probe is ignored, an open-plan side is not). The garage and the
# grounds are not in the plan: their boxes come from scene raycasts (reflprobe.py), through glass and cloth.
import json, math, sys

PROBE_Z = 1.3
WALL_CLEARANCE = 0.45   # metres from any wall face at probe height
FAN = (-0.6, -0.4, -0.2, 0.0, 0.2, 0.4, 0.6)
QUANTILE = 0.3
MAX_RAY = 30.0


def inside_lot(x, y):
    f = -5.94 if (x < -3.5 or x > 3.97) else -4.82
    return -8.1 <= x <= 8.1 and f <= y <= 5.62


GRID = [(x, y) for x in (-6.2, -2.8, 0.6, 4.0, 6.8) for y in (-3.6, 0.0, 3.6) if inside_lot(x, y)]
OUTDOOR = [(-5, 8), (0, 8), (5, 8), (-6, 12.5), (0, 12.5), (6, 12.5), (-5, -8.5), (0, -8.5), (5, -8.5), (10.5, 0), (-10.5, 0)]
# Grid points moved to the room they are meant for (index: why). The x = 4.0 column runs along the partition between
# the great room and the east wing; the others sat a few centimetres from a wall.
POINT_FIX = {
    (-6.2, 0.0): (-5.7, -1.3),    # 1: against the garage's north wall (box 0.4 m tall): the garage's inner half
    (-6.2, 3.6): (-6.95, 4.2),    # 2: 19 cm from the primary bath's east wall: the bath's middle, before its mirror
    (4.0, -3.6): (3.3, -3.6),     # 9: inside the living / front-bedroom partition: the living room's east end
    (4.0, 0.0): (4.54, -0.65),    # 10: in the hall's doorway jamb: the middle of the hall
    (4.0, 3.6): (2.55, 3.6),      # 11: in the dining room's east wall: the dining room
    (6.8, 0.0): (6.5, -0.53),     # 13: 12 cm from the hall bath's mirror cabinet: the middle of the hall bath
}
EXTRA = [(6.5, 1.07)]             # 26: bath B had no probe (its mirror reflected the hall bath)
# Rooms the plan does not draw (web/src/house.js GARAGE, buildAnnex): the garage, its sectional door raised; its box
# stops at the walls and the door's plane (scene raycasts ran out through the open door and stopped on the table).
ANNEX = {'garage': (-7.903, -3.507, -5.735, 0.156)}


def load_plan(path):
    return json.load(open(path))


def walls_at(plan, z):
    """Wall pieces (solid, lintel, sill) that stand at height z, as (x0, x1, y0, y1)."""
    return [(p['x0'], p['x1'], p['y0'], p['y1']) for p in plan['pieces'] if p['z0'] <= z <= p['z1']]


def full_walls(plan):
    """Every wall with its openings closed: the room boundary a reflection box follows."""
    return [(w['x0'], w['x1'], w['y0'], w['y1']) for w in plan['walls']]


def wall_distance(rects, x, y):
    best = math.inf
    for x0, x1, y0, y1 in rects:
        dx = max(x0 - x, 0.0, x - x1); dy = max(y0 - y, 0.0, y - y1); best = min(best, math.hypot(dx, dy))
    return best


def point_in_polygon(x, y, poly):
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c


def in_plan(plan, x, y):
    return point_in_polygon(x, y, plan['footprint'])


def annex_of(x, y):
    return next((name for name, (x0, x1, y0, y1) in ANNEX.items() if x0 <= x <= x1 and y0 <= y <= y1), None)


def room_of(plan, x, y):
    if annex_of(x, y): return annex_of(x, y)
    for n in plan.get('notes', []):
        if n.get('area') and point_in_polygon(x, y, n['area']): return n['label']
    for r in plan['rooms']:
        if point_in_polygon(x, y, r['pts']): return 'room ' + r['id']
    return 'plan' if in_plan(plan, x, y) else 'outside'


def clear(plan, x, y, need=WALL_CLEARANCE, z=PROBE_Z):
    """Move (x, y) to the nearest point at least `need` from every wall face at height z (searched outward on a 5 cm
    grid up to 1.5 m); points outside the plan are returned unchanged (reflprobe.py checks them in the scene)."""
    a = annex_of(x, y)
    if a:
        x0, x1, y0, y1 = ANNEX[a]; d = min(x - x0, x1 - x, y - y0, y1 - y)
        if d < need: raise SystemExit(f'reflection probe ({x}, {y}) is {d:.2f} m from the {a} walls: move it in POINT_FIX')
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


def points(plan=None):
    """The probe points [(x, y, z)] in order (the index is the probe's id in meta.json and its file name)."""
    pts = [POINT_FIX.get(p, p) for p in GRID] + OUTDOOR + EXTRA
    out = []
    for x, y in pts:
        if plan is not None:
            nx, ny, _ = clear(plan, x, y)
            if (nx, ny) != (x, y): print(f'reflection probe ({x}, {y}) is within {WALL_CLEARANCE} m of a wall: moved to ({nx}, {ny})', flush=True)
            x, y = nx, ny
        out.append((float(x), float(y), PROBE_Z))
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
    """The box for a probe inside the plan footprint or an ANNEX room: the room from the walls, floor to ceiling. None
    outside (reflprobe.py raycasts the scene)."""
    x, y, z = p; ceil = float(plan.get('ceiling', 2.44)); a = annex_of(x, y)
    if a:
        x0, x1, y0, y1 = ANNEX[a]
        return box(p, [round(v, 3) for v in (x1 - x, x - x0, y1 - y, y - y0, ceil - z, z)])
    if not in_plan(plan, x, y): return None
    e = plan_extents(plan, x, y)
    return box(p, [round(v, 3) for v in e] + [round(ceil - z, 3), round(z, 3)])


if __name__ == '__main__':
    plan = load_plan(sys.argv[1] if len(sys.argv) > 1 else 'web/data/house.json')
    for i, p in enumerate(points(plan)):
        b = plan_box(plan, p); rects = walls_at(plan, p[2])
        where = room_of(plan, p[0], p[1]); clearance = wall_distance(rects, p[0], p[1]) if in_plan(plan, p[0], p[1]) else None
        if b: span = f"x {b['min'][0]:6.2f}..{b['max'][0]:6.2f}  y(north) {-b['max'][2]:6.2f}..{-b['min'][2]:6.2f}  h 0..{b['max'][1]:.2f}"
        else: span = 'scene raycasts'
        print(f'{i:2d} ({p[0]:6.2f}, {p[1]:6.2f})  {where:18s} clear {clearance if clearance is None else round(clearance, 2)!s:5s} {span}')
