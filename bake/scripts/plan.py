"""The plan model of the house (web/data/plan.json, built by web/tools/build_plan.mjs), for the bake: which room a point
is in, whether it is inside the house, which walls stand where, how rooms connect. Stdlib only, so it runs in Blender's
Python and in python3. Same API and arithmetic as web/src/plan.js (+ plan_geom.js); both must reproduce
web/tools/golden/plan_vectors.json (bake/scripts/test_plan.py, web/tools/test_plan.mjs).
Plan frame: x east, y north, z up, metres (= Blender world). three.js scene = [x, z, -y].

plan.json is found at $CROTON_PLAN, else next to this file (the cluster's scripts/ copy), else in the repo's web/data/.
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = [os.path.join(HERE, 'plan.json'), os.path.join(HERE, '..', '..', 'web', 'data', 'plan.json')]


def find_plan():
    for p in ([os.environ['CROTON_PLAN']] if os.environ.get('CROTON_PLAN') else []) + CANDIDATES:
        if os.path.exists(p): return p
    raise SystemExit('plan.json not found: set CROTON_PLAN or copy web/data/plan.json next to bake/scripts/plan.py')


def jround(v):   # JavaScript Math.round
    return math.floor(v + 0.5)


def q4(v): return jround(v * 1e4) / 1e4


# ---- rectilinear polygon helpers (plan_geom.js) ----------------------------------------------------------------------------
def bbox(P):
    xs = [p[0] for p in P]; ys = [p[1] for p in P]
    return dict(x0=min(xs), x1=max(xs), y0=min(ys), y1=max(ys))


def on_boundary(x, y, P):
    j = len(P) - 1
    for i in range(len(P)):
        ax, ay = P[j]; bx, by = P[i]; j = i
        if ax == bx:
            if x == ax and min(ay, by) <= y <= max(ay, by): return True
        elif y == ay and min(ax, bx) <= x <= max(ax, bx): return True
    return False


def in_poly(x, y, P):
    c = False; j = len(P) - 1
    for i in range(len(P)):
        xi, yi = P[i]; xj, yj = P[j]; j = i
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
    return c or on_boundary(x, y, P)


def _edge_d(x, y, a, b):
    ax, ay = a; bx, by = b
    return max(min(ax, bx) - x, 0, x - max(ax, bx)), max(min(ay, by) - y, 0, y - max(ay, by))


def chebyshev(x, y, P):
    best = math.inf; j = len(P) - 1
    for i in range(len(P)):
        dx, dy = _edge_d(x, y, P[j], P[i]); j = i
        best = min(best, max(dx, dy))
    return best


def dist(x, y, P):
    if in_poly(x, y, P): return 0
    best = math.inf; j = len(P) - 1
    for i in range(len(P)):
        dx, dy = _edge_d(x, y, P[j], P[i]); j = i
        best = min(best, math.sqrt(dx * dx + dy * dy))
    return best


def _sign(v): return (v > 0) - (v < 0)


def offset(P, m):
    n = len(P); k = jround(m * 1e4); I = [(jround(x * 1e4), jround(y * 1e4)) for x, y in P]; out = []
    for i in range(n):
        a, b, c = I[i - 1], I[i], I[(i + 1) % n]
        s1 = (_sign(b[1] - a[1]) * k, -_sign(b[0] - a[0]) * k); s2 = (_sign(c[1] - b[1]) * k, -_sign(c[0] - b[0]) * k)
        x = b[0] + s1[0] if a[0] == b[0] else b[0] + s2[0]
        y = b[1] + s1[1] if a[1] == b[1] else b[1] + s2[1]
        out.append((x / 1e4, y / 1e4))
    return out


def rects(P):
    xs = sorted(set(p[0] for p in P)); out = []; prev = []
    for s in range(len(xs) - 1):
        xm = (xs[s] + xs[s + 1]) / 2; ys = []; j = len(P) - 1
        for i in range(len(P)):
            if P[i][1] == P[j][1] and min(P[i][0], P[j][0]) < xm < max(P[i][0], P[j][0]): ys.append(P[i][1])
            j = i
        ys.sort(); spans = [(ys[k], ys[k + 1]) for k in range(0, len(ys) - 1, 2)]
        if len(spans) == len(prev) and all(sp[0] == r['y0'] and sp[1] == r['y1'] for sp, r in zip(spans, prev)):
            for r in prev: r['x1'] = xs[s + 1]
        else:
            prev = [dict(x0=xs[s], x1=xs[s + 1], y0=a, y1=b) for a, b in spans]; out += prev
    return out


def glsl_num(v):   # plan_geom.js glslNum: shortest round-trip text (repr == JavaScript String here), with a decimal point
    s = repr(q4(v))
    return s if ('.' in s or 'e' in s) else s + '.0'


def smoothstep(v, a, b):
    if v <= a: return 0
    if v >= b: return 1
    t = (v - a) / (b - a); return t * t * (3 - 2 * t)


def to_scene(x, y, z=0): return [x, z, -y]


def to_plan(sx, sy, sz): return [sx, -sz, sy]


class Plan:
    def __init__(self, data):
        self.data = data; self.levels = data['levels']; self.outline = data['outline']
        self.spaces = data['spaces']; self.walls = data['walls']; self.openings = data['openings']; self.pieces = data['pieces']
        ent = [(s, bbox(s['polygon']), s['kind'] == 'yard') for s in self.spaces]
        self._all = ent; self._ordered = [e for e in ent if not e[2]] + [e for e in ent if e[2]]
        self._by_id = {s['id']: s for s in self.spaces}; self._openings = {o['id']: o for o in self.openings}
        self._rects = {}

    def space(self, id): return self._by_id.get(id)

    @staticmethod
    def _hit(e, x, y):
        b = e[1]
        return b['x0'] <= x <= b['x1'] and b['y0'] <= y <= b['y1'] and in_poly(x, y, e[0]['polygon'])

    def space_at(self, x, y, near=0):
        """The space containing (x, y) (boundary inclusive), or None in a wall, doorway or seam; near > 0: else the
        closest room / zone within that distance."""
        for e in self._ordered:
            if self._hit(e, x, y): return e[0]
        if not near > 0: return None
        best = None; bd = near
        for s, b, yard in self._all:
            if yard or x < b['x0'] - bd or x > b['x1'] + bd or y < b['y0'] - bd or y > b['y1'] + bd: continue
            d = dist(x, y, s['polygon'])
            if d <= bd and (best is None or d < bd): best = s; bd = d
        return best

    def room_name(self, x, y):
        s = self.space_at(x, y, 0.3 if self.is_inside(x, y, 0) else 0)
        if s: return dict(id=s['id'], en=s['label']['en'], zh=s['label']['zh'], outside=s['zone'] == 'exterior')
        return dict(id=None, en='Outside', zh='室外', outside=True)

    def rect_of(self, id):
        s = self.space(id); return bbox(s['polygon']) if s else None

    # ---- inside the house
    def inside_rects(self, margin=None):
        if margin is None: margin = self.outline['insideMargin']
        if margin not in self._rects:
            P = self.outline['polygon']
            self._rects[margin] = rects(offset(P, margin) if margin else P)
        return self._rects[margin]

    def is_inside(self, x, y, margin=None):
        for r in self.inside_rects(margin):
            if r['x0'] <= x <= r['x1'] and r['y0'] <= y <= r['y1']: return True
        return False

    def inside_glsl(self, name='outsideHouse', margin=None):
        n = glsl_num
        t = [f"(p.x >= {n(r['x0'])} && p.x <= {n(r['x1'])} && p.y >= {n(r['y0'])} && p.y <= {n(r['y1'])})" for r in self.inside_rects(margin)]
        return f"float {name}(vec2 p) {{ return ({' || '.join(t)}) ? 0.0 : 1.0; }}"

    # ---- indoor weight
    def outline_distance(self, x, y):
        d = chebyshev(x, y, self.outline['polygon']); return d if self.is_inside(x, y, 0) else -d

    def indoor_weight(self, x, y, h):
        r0, r1 = self.outline['indoorRamp']; c = self.levels['ceiling']
        return smoothstep(self.outline_distance(x, y), r0, r1) * (1 - smoothstep(h, c, c + self.outline['indoorFade']))

    # ---- walls
    def walls_at(self, z): return [p for p in self.pieces if p['z0'] <= z <= p['z1']]

    # ---- openings
    def opening(self, id): return self._openings.get(id)

    def neighbors(self, id):
        return [dict(space=o['connects'][1] if o['connects'][0] == id else o['connects'][0], opening=o['id'])
                for o in self.openings if o['kind'] != 'window' and id in o['connects']]

    def other_side(self, opening_id, x, y):
        o = self.opening(opening_id)
        if not o: return None
        c = (o['y0'] + o['y1']) / 2 if o['dir'] == 'H' else (o['x0'] + o['x1']) / 2
        return self.space(o['connects'][1 if (y if o['dir'] == 'H' else x) < c else 0])


_cached = {}


def load(path=None):
    path = path or find_plan()
    if path not in _cached:
        with open(path) as f: _cached[path] = Plan(json.load(f))
    return _cached[path]
