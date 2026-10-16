# Chart-aware lightmap denoiser. An atlas holds thousands of unrelated UV charts a few texels apart, so an image
# denoiser run over the whole atlas (OpenImageDenoise) blurs small charts into their neighbours. Here every texel knows
# its chart, world position and normal (rasterised from the Blender scene's lightmap UVs), and an edge-aware a-trous
# wavelet filter (SVGF-style) only mixes texels of the same chart that lie on the same surface, within a world-space
# radius, and whose brightness agrees within the local noise level (a robust per-texel estimate, filtered along with the
# image) or by a small relative margin, so contact shadows and lamp hot spots stay sharp while the grain on walls goes.
# usage: python scripts/denoise.py guides scene/v2/croton_lm.glb bakes/v2/lightmap_uv.bin bakes/v2/guides.npz
#        (once per unwrap, ~25 s on a GPU; composite_v2.py then finds <bake>/../guides.npz, or $CROTON_GUIDES, and calls
#        denoise(rgb, cov, load_guides(path)) per layer, ~8 s each; CROTON_DENOISE=0 turns it off)
# Rows follow Blender's image order (row 0 = bottom, v = 1 - glTF v), like composite_v2.py's arrays before [::-1].
import sys, json, struct, time
import numpy as np
import torch
dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

def gltf_units(path):
    from pygltflib import GLTF2
    g = GLTF2().load(path); blob = g.binary_blob()
    DT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5122: np.int16, 5120: np.int8}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    def read(i):
        a = g.accessors[i]; v = g.bufferViews[a.bufferView]; dt = np.dtype(DT[a.componentType]); n = NC[a.type]
        off = (v.byteOffset or 0) + (a.byteOffset or 0); stride = v.byteStride or dt.itemsize * n
        raw = np.frombuffer(blob, np.uint8, stride * (a.count - 1) + dt.itemsize * n, off)
        out = np.lib.stride_tricks.as_strided(raw, (a.count, dt.itemsize * n), (stride, 1)).copy().view(dt).reshape(a.count, n)
        return out.astype(np.float32) / np.iinfo(dt).max if a.normalized and dt != np.float32 else out
    units = {}   # a unit = the parts sharing a POSITION accessor and a node matrix (as in unwrap.py)
    for n in g.nodes:
        if n.mesh is None: continue
        M = np.array(n.matrix if n.matrix else np.eye(4).ravel(), np.float64).reshape(4, 4).T
        for p in g.meshes[n.mesh].primitives:
            if p.attributes.TEXCOORD_1 is None: continue
            u = units.setdefault((p.attributes.POSITION, tuple(np.round(M.ravel(), 6))), dict(M=M, p=p, idx=[]))
            u['idx'].append(read(p.indices).ravel() if p.indices is not None else np.arange(g.accessors[p.attributes.POSITION].count))
    for u in units.values():
        a = u['p'].attributes; M = u['M']; P = read(a.POSITION).astype(np.float64)
        W = P @ M[:3, :3].T + M[:3, 3]
        Nm = read(a.NORMAL).astype(np.float64) @ np.linalg.inv(M[:3, :3]) if a.NORMAL is not None else None
        yield W.astype(np.float32), Nm, read(a.TEXCOORD_1).astype(np.float32), np.concatenate(u['idx']).astype(np.int64).reshape(-1, 3)

