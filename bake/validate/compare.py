"""Gate (c), per-room render regression: compare a shoot.mjs run with the approved baseline, with Cycles, and between
tiers; absolute checks on every frame; contact sheets of the worst frames; approve a run as the new baseline.

  compare.py check <run> [--tiers hq,mobile,hq-visitor,...] [--states sunrise,...] [--baseline DIR] [--cycles DIR]
                   [--pair hq:mobile,hq-visitor:mobile-visitor]
                   [--cameras cameras.json] [--thresholds thresholds.json] [--out DIR] [--worst 12] [--overview]
  compare.py approve <run> <baseline dir> [--note TEXT] [--manifest FILE]

Layout: a run (and the baseline) is <dir>/<set>/<state>/<camera>.png (set: a tier at the slot's fixed exposure, or
<tier>-visitor with auto exposure and local adaptation; black-frame checks apply to visitor sets only) plus report.json per <tier>/<state> (shoot.mjs);
Cycles references are <cycles>/<state>/<camera>.png (cycles_refs.py; tier-independent). Metrics are on linear luminance
(sRGB decoded, Rec. 709 weights) at half resolution: the frame's exposure difference in stops, the largest per-cell
difference over a grid (default 8 x 6), the largest per-cell colour shift (log2 of R/G and B/G), and, against the
baseline and the other tier, the largest per-cell growth of saturated (HSV s > 0.8) and of exact-black area (the red /
yellow band and NaN classes). Absolute checks, which need no reference and so are loose (warm wood at sunrise is
legitimately saturated, dark foliage at dusk legitimately black): a black frame (p99), exact-zero pixels, magenta (three's
missing-texture colour, NaN in some drivers), and saturated single-hue area over the frame and per cell; a finding the
approved baseline frame has as well is a warning, not a failure. Also
from report.json: page errors, shader errors, link failures. Thresholds and per-camera overrides: thresholds.json.
Exit status 1 if an enforced check fails, 2 on missing frames.
Needs numpy and pillow only (no GPU): run it in the GPU job after the shots, or anywhere the PNGs are.
"""
import argparse, datetime, hashlib, json, math, os, shutil, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
STATES = ['sunrise', 'noon', 'golden', 'dusk', 'dusk_allon']
W709 = np.array([0.2126, 0.7152, 0.0722])


def lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def load(path):
    """sRGB 8-bit PNG -> (srgb float HxWx3, linear half-resolution HxWx3)"""
    s = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32) / 255.0
    h, w = s.shape[0] // 2 * 2, s.shape[1] // 2 * 2
    l = lin(s[:h, :w])
    return s, l.reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))


