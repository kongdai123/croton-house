# The light-probe grid (make_tasks.py writes it to scene/probes.json; probe.py renders it; probe_pack.py packs it in this
# order, the runtime reads the positions from probes.bin). Pure Python (plan.py), so the grid can be checked without Blender:
#   python3 bake/scripts/probe_grid.py [web/data/plan.json]   prints the counts and the points left out
# Points: 0.5 m inside the house, 1 m outside near it, at three heights a movable piece can stand at; "inside" is the
# plan's outline grown by its inside margin (plan.py, as the site's plan.js).
# Solid: a point inside a plan wall piece at its height (grown by SOLID_PAD, so a point on a face counts) or in the stucco
# skin outside an exterior piece is flagged 'solid' and never rendered (probe.py writes it invalid, as its ray test does
# for points inside other geometry). That ray test alone let probe 668 through: (7.65, -5.85, 0.35) lies 0.3 mm inside
# bedroom 3's south wall, a face away from the outside, and was baked and shipped as valid (bake QA probes-walls).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan as planlib

HEIGHTS = (0.35, 0.95, 1.55)
SOLID_PAD = 0.003  # metres around every wall piece (a point on a face is in it)
SKIN = 0.15        # the exterior stucco skin (house.js skinRect), outside every exterior piece


def solid_rects(plan, z):
    """(x0, x1, y0, y1) of what is solid at height z: the plan's wall pieces there (openings excluded), grown by SOLID_PAD,
    and the stucco skin on the outer side of each exterior piece."""
    out = []
    for p in plan.walls_at(z):
        x0, x1, y0, y1 = p['x0'], p['x1'], p['y0'], p['y1']
        out.append((x0 - SOLID_PAD, x1 + SOLID_PAD, y0 - SOLID_PAD, y1 + SOLID_PAD))
        if not p.get('exterior'): continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if p['dir'] == 'H':   # the skin is on the side that is outside the outline (house.js skinRect)
            out.append((x0, x1, y1, y1 + SKIN + SOLID_PAD) if not plan.is_inside(cx, cy + 0.2, 0) else (x0, x1, y0 - SKIN - SOLID_PAD, y0))
        else:
            out.append((x1, x1 + SKIN + SOLID_PAD, y0, y1) if not plan.is_inside(cx + 0.2, cy, 0) else (x0 - SKIN - SOLID_PAD, x0, y0, y1))
    return out


def solid_at(rects, x, y):
    return any(x0 < x < x1 and y0 < y < y1 for x0, x1, y0, y1 in rects)


def points(plan):
    """[(x, y, z, solid)] in the order probes.json keeps them (plan frame)."""
    pts = []
    for z in HEIGHTS:
        rects = solid_rects(plan, z)
        for i in range(33):
            for j in range(24):
                x, y = -7.85 + 0.5 * i, -5.85 + 0.5 * j
                if plan.is_inside(x, y): pts.append((x, y, z, solid_at(rects, x, y)))
        for i in range(25):
            for j in range(27):
                x, y = -12 + i, -11 + j
                if not plan.is_inside(x, y): pts.append((x, y, z, solid_at(rects, x, y)))
    return pts


def probes_json(plan):
    """scene/probes.json: per point its Blender ('b') and three ('t') position, and 'solid' where it is never rendered."""
    out = []
    for x, y, z, solid in points(plan):
        rec = {'b': [round(x, 3), round(y, 3), z], 't': [round(x, 3), z, round(-y, 3)]}
        if solid: rec['solid'] = True
        out.append(rec)
    return {'points': out}


if __name__ == '__main__':
    P = planlib.load(sys.argv[1] if len(sys.argv) > 1 else None)
    pts = points(P)
    print(f'{len(pts)} probes, {sum(p[3] for p in pts)} solid (never rendered):')
    for k, (x, y, z, s) in enumerate(pts):
        if s: print(f'  {k:4d} ({x:6.2f}, {y:6.2f}, h {z})')