def build_guides(glb, uvbin, out):
    t0 = time.time(); buf = open(uvbin, 'rb').read(); W, H = json.loads(buf[4:4 + struct.unpack('<I', buf[:4])[0]])['atlas']
    P, N, UV, F, nv = [], [], [], [], 0
    for Wp, Nm, uv, f in gltf_units(glb):
        tri = Wp[f]; fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        if Nm is None:   # face normals scattered to vertices
            Nm = np.zeros_like(Wp, np.float64); np.add.at(Nm, f.ravel(), np.repeat(fn, 3, 0))
        P.append(Wp); N.append(Nm.astype(np.float32)); UV.append(uv); F.append(f + nv); nv += len(Wp)
    P, N, UV, F = (np.concatenate(a) for a in (P, N, UV, F))
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    # charts: a chart is a connected set of triangles in UV space. Vertices are split at chart seams but also wherever the
    # source mesh had them split (hard edges), so join vertices by lightmap UV (charts never overlap in the atlas)
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    _, uid = np.unique(np.ascontiguousarray(UV).view(np.int64).ravel(), return_inverse=True); Fu = uid.ravel()[F]; nu = int(Fu.max()) + 1
    e = np.concatenate([Fu[:, [0, 1]], Fu[:, [1, 2]]]); nc, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), (nu, nu)), directed=False)
    lab = lab[uid.ravel()]
    print(f'atlas {W}x{H}, {nv} vertices, {len(F)} triangles, {nc} charts, {time.time() - t0:.0f} s', flush=True)
    T = lambda a, dt=torch.float32: torch.as_tensor(a).to(dev, dt)
    P, N, F = T(P), T(N), T(F, torch.int64); cid = T(lab, torch.int64)[F[:, 0]]
    # texel (row r, col c) has its centre at pixel coordinates (c, r): x = u W - 0.5, y = (1 - v) H - 0.5
    UV = T(UV); X = torch.stack([UV[:, 0] * W - 0.5, (1 - UV[:, 1]) * H - 0.5], 1)
    a, b, c = X[F[:, 0]], X[F[:, 1]], X[F[:, 2]]
    area = (b - a)[:, 0] * (c - a)[:, 1] - (b - a)[:, 1] * (c - a)[:, 0]; ok = area.abs() > 1e-8
    wa = torch.linalg.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]).norm(dim=1)
    tsize = (wa / area.abs().clamp_min(1e-8)).sqrt()   # metres per texel
    lo = torch.minimum(torch.minimum(a, b), c); hi = torch.maximum(torch.maximum(a, b), c)
    R = 0.75   # conservative: a texel belongs to a triangle if its centre is within R texels of it (0.71 covers any overlap)
    x0 = (lo[:, 0] - R).ceil().clamp(0, W - 1).long(); x1 = (hi[:, 0] + R).floor().clamp(0, W - 1).long()
    y0 = (lo[:, 1] - R).ceil().clamp(0, H - 1).long(); y1 = (hi[:, 1] + R).floor().clamp(0, H - 1).long()
    bw = (x1 - x0 + 1).clamp_min(0) * ok; bh = (y1 - y0 + 1).clamp_min(0) * ok; cnt = bw * bh; cum = cnt.cumsum(0); total = int(cum[-1])
    s = area.sign()
    def edist(px, py, t):   # signed distance to each edge, positive inside (texels); and the barycentrics
        A, B, C, sg = a[t], b[t], c[t], s[t]; d = []
        for p0, p1 in ((B, C), (C, A), (A, B)):
            e = p1 - p0; d.append(sg * (e[:, 0] * (py - p0[:, 1]) - e[:, 1] * (px - p0[:, 0])))
        L = torch.stack(d, 1); lens = torch.stack([(C - B).norm(dim=1), (A - C).norm(dim=1), (B - A).norm(dim=1)], 1)
        return (L / lens.clamp_min(1e-9)).min(1).values, L / area[t].abs()[:, None]
    best = torch.full((W * H,), -1, dtype=torch.int64, device=dev); CH = 1 << 25
    for st in range(0, total, CH):
        g = torch.arange(st, min(st + CH, total), device=dev); t = torch.searchsorted(cum, g, right=True); k = g - (cum[t] - cnt[t])
        px = x0[t] + k % bw[t]; py = y0[t] + k // bw[t]; sc, _ = edist(px.float(), py.float(), t); m = sc >= -R
        # the texel goes to the triangle that contains it most deeply
        key = (((sc[m].clamp(-1, 500) + 1) * 64).long() << 32) | t[m]; best.scatter_reduce_(0, (py * W + px)[m], key, 'amax')
    has = best >= 0; ti = best[has] & 0xffffffff; pix = has.nonzero()[:, 0]
    _, L = edist((pix % W).float(), (pix // W).float(), ti); L = L.clamp_min(0); L = L / L.sum(1, keepdim=True).clamp_min(1e-9)
    f = F[ti]; pos = sum(P[f[:, i]] * L[:, i:i + 1] for i in range(3)); nrm = sum(N[f[:, i]] * L[:, i:i + 1] for i in range(3))
    nrm = nrm / nrm.norm(dim=1, keepdim=True).clamp_min(1e-9)
    chart = torch.full((W * H,), -1, dtype=torch.int32, device=dev); chart[has] = cid[ti].int()
    G = dict(chart=chart, pos=torch.zeros(W * H, 3, device=dev), nrm=torch.zeros(W * H, 3, device=dev), tsize=torch.zeros(W * H, device=dev))
    G['pos'][has] = pos; G['nrm'][has] = nrm; G['tsize'][has] = tsize[ti]
    np.savez(out, size=np.array([H, W]), chart=G['chart'].cpu().numpy(), pos=G['pos'].cpu().numpy(), nrm=G['nrm'].half().cpu().numpy(), tsize=G['tsize'].half().cpu().numpy())
    print(f'guides: {has.float().mean().item():.3f} of the atlas covered, {total / 1e6:.0f} M candidates, {time.time() - t0:.0f} s -> {out}', flush=True)

def load_guides(path):
    z = np.load(path); H, W = z['size']
    T = lambda a: torch.as_tensor(a).to(dev)
    return dict(H=int(H), W=int(W), chart=T(z['chart']).view(H, W), pos=T(z['pos']).view(H, W, 3).permute(2, 0, 1).contiguous(),
                nrm=T(z['nrm']).float().view(H, W, 3).permute(2, 0, 1).contiguous(), tsize=T(z['tsize']).float().view(H, W))

def shifted(x, dy, dx, fill=0):
    # x[..., y + dy, x + dx], filled outside the image
    out = torch.full_like(x, fill); H, W = x.shape[-2:]
    if abs(dy) >= H or abs(dx) >= W: return out
    ys, yd = slice(max(dy, 0), H + min(dy, 0)), slice(max(-dy, 0), H + min(-dy, 0))
    xs, xd = slice(max(dx, 0), W + min(dx, 0)), slice(max(-dx, 0), W + min(-dx, 0))
    out[..., yd, xd] = x[..., ys, xs]
    return out

def window(x, chart, valid, r, stat):
    # stat ('median' or 'mean') over the (2r+1)^2 window, same-chart valid texels only; in row bands to bound memory
    out = torch.empty_like(x); H = x.shape[0]; B = 512
    xv = torch.where(valid, x, float('nan'))
    for y in range(0, H, B):
        a, b = max(0, y - r), min(H, y + B + r); band = xv[a:b]; cb = chart[a:b]
        taps = torch.stack([torch.where(shifted(cb, dy, dx, -2) == cb, shifted(band, dy, dx, float('nan')), float('nan')) for dy in range(-r, r + 1) for dx in range(-r, r + 1)])
        v = taps.nanmedian(0).values if stat == 'median' else taps.nanmean(0)
        out[y:min(H, y + B)] = v[y - a:y - a + min(B, H - y)]
    return out

def noise_var(lum, valid, chart):
    # per-texel noise variance: the residual against the same-chart 3x3 median (which keeps edges, so a shadow edge adds
    # little, while a firefly counts in full), squared and averaged over the same-chart 5x5 window
    r2 = (lum - window(lum, chart, valid, 1, 'median')) ** 2
    return torch.nan_to_num(window(r2, chart, valid, 2, 'mean'), nan=0.0)

lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

def atrous(cur, valid, var, G, levels, sigma_x, sigma_l, rel, sigma_n=64.0, plane=0.5, log=print, t0=0):
    """Edge-aware a-trous wavelet filter (5x5 B3 spline, step 2^level). Taps count only within the texel's chart, on its
    surface (normals, distance off its plane) and within sigma_x metres, and whose brightness agrees within sigma_l times
    the local noise (var, filtered along, as in SVGF) plus a relative tolerance rel."""
    chart, pos, nrm, ts = G['chart'], G['pos'], G['nrm'], G['tsize']
    h = [1 / 16, 1 / 4, 3 / 8, 1 / 4, 1 / 16]; cur = torch.where(valid, cur, 0)
    for lev in range(levels):
        st = 1 << lev; acc = torch.zeros_like(cur); wsum = torch.zeros_like(var); vacc = torch.zeros_like(var); lp = lum(cur)
        for i in range(5):
            for j in range(5):
                dy, dx = (i - 2) * st, (j - 2) * st
                m = shifted(valid, dy, dx, False) & (shifted(chart, dy, dx, -2) == chart)
                if not m.any(): continue
                dp = shifted(pos, dy, dx) - pos; d2 = (dp * dp).sum(0); dpl = (nrm * dp).sum(0).abs()
                wgt = h[i] * h[j] * m * (nrm * shifted(nrm, dy, dx)).sum(0).clamp_min(0) ** sigma_n * (-d2 / (2 * sigma_x ** 2) - dpl / (plane * st * ts + 1e-6)).exp()
                q = shifted(cur, dy, dx); lq = lum(q); vq = shifted(var, dy, dx)   # symmetric, so bright and dark texels trade energy evenly
                agree = (-(lq - lp).abs() / (sigma_l * (0.5 * (var + vq)).clamp_min(0).sqrt() + rel * 0.5 * (lp + lq).abs() + 1e-6)).exp()
                # a texel without a value yet has nothing to agree with: its placeholder 0 would pull the fill towards the
                # darkest neighbours (black slits through thin charts), so it takes its chart's neighbours unweighted
                wgt = wgt * torch.where(valid, agree, 1.0)
                if dy == dx == 0: wgt = torch.where(valid, wgt, 0)
                acc += wgt * q; wsum += wgt; vacc += wgt * wgt * vq
        ok = wsum > 0
        cur = torch.where(ok, acc / wsum.clamp_min(1e-12), cur); var = torch.where(ok, vacc / (wsum * wsum).clamp_min(1e-24), var)
        valid = valid | (ok & (chart >= 0))   # edge texels the bake missed join once they have a value from their chart
        log(f'  level {lev}: step {st}, {valid.float().mean().item():.3f} valid, {time.time() - t0:.1f} s')
    return cur, valid

def denoise(rgb, cov, G, levels=6, sigma_x=0.4, sigma_l=4.5, rel=0.08, log=print):
    """rgb (H, W, 3) float, cov (H, W) bool (texels the bake wrote). Returns the filtered (H, W, 3) array and the mask of
    texels it set: every covered texel, plus edge texels the bake missed, filled from their own chart.
    rel: brightness differences under this fraction are smoothed regardless of the noise estimate, which takes out the
    broad blotches of soft indirect light; keep it ~0 for layers with hot spots whose falloff should stay (lamps)."""
    t0 = time.time(); chart = G['chart']
    col = torch.as_tensor(np.ascontiguousarray(rgb), dtype=torch.float32, device=dev).permute(2, 0, 1).contiguous()
    valid = torch.as_tensor(cov, device=dev) & (chart >= 0)
    var = noise_var(lum(col), valid, chart)
    # var <- 3x3 blur (SVGF), to steady the brightness stop
    vs = torch.zeros_like(var); ws = torch.zeros_like(var)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            k = (2 - abs(dy)) * (2 - abs(dx)) * shifted(valid, dy, dx, False) * (shifted(chart, dy, dx, -2) == chart); vs += k * shifted(var, dy, dx); ws += k
    var = vs / ws.clamp_min(1e-9)
    cur, fil = atrous(col, valid, var, G, levels, sigma_x, sigma_l, rel, log=log, t0=t0)
    out = np.array(rgb, np.float32, copy=True); m = ((chart >= 0) & fil).cpu().numpy(); out[m] = cur.permute(1, 2, 0).cpu().numpy()[m]
    return out, m

def holes(cov, layers, isolated=2):
    """The texels a bake holds no usable light for: covered but black in every given layer (sky and sun bounce: any
    surface the visitor can see gets some). They lie inside other geometry: piping sunk into an arm, a cushion pressed
    into the frame, overlapping boxes; their zeros would bleed into the visible part of the same few texels. A lit texel
    with at most `isolated` lit texels in its 5x5 window is light leaking through a crack into such a surface: a hole too."""
    from scipy.ndimage import convolve
    dark = cov.copy()
    for a in layers: dark &= ~np.any(a > 0, axis=-1)
    lit = cov & ~dark
    return dark | (lit & (convolve(lit.astype(np.uint8), np.ones((5, 5), np.uint8), mode='constant') <= isolated))

def world_fill(layers, valid, G, k=16, reach=3.0, min_dot=0.5, chunk=1 << 19, log=print):
    """Fill every chart texel that has no valid value (the bake's rasteriser skips texel centres in thin UV triangles:
    piping, pinched edges, pole fans; or it was a hole, see holes()) from the valid texels nearest to it on the SURFACE,
    by the guides' world positions and normals, within reach x its own texel size; a chart neighbour in the atlas is
    usually an unrelated object. layers: (H, W, 3) arrays in Blender row order, filled in place. Returns the mask of
    texels filled. Texels with no valid texel near enough facing the same way (enclosed surfaces) stay as they were."""
    from scipy.spatial import cKDTree
    t0 = time.time(); H, W = G['H'], G['W']
    chart = G['chart'].reshape(-1).cpu().numpy()
    v = np.flatnonzero(valid.reshape(-1) & (chart >= 0)); q = np.flatnonzero(~valid.reshape(-1) & (chart >= 0))
    filled = np.zeros(H * W, bool)
    if not len(v) or not len(q): return filled.reshape(H, W)
    pos = G['pos'].permute(1, 2, 0).reshape(-1, 3); nrm = G['nrm'].permute(1, 2, 0).reshape(-1, 3); ts = G['tsize'].reshape(-1)
    pv = pos[torch.as_tensor(v, device=pos.device)].cpu().numpy().astype(np.float64)
    nv = nrm[torch.as_tensor(v, device=pos.device)].cpu().numpy()
    tree = cKDTree(pv)
    flat = [a.reshape(-1, 3) for a in layers]
    if not all(np.shares_memory(f, a) for f, a in zip(flat, layers)): raise ValueError('world_fill fills contiguous arrays in place')
    for s in range(0, len(q), chunk):
        qi = q[s:s + chunk]; ix = torch.as_tensor(qi, device=pos.device)
        pq = pos[ix].cpu().numpy().astype(np.float64); nq = nrm[ix].cpu().numpy(); r = reach * np.maximum(ts[ix].cpu().numpy(), 1e-3)
        d, j = tree.query(pq, k=k, distance_upper_bound=float(r.max()), workers=-1)
        ok = np.isfinite(d) & (d <= r[:, None]); j = np.where(ok, j, 0)
        dot = np.einsum('qc,qkc->qk', nq, nv[j])
        w = np.where(ok & (dot > min_dot), np.exp(-(d / (0.5 * r[:, None])) ** 2) * dot * dot, 0).astype(np.float32)
        sw = w.sum(1); f = sw > 0; src = v[j[f]]; wf = w[f] / sw[f, None]
        for a in flat: a[qi[f]] = np.einsum('qk,qkc->qc', wf, a[src])
        filled[qi[f]] = True
    log(f'world fill: {len(q)} chart texels without light, {filled.sum()} filled from the surface around them, {time.time() - t0:.0f} s')
    return filled.reshape(H, W)

if __name__ == '__main__' and sys.argv[1] == 'guides': build_guides(*sys.argv[2:5])