def cells(img, grid):
    gx, gy = grid
    h, w = img.shape[:2]
    out = np.zeros((gy, gx) + img.shape[2:], dtype=np.float64)
    for j in range(gy):
        for i in range(gx):
            out[j, i] = img[j * h // gy:(j + 1) * h // gy, i * w // gx:(i + 1) * w // gx].mean(axis=(0, 1))
    return out


def absolute(s, l, grid):
    L = l @ W709
    hsv = np.asarray(Image.fromarray((s * 255).astype(np.uint8)).convert('HSV'), dtype=np.float32) / 255.0
    sat = (hsv[..., 1] > 0.8) & (hsv[..., 2] > 0.25)
    hue = np.floor(hsv[..., 0] * 12).astype(int) % 12
    n = s.shape[0] * s.shape[1]
    bins = np.bincount(hue[sat], minlength=12)
    # per cell: the largest single-hue saturated fraction
    gx, gy = grid; h, w = s.shape[:2]; cell = 0.0
    for j in range(gy):
        for i in range(gx):
            m = sat[j * h // gy:(j + 1) * h // gy, i * w // gx:(i + 1) * w // gx]
            hh = hue[j * h // gy:(j + 1) * h // gy, i * w // gx:(i + 1) * w // gx]
            if m.any(): cell = max(cell, np.bincount(hh[m], minlength=12).max() / m.size)
    return {
        'mean': float(L.mean()), 'p50': float(np.percentile(L, 50)), 'p99': float(np.percentile(L, 99)),
        'zeroFrac': float((s.max(axis=2) == 0).mean()),
        'magentaFrac': float(((s[..., 0] > 0.85) & (s[..., 2] > 0.85) & (s[..., 1] < 0.25)).mean()),
        'nonFinite': int((~np.isfinite(l)).sum()),
        'hueFrac': float(bins.max() / n), 'hueBin': int(bins.argmax()), 'hueCell': float(cell),
    }


def versus(lo, lr, grid, so=None, sr=None):
    eg, ec = 0.005, 0.02
    Lo, Lr = lo @ W709, lr @ W709
    g = math.log2((Lo.mean() + eg) / (Lr.mean() + eg))
    co, cr = cells(lo, grid), cells(lr, grid)
    Lco, Lcr = co @ W709, cr @ W709
    st = np.log2((Lco + ec) / (Lcr + ec))
    # colour: log2 R/G and B/G per cell, only where both are bright enough to have a colour
    e = 0.01
    ch = np.abs(np.log2((co[..., 0] + e) / (co[..., 1] + e)) - np.log2((cr[..., 0] + e) / (cr[..., 1] + e))) + \
        np.abs(np.log2((co[..., 2] + e) / (co[..., 1] + e)) - np.log2((cr[..., 2] + e) / (cr[..., 1] + e)))
    ch = np.where((Lco > 0.02) & (Lcr > 0.02), ch, 0)
    m = {'global': float(g), 'cell': float(np.abs(st).max()), 'chroma': float(ch.max()), 'cells': np.round(st, 3).tolist()}
    if so is not None and sr is not None:
        # new saturated or exact-black area per cell (bands, NaN): the cell's fraction now minus the reference's
        sat = lambda s: cells(saturated(s)[..., None].astype(np.float32), grid)[..., 0]
        zero = lambda s: cells((s.max(axis=2) == 0)[..., None].astype(np.float32), grid)[..., 0]
        m['satCell'] = float((sat(so) - sat(sr)).max()); m['zeroCell'] = float((zero(so) - zero(sr)).max())
    return m


def saturated(s):
    hsv = np.asarray(Image.fromarray((s * 255).astype(np.uint8)).convert('HSV'), dtype=np.float32) / 255.0
    return (hsv[..., 1] > 0.8) & (hsv[..., 2] > 0.25)


def thresholds_for(T, cam, kind):
    t = dict(T.get(kind, {}))
    t.update(T.get('cameras', {}).get(cam, {}).get(kind, {}))
    return t


def judge(m, t):
    """failures and a score (largest metric / threshold) of one comparison"""
    fails, score = [], 0.0
    for k, v in (('global', abs(m['global'])), ('cell', m['cell']), ('chroma', m['chroma']), ('satCell', m.get('satCell')), ('zeroCell', m.get('zeroCell'))):
        if k in t and v is not None:
            score = max(score, v / t[k])
            if v > t[k]: fails.append(f'{k} {v:.2f} > {t[k]}')
    return fails, score


def judge_abs(a, t):
    fails, score = [], 0.0
    if 'blackP99' in t:
        score = max(score, t['blackP99'] / max(a['p99'], 1e-6) * 0.5)
        if a['p99'] < t['blackP99']: fails.append(f'black: p99 {a["p99"]:.4f} < {t["blackP99"]}')
    for k in ('zeroFrac', 'magentaFrac', 'hueFrac', 'hueCell'):
        if k in t:
            score = max(score, a[k] / t[k])
            if a[k] > t[k]: fails.append(f'{k} {a[k]:.3f} > {t[k]}' + (f' (hue bin {a["hueBin"]})' if k == 'hueFrac' else ''))
    if a['nonFinite']: fails.append(f'{a["nonFinite"]} non-finite pixels')
    return fails, score


# ---- contact sheets -------------------------------------------------------------------------------------------------------
def font(size):
    try: return ImageFont.load_default(size)
    except TypeError: return ImageFont.load_default()


TW, TH = 384, 216


def heat(cellsgrid, scale):
    """per-cell stops as a colour field: blue darker, red brighter, saturating at +-scale"""
    a = np.asarray(cellsgrid, dtype=np.float32) / scale
    rgb = np.stack([np.clip(a, 0, 1), np.zeros_like(a), np.clip(-a, 0, 1)], -1)
    rgb = (0.15 + 0.85 * rgb) * 255
    return Image.fromarray(rgb.astype(np.uint8)).resize((TW, TH), Image.NEAREST)


def tile(path, label=None):
    im = Image.open(path).convert('RGB').resize((TW, TH), Image.BILINEAR) if path and os.path.exists(path) else Image.new('RGB', (TW, TH), (60, 0, 60))
    if label:
        d = ImageDraw.Draw(im); f = font(13)
        d.rectangle([0, 0, TW, 18], fill=(0, 0, 0)); d.text((4, 2), label, fill=(255, 255, 255), font=f)
    return im


def sheet(rows, path, header):
    cols = max(len(r) for r in rows) if rows else 1
    out = Image.new('RGB', (TW * cols, 24 + TH * len(rows)), (20, 20, 20))
    ImageDraw.Draw(out).text((6, 4), header, fill=(255, 255, 255), font=font(15))
    for j, r in enumerate(rows):
        for i, im in enumerate(r): out.paste(im, (TW * i, 24 + TH * j))
    out.save(path, quality=85)


# ---- check ------------------------------------------------------------------------------------------------------------------
def check(a):
    T = json.load(open(a.thresholds))
    grid = tuple(T.get('grid', [8, 6]))
    cams = [c['id'] for c in json.load(open(a.cameras))['cameras']]
    tiers = a.tiers.split(',') if a.tiers else sorted(d for d in os.listdir(a.run) if os.path.isdir(os.path.join(a.run, d)) and not d.startswith('compare'))
    states = a.states.split(',') if a.states else STATES
    os.makedirs(a.out, exist_ok=True)
    frames, missing, runinfo = [], [], {}
    pairs = dict(reversed(x.split(':')) for x in a.pair.split(',')) if a.pair else {}   # second -> first
    VISITOR_ONLY = T.get('visitorOnly', ['blackP99', 'zeroFrac'])
    def abs_thr(tier, cam):   # black frames are expected at the slot's fixed exposure (a closet), not after adaptation
        t = thresholds_for(T, cam, 'absolute')
        return t if tier.endswith('-visitor') else {k: v for k, v in t.items() if k not in VISITOR_ONLY}
    for tier in tiers:
        for state in states:
            d = os.path.join(a.run, tier, state)
            rp = os.path.join(d, 'report.json')
            rep = json.load(open(rp)) if os.path.exists(rp) else None
            if rep is None:
                missing.append(f'{tier}/{state}: no report.json'); continue
            runinfo[f'{tier}/{state}'] = {k: rep.get(k) for k in ('gpu', 'loadSeconds', 'seconds', 'programs', 'linkFailed', 'pageerrors', 'shaderErrors', 'http', 'samplers', 'fallback')}
            for cam in cams:
                p = os.path.join(d, cam + '.png')
                if not os.path.exists(p): missing.append(f'{tier}/{state}/{cam}'); continue
                s, l = load(p)
                fr = {'tier': tier, 'state': state, 'cam': cam, 'path': p, 'fails': [], 'warn': [], 'score': 0.0}
                fr['abs'] = absolute(s, l, grid)
                f, sc = judge_abs(fr['abs'], abs_thr(tier, cam))
                fr['fails'] += ['abs ' + x for x in f]; fr['absScore'] = sc; fr['score'] = max(fr['score'], sc)
                refs = []
                if a.baseline: refs.append(('baseline', os.path.join(a.baseline, tier, state, cam + '.png')))
                # Cycles renders at the slot's fixed exposure: only the fixed set compares with it
                if a.cycles and not tier.endswith('-visitor'): refs.append(('cycles', os.path.join(a.cycles, state, cam + '.png')))
                if tier in pairs: refs.append(('pair', os.path.join(a.run, pairs[tier], state, cam + '.png')))
                for kind, rpath in refs:
                    if not os.path.exists(rpath):
                        if kind == 'baseline': fr['warn'].append('no baseline frame')
                        continue
                    rs, rl = load(rpath)
                    m = versus(l, rl, grid, s, rs if kind != 'cycles' else None); m['ref'] = rpath
                    if kind == 'baseline':
                        # an absolute finding the approved frame has too (a bath with its lights off at dusk) is known, not new
                        known = {x.split()[0].rstrip(':') for x in judge_abs(absolute(rs, rl, grid), abs_thr(tier, cam))[0]}
                        still = [x for x in fr['fails'] if x.startswith('abs ') and x.split()[1].rstrip(':') in known]
                        fr['fails'] = [x for x in fr['fails'] if x not in still]; fr['warn'] += [x + ' (also in the baseline)' for x in still]
                    t = thresholds_for(T, cam, kind)
                    f, sc = judge(m, t); m['fails'] = f; m['score'] = sc
                    fr[kind] = m
                    (fr['fails'] if t.get('enforce', True) else fr['warn']).extend(f'{kind} {x}' for x in f)
                    if t.get('enforce', True): fr['score'] = max(fr['score'], sc)
                frames.append(fr)
    # page-level failures
    page_fails = []
    for k, r in runinfo.items():
        for e in r.get('pageerrors') or []: page_fails.append(f'{k}: pageerror {e[:200]}')
        for e in r.get('shaderErrors') or []: page_fails.append(f'{k}: shader error {e[:200]}')
        if r.get('linkFailed'): page_fails.append(f'{k}: {len(r["linkFailed"])} programs failed to link')
        if r.get('fallback'): page_fails.append(f'{k}: baked fallback {r["fallback"]}')
    failed = [f for f in frames if f['fails']]
    # report
    rep = {'run': os.path.basename(os.path.abspath(a.run)), 'checked': len(frames), 'failed': len(failed), 'missing': missing,
           'pageFailures': page_fails, 'runs': runinfo, 'thresholds': T,
           'frames': [{k: v for k, v in f.items() if k != 'path'} for f in frames]}
    json.dump(rep, open(os.path.join(a.out, 'report.json'), 'w'), indent=1)
    lines = [f'{len(frames)} frames checked, {len(failed)} failed, {len(missing)} missing, {len(page_fails)} page-level failures']
    for k, r in runinfo.items():
        lines.append(f'  {k:18s} load {r["loadSeconds"] or 0:6.0f} s  shots {r["seconds"] or 0:6.0f} s  programs {r["programs"]}  '
                     f'link failures {len(r["linkFailed"] or [])}  samplers {json.dumps(r["samplers"])[:80]}')
    lines += ['  ' + x for x in page_fails + missing[:20]]
    for f in sorted(frames, key=lambda f: -f['score']):
        if f['fails'] or f['warn']:
            lines.append(f'  {"FAIL" if f["fails"] else "warn"} {f["tier"]}/{f["state"]}/{f["cam"]}: ' + '; '.join(f['fails'] + f['warn']))
    open(os.path.join(a.out, 'summary.txt'), 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines[:60]))
    # contact sheets: the worst frames per comparison kind, then an overview of every frame
    for kind in ('baseline', 'cycles', 'pair'):
        have = [f for f in frames if kind in f]
        if not have: continue
        worst = sorted(have, key=lambda f: -f[kind]['score'])[:a.worst]
        rows = []
        for f in worst:
            m = f[kind]
            lab = f'{f["tier"]}/{f["state"]}/{f["cam"]}  {m["global"]:+.2f} st  cell {m["cell"]:.2f}  chroma {m["chroma"]:.2f}'
            rows.append([tile(f['path'], lab), tile(m['ref'], kind), heat(m['cells'], 1.0)])
        sheet(rows, os.path.join(a.out, f'worst_{kind}.jpg'), f'{rep["run"]}: worst {len(rows)} vs {kind} (ours | {kind} | per-cell stops, red brighter, blue darker, full at 1 stop)')
    worst = sorted(frames, key=lambda f: -f['absScore'])[:a.worst]
    rows = [[tile(f['path'], f'{f["tier"]}/{f["state"]}/{f["cam"]}  p99 {f["abs"]["p99"]:.3f} hue {f["abs"]["hueFrac"]:.2f}/{f["abs"]["hueCell"]:.2f}')] for f in worst]
    if rows:
        rows = [sum(rows[i:i + 3], []) for i in range(0, len(rows), 3)]
        sheet(rows, os.path.join(a.out, 'worst_absolute.jpg'), f'{rep["run"]}: highest absolute-check scores')
    if a.overview:   # one sheet per tier and state; with a visitor set, each camera fixed | visitor side by side
        for tier in [t for t in tiers if not t.endswith('-visitor')] + [t for t in tiers if t.endswith('-visitor') and t[:-8] not in tiers]:
            vis = tier + '-visitor' if tier + '-visitor' in tiers else None
            for state in states:
                fs = [f for f in frames if f['tier'] == tier and f['state'] == state]
                if not fs: continue
                byv = {f['cam']: f for f in frames if vis and f['tier'] == vis and f['state'] == state}
                ts = []
                for f in fs:
                    ts.append(tile(f['path'], f['cam'] + (' fixed' if vis else '') + (' FAIL' if f['fails'] else '')))
                    if vis:
                        g = byv.get(f['cam'])
                        ts.append(tile(g['path'] if g else None, f['cam'] + ' visitor' + (f' {g["abs"]["mean"]:.3f}' if g else ' missing') + (' FAIL' if g and g['fails'] else '')))
                per = 6
                rows = [ts[i:i + per] for i in range(0, len(ts), per)]
                head = f'{rep["run"]}: {tier} {state}, {len(fs)} cameras' + (' (fixed exposure | visitor: auto exposure + local adaptation)' if vis else '')
                sheet(rows, os.path.join(a.out, f'overview_{tier}_{state}.jpg'), head)
    if missing: return 2
    return 1 if failed or page_fails else 0


# ---- approve ----------------------------------------------------------------------------------------------------------------
def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def approve(a):
    run, base = os.path.abspath(a.run), os.path.abspath(a.baseline)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    if os.path.exists(base):
        os.rename(base, f'{base}.prev-{stamp}')
    files = {}
    for tier in sorted(os.listdir(run)):
        if tier.startswith('compare') or not os.path.isdir(os.path.join(run, tier)): continue
        for state in sorted(os.listdir(os.path.join(run, tier))):
            src = os.path.join(run, tier, state)
            if not os.path.isdir(src): continue
            dst = os.path.join(base, tier, state); os.makedirs(dst, exist_ok=True)
            for n in sorted(os.listdir(src)):
                if n.endswith('.png') or n == 'report.json':
                    shutil.copy2(os.path.join(src, n), os.path.join(dst, n))
                    if n.endswith('.png'): files[f'{tier}/{state}/{n}'] = sha(os.path.join(dst, n))
    man = {'run': os.path.basename(run), 'approved': stamp, 'note': a.note or '', 'frames': len(files), 'sha256': files}
    json.dump(man, open(os.path.join(base, 'baseline.json'), 'w'), indent=1)
    if a.manifest: json.dump(man, open(a.manifest, 'w'), indent=0, sort_keys=False)
    print(f'approved {len(files)} frames of {man["run"]} as {base}' + (f' (previous kept as {base}.prev-{stamp})' if os.path.exists(f'{base}.prev-{stamp}') else ''))
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('check')
    c.add_argument('run'); c.add_argument('--tiers'); c.add_argument('--states')
    c.add_argument('--baseline'); c.add_argument('--cycles'); c.add_argument('--pair')
    c.add_argument('--cameras', default=os.path.join(HERE, 'cameras.json'))
    c.add_argument('--thresholds', default=os.path.join(HERE, 'thresholds.json'))
    c.add_argument('--out'); c.add_argument('--worst', type=int, default=12); c.add_argument('--overview', action='store_true')
    ap = sub.add_parser('approve')
    ap.add_argument('run'); ap.add_argument('baseline'); ap.add_argument('--note'); ap.add_argument('--manifest')
    a = p.parse_args()
    if a.cmd == 'check':
        a.out = a.out or os.path.join(a.run, 'compare')
        sys.exit(check(a))
    sys.exit(approve(a))


if __name__ == '__main__':
    main()
