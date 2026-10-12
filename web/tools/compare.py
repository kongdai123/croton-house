# Side-by-side fidelity check: reproject a Zillow panorama (equirect) to a perspective view with the same camera as the app
# (vertical fov 62°, 1280x800), next to the app's own screenshot from that spot. usage: python3 -I tools/compare.py [panoId ...]
import json, math, os, subprocess, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); WEB = os.path.join(HERE, '..')
OUT = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith('/') else os.path.join(HERE, '..', '..', 'compare'); os.makedirs(OUT, exist_ok=True)
ids = [a for a in sys.argv[1:] if not a.endswith('/')]
VB = [-8.246258596094643, -5.699660161646401, 16.50411768657405, 11.778618533436845]
pts = json.load(open(os.path.join(WEB, 'data/floorplan_points.json'))); tour = json.load(open(os.path.join(WEB, 'data/tour.json')))
EXTRA = {'f393dd3f56': (0.9, 7.4), '24094ad9a5': (6.0, 12.8)}
pos = {p['id']: (VB[0] + p['x'] / 100 * VB[2], -(VB[1] + p['y'] / 100 * VB[3])) for p in pts['panorama']}; pos.update(EXTRA)
titles = {p['id']: p['title'] for p in pts['panorama']}; titles.update({'f393dd3f56': 'Patio', '24094ad9a5': 'Backyard'})
# forward heading of each pano (deg, 0 = north, cw) from the link arrows, weighted by link distance
fwd = {}
for p in tour['panos']:
    a = pos.get(p['id']);
    if not a: continue
    sx = sy = 0
    for d in p['destinations']:
        b = pos.get(d['dest']);
        if not b: continue
        bearing = math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])); f = bearing - d['departureAngle']; w = math.hypot(b[0] - a[0], b[1] - a[1])
        sx += w * math.cos(math.radians(f)); sy += w * math.sin(math.radians(f))
    fwd[p['id']] = (math.degrees(math.atan2(sy, sx)) if (sx or sy) else 0) + {'26bd39e7b7': 10, '954f8388b8': 15, 'd5e1aedcc0': 25, 'ee4635b067': -28, 'b9a18422cd': -10, '03fae42bc1': 35}.get(p['id'], 0)

def reproject(eq, yaw_deg, pitch_deg, vfov_deg, W, H):
    """equirect (H2,W2,3) -> perspective. yaw: heading offset from the pano's centre column (cw positive)."""
    H2, W2 = eq.shape[:2]
    vf = math.radians(vfov_deg); hf = 2 * math.atan(math.tan(vf / 2) * W / H)
    xs = (np.arange(W) + 0.5) / W * 2 - 1; ys = 1 - (np.arange(H) + 0.5) / H * 2
    X, Y = np.meshgrid(xs * math.tan(hf / 2), ys * math.tan(vf / 2))
    Z = np.ones_like(X)
    # pitch (about x), then yaw (about y)
    cp, sp = math.cos(math.radians(pitch_deg)), math.sin(math.radians(pitch_deg))
    Y2 = Y * cp + Z * sp; Z2 = -Y * sp + Z * cp
    cy, sy = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
    X3 = X * cy + Z2 * sy; Z3 = -X * sy + Z2 * cy
    lon = np.arctan2(X3, Z3); lat = np.arctan2(Y2, np.hypot(X3, Z3))
    u = (lon / (2 * math.pi) + 0.5) * W2; v = (0.5 - lat / math.pi) * H2
    ui = np.clip(u.astype(int), 0, W2 - 1); vi = np.clip(v.astype(int), 0, H2 - 1)
    return eq[vi, ui]

W, H, VFOV = 1280, 800, 62
for p in tour['panos']:
    pid = p['id']
    if ids and pid not in ids: continue
    if pid not in pos: continue
    x, y = pos[pid]; heading = fwd.get(pid, 0)
    eq = np.asarray(Image.open(os.path.join(WEB, 'assets/panos', pid + '.jpg')).convert('RGB'))
    # look along the pano's own forward direction (yaw 0 in the equirect) -> app heading = fwd
    pano_img = Image.fromarray(reproject(eq, 0, 0, VFOV, W, H))
    shot = os.path.join(OUT, f'{pid}_3d.png')
    subprocess.run(['node', os.path.join(HERE, 'shot.mjs'), f'index.html?x={x:.3f}&y={y:.3f}&h={heading:.1f}&p=0&eye=1.5', shot, str(W), str(H)], cwd=WEB, capture_output=True)
    try: app_img = Image.open(shot).convert('RGB')
    except Exception: app_img = Image.new('RGB', (W, H), 'grey')
    sheet = Image.new('RGB', (W * 2 + 20, H), 'black'); sheet.paste(pano_img, (0, 0)); sheet.paste(app_img, (W + 20, 0))
    sheet.thumbnail((2000, 2000)); sheet.save(os.path.join(OUT, f'{pid}_{titles.get(pid, "").replace(" ", "_")}.jpg'), quality=85)
    print(pid, titles.get(pid), f'x={x:.2f} y={y:.2f} heading={heading:.1f}')
