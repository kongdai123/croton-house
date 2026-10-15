// Promo film recorder: steps the app frame by frame (?capture + renderAt) along a scripted timeline, with Swiss captions
// laid over the frames, and writes numbered JPEGs; tools/promo_encode.sh turns them into an MP4 with music.
// usage (from web/, dev server on 8780): node tools/promo.mjs <outDir> [--stills] [--from s] [--to s]
import { chromium } from 'playwright';
import fs from 'fs';

const out = process.argv[2] || 'promo_frames';
const stills = process.argv.includes('--stills');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const FPS = 30, W = 1920, H = 1080;
fs.mkdirSync(out, { recursive: true });

// ---- the film, in page context ---------------------------------------------------------------------------------------
const PAGE = String.raw`
(() => {
  const a = window.__app, T = a.THREE, p = a.player, cam = a.camera;
  const ease = u => u * u * (3 - 2 * u), lerp = (x, y, u) => x + (y - x) * u, clamp01 = u => Math.max(0, Math.min(1, u));
  const rad = d => d * Math.PI / 180, wrap = d => ((d + 540) % 360) - 180;
  // camera keyframes: [time, plan x, plan y, eye height, heading (deg, 0 = north, clockwise), pitch (rad)]
  // Catmull-Rom through positions, eased time inside each shot, headings unwrapped.
  function path(keys) {
    const k = keys.map(r => r.slice());
    for (let i = 1; i < k.length; i++) k[i][4] = k[i - 1][4] + wrap(k[i][4] - k[i - 1][4]);
    return (t) => {
      const t0 = k[0][0], t1 = k[k.length - 1][0], u = ease(clamp01((t - t0) / (t1 - t0))), tt = t0 + u * (t1 - t0);
      let i = 0; while (i < k.length - 2 && tt > k[i + 1][0]) i++;
      const a0 = k[Math.max(0, i - 1)], a1 = k[i], a2 = k[i + 1], a3 = k[Math.min(k.length - 1, i + 2)];
      const s = (tt - a1[0]) / (a2[0] - a1[0]);
      const cr = (j) => { const p0 = a0[j], p1 = a1[j], p2 = a2[j], p3 = a3[j], s2 = s * s, s3 = s2 * s; return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3); };
      return { x: cr(1), y: cr(2), eye: cr(3), h: lerp(a1[4], a2[4], ease(s)), pitch: lerp(a1[5], a2[5], ease(s)) };
    };
  }
  function place(v) {
    p.driven = true; p.enabled = false;
    p.pos.x = v.x; p.pos.z = -v.y; p.eye = v.eye; p.yaw = rad(-v.h); p.pitch = v.pitch;
    cam.position.set(v.x, v.eye, -v.y); cam.rotation.set(0, 0, 0, 'YXZ'); cam.rotation.y = p.yaw; cam.rotation.x = p.pitch;
  }
  const find = (id, px, py) => { let r = null, best = 1e9; const w = new T.Vector3(); a.layout.root.traverse(o => { if (o.userData?.id !== id) return; o.getWorldPosition(w); const d = Math.hypot(w.x - px, w.z + py); if (d < best) { best = d; r = o; } }); return r; };
  const sofa = find('living-sofa', 2.65, -1.15), chair = find('wishbone-chair', 2.58, 2.78);
  const pets = a.pets, stage = (name, px, py, mode, lx, ly) => { const g = pets?.get(name); if (!g) return; g.perch = null; g.path = null; g.call = null; g.x = px; g.z = -py; g.yaw = Math.atan2(lx - px, -ly + py); g.state = 'pause'; pets.hold(name, { x: px, z: -py, yaw: g.yaw, mode, speed: 0 }); };
  const free = (name) => { const g = pets?.get(name); if (g) { g.hold = null; g.state = 'pause'; g.st = 0; } };

  // ---- overlay: Swiss captions and cards ----
  const css = document.createElement('style'); css.textContent = ${'`'}
    #hud > *:not(#bigmap):not(#compare) { display:none !important }
    #promo { position:fixed; inset:0; z-index:100; pointer-events:none; font-family:Liter, "Helvetica Neue", Arial, sans-serif; color:#1a1917 }
    #promo .cap { position:absolute; left:64px; bottom:60px; display:flex; align-items:center; gap:18px; padding:18px 26px 18px 22px; background:rgba(242,239,231,.62); backdrop-filter:blur(22px); border-top:5px solid #1a1917; opacity:0 }
    #promo .cap b { width:22px; height:22px; background:#c8352a } #promo .cap i { font-style:normal; font-size:24px; color:#c8352a; letter-spacing:-.02em } #promo .cap span { font-size:30px; letter-spacing:-.02em }
    #promo .title { position:absolute; left:90px; top:110px; opacity:0 } #promo .title h1 { margin:0; font-weight:400; font-size:150px; line-height:.9; letter-spacing:-.05em; color:#1a1917 }
    #promo .title p { margin:18px 0 0 6px; font-size:22px; letter-spacing:.24em; text-transform:uppercase; color:#1a1917 }
    #promo .end { position:absolute; inset:0; background:#f2efe7; opacity:0; display:grid; grid-template-columns:120px 1fr; column-gap:40px; align-content:center; padding:0 160px }
    #promo .end .blk { width:120px; height:120px; background:#c8352a; align-self:start; margin-top:22px }
    #promo .end h1 { margin:0; font-weight:400; font-size:170px; line-height:.88; letter-spacing:-.05em }
    #promo .end .rule { grid-column:2; height:6px; background:#1a1917; margin:46px 0 26px }
    #promo .end .row { grid-column:2; display:flex; justify-content:space-between; font-size:24px; letter-spacing:.18em; text-transform:uppercase; color:#555 }
    #promo .end .url { grid-column:2; margin-top:22px; font-size:30px; letter-spacing:-.01em; color:#1a1917 }
    #bigmap { z-index:50 !important; display:flex !important; background:#f2efe7 !important; opacity:0 }
    #bigmap .mapHint { display:none } #bigmapCanvas { transform-origin:50% 58% }
  ${'`'};
  document.head.appendChild(css);
  const o = document.createElement('div'); o.id = 'promo';
  o.innerHTML = '<div class="title"><h1>2513 Croton Ave</h1><p>Sarasota, Florida</p></div><div class="cap"><b></b><i></i><span></span></div>' +
    '<div class="end"><i class="blk"></i><h1>2513<br>Croton Ave</h1><i class="rule"></i><div class="row"><span>Sarasota, Florida</span><span>Made by Tianfu Wang and friends</span></div></div>';
  document.body.appendChild(o);
  const title = o.querySelector('.title'), cap = o.querySelector('.cap'), end = o.querySelector('.end'), big = document.getElementById('bigmap'), bigCanvas = document.getElementById('bigmapCanvas');
  const caption = (t, t0, t1, n, text) => { if (t < t0 || t > t1) return false; cap.querySelector('i').textContent = n; cap.querySelector('span').textContent = text; cap.style.opacity = Math.min(clamp01((t - t0) / 0.5), clamp01((t1 - t) / 0.5)); return true; };

  // ---- helpers ----
  const openFrench = () => { for (const d of a.getDoors()) if (d.kind === 'french' && !(d.target > 0.5)) a.interact.toggleDoor(d); };
  const homeOf = (r) => (r.userData.home ??= { pos: r.position.clone(), ry: r.rotation.y });
  const faceNorth = (r) => { const f = r.rotation.y + (r.userData.seats?.[0]?.facing ?? 0); return Math.atan2(Math.sin(Math.PI - f), Math.cos(Math.PI - f)); };
  // move a piece along a polyline (clear paths, checked against every wall and piece), then turn it in place
  const move = (r, t, t0, t1, key, pts, turn = 0, rotFrac = 0) => {
    homeOf(r); st[key] ??= { p: r.position.clone(), ry: r.rotation.y };
    const s0 = st[key], u = clamp01((t - t0) / (t1 - t0)), us = rotFrac ? clamp01(u / (1 - rotFrac)) : u, ur = rotFrac ? clamp01((u - (1 - rotFrac)) / rotFrac) : u;
    const all = [[s0.p.x, -s0.p.z], ...pts], segs = all.length - 1, e = ease(us) * segs, i = Math.min(segs - 1, Math.floor(e)), f = e - i;
    r.position.set(all[i][0] + (all[i + 1][0] - all[i][0]) * f, s0.p.y, -(all[i][1] + (all[i + 1][1] - all[i][1]) * f));
    r.rotation.y = s0.ry + turn * ease(ur); r.userData.onMove?.(r);
  };
  const sit = (r) => { p.driven = false; p.enabled = true; const w = new T.Vector3(); r.getWorldPosition(w); a.interact.sitOn(r, w); };
  const stash = () => { for (const n of ['dog', 'cat']) if (pets?.get(n)) pets.hold(n, { x: -9.5, z: -12.5, mode: 'lie' }); };
  const lookAt = (x, y, z, k = 0.12) => { const c = cam.position, want = Math.atan2(-(x - c.x), -(-y - c.z)); p.yaw += Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw)) * k; p.pitch += (Math.atan2(z - c.y, Math.hypot(x - c.x, -y - c.z)) - p.pitch) * k; };
  // glide the camera from wherever it is to a pose
  const glide = (t, t0, t1, key, to) => {
    if (!st[key]) st[key] = { x: cam.position.x, y: -cam.position.z, eye: cam.position.y, h: -p.yaw * 180 / Math.PI, pitch: p.pitch };
    const s0 = st[key], u = ease(clamp01((t - t0) / (t1 - t0)));
    place({ x: lerp(s0.x, to[0], u), y: lerp(s0.y, to[1], u), eye: lerp(s0.eye, to[2], u), h: s0.h + wrap(to[3] - s0.h) * u, pitch: lerp(s0.pitch, to[4], u) });
  };
  const niche = find('niche-sliding-seat', 3.52, 1.36), sling = find('office-sling-chair', -0.08, 4.15), wicker = find('outdoor-wicker-chair', 0.3, 11.6);
  const pouf = find('props-rooms-pouf', 4.46, -3.42), bedPine = find('bedPine', 6.72, -3.95), lounge = find('outdoor-patio-chair', 1.6, 7.9);
  const photo = a.viewpoints.targets.find(v => v.kind === 'photo' && /g20_/.test(v.img || '')), pano = a.viewpoints.targets.find(v => v.id === '1e62b2e6e3');
  if (pano) a.viewpoints.loadPano(pano.id);
  const cur = document.createElement('div'); cur.style.cssText = 'position:fixed;z-index:120;width:34px;height:34px;left:0;top:0;opacity:0;pointer-events:none';
  cur.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M3 2l17 9-7.5 1.8L9 20z" fill="#1a1917" stroke="#f2efe7" stroke-width="1.4"/></svg><i style="position:absolute;left:-16px;top:-16px;width:32px;height:32px;border:3px solid #c8352a;border-radius:50%;opacity:0"></i>';
  document.body.appendChild(cur); const ring = cur.querySelector('i');
  const st = {};

  // ---- shots: [time, plan x, plan y, eye, heading, pitch] ----
  const A = path([[0, 0.3, -9.9, 1.65, 2, -0.02], [5.5, -0.06, -7.2, 1.6, 0, -0.02]]);   // on the front walk, just past the screening planting
  // the walk: a person's pace (~1.3 m/s), through the door's centre, west of the sofa, up the gap between the dining chairs
  // and the niche wall, out through the middle of the dining doors; the eye keeps finding the garden
  const W = path([[5.5, -0.06, -7.2, 1.6, 0, -0.02], [7.6, -0.06, -4.66, 1.6, 3, -0.02], [8.7, 0.25, -3.35, 1.6, 9, -0.02], [10.0, 0.9, -2.0, 1.6, 14, -0.02], [11.0, 1.15, -0.9, 1.6, 16, -0.02], [12.3, 1.75, 0.35, 1.6, 18, -0.02],
                  [14.2, 2.98, 1.95, 1.6, 352, -0.02], [15.4, 3.0, 3.4, 1.6, 350, -0.02], [16.5, 3.0, 4.7, 1.6, 352, -0.02], [17.1, 2.98, 5.42, 1.6, 356, -0.03], [18.9, 3.0, 7.6, 1.6, 352, -0.05], [20.6, 2.9, 9.7, 1.6, 340, -0.07]]);
  const L = path([[20.6, 2.9, 9.7, 1.6, 340, -0.07], [23.4, 3.1, 10.2, 1.65, 200, -0.04]]);
  const K = path([[84, 7.6, 7.5, 1.6, 251, -0.04], [88.6, 6.9, 7.1, 1.6, 254, -0.03]]);
  const Z = path([[88.6, 6.9, 7.1, 1.6, 254, -0.03], [91, 4.9, 11.6, 2.5, 215, -0.12], [94, 0.0, 14.5, 1.62, 180, -0.03]]);
  window.__promo = {
    duration: 99,
    dusk: [86, 88], duskRange: [84, 94],
    prepare(dusk) { st.dusk = dusk; },
    step(t) {
      const once = (k, fn) => { if (!st[k]) { st[k] = 1; fn(); } };
      title.style.opacity = Math.min(clamp01((t - 0.4) / 0.8), clamp01((5.2 - t) / 0.8));
      let shown = false;
      if (t < 5.5) { place(A(t)); once('init', () => { for (const k of ['rn', 'pano', 'photo']) a.markers.toggle(k, false); openFrench(); stage('dog', 3.4, 12.3, 'lie', 0.3, 11.6); stage('cat', 3.4, 9.6, 'sit', 0.3, 11.6); /* out in the garden, east of the fire pit */ }); }
      else if (t < 20.6) {
        place(W(t));
        shown = caption(t, 6, 9.5, '01', 'Through the front door') || caption(t, 9.7, 14, '01', 'The garden, straight ahead') || caption(t, 14.2, 20.5, '01', 'And straight out into it');
      }
      else if (t < 23.4) { place(L(t)); shown = caption(t, 20.8, 23.3, '01', 'Then look back'); }
      else if (t < 33) {
        if (t < 24.6) glide(t, 23.4, 24.6, 'toWicker', [1.3, 10.4, 1.6, 300, -0.15]);
        else once('sitW', () => sit(wicker));
        if (t > 25.6) once('call-dog', () => { free('dog'); pets.call('dog'); });
        if (t > 28.4) once('pet-dog', () => pets.pet('dog'));
        // the cat's walk is scripted: round the south of the fire pit, through the gap between the two coleus, to sit by the chair
        if (t > 28.0 && t < 30.9) {
          const route = [[3.4, 9.6], [2.2, 9.75], [1.35, 10.3], [1.15, 11.0]], lens = [], u = clamp01((t - 28.2) / 2.6);
          let total = 0; for (let i = 1; i < route.length; i++) { const l = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]); lens.push(l); total += l; }
          let d = ease(u) * total, i = 0; while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
          const A0 = route[i], A1 = route[i + 1], f = Math.min(1, d / lens[i]), x = A0[0] + (A1[0] - A0[0]) * f, y = A0[1] + (A1[1] - A0[1]) * f;
          const yaw = Math.atan2(A1[0] - A0[0], -(A1[1] - A0[1])), speed = u > 0 && u < 1 ? 1.0 : 0;
          pets.hold('cat', { x, z: -y, yaw, mode: speed ? 'walk' : 'sit', speed });
        }
        if (t >= 30.9) once('cat-sits', () => { const c = cam.position; pets.hold('cat', { x: 1.15, z: -11.0, yaw: Math.atan2(c.x - 1.15, c.z + 11.0), mode: 'sit', speed: 0 }); });
        if (t > 31.2) once('pet-cat', () => { free('cat'); pets.pet('cat'); });
        const g = pets?.get(t < 29.0 ? 'dog' : 'cat'); if (g && t > 25.6) lookAt(g.x, -g.z, 0.32, 0.07);
        shown = caption(t, 23.6, 26, '02', 'Sit by the fire') || caption(t, 25.7, 28.9, '02', 'The dog comes') || caption(t, 29.0, 32.8, '02', 'And the cat');
      }
      else if (t < 43) {
        once('niche-cut', () => { p.stand(); stash(); });
        if (t < 35.6 || (t >= 38.8 && t < 41)) place({ x: 1.4, y: 0.1, eye: 1.6, h: 58, pitch: -0.24 });
        if (t >= 33.4 && t < 35.4) { st.nT ??= faceNorth(niche); move(niche, t, 33.4, 35.4, 'nc', [[2.85, 1.36]], st.nT, 0.4); }
        if (t >= 35.6 && t < 38.8) once('sitN', () => sit(niche));
        if (t >= 38.8) once('standN', () => p.stand());
        if (t >= 39.2) once('backN', () => a.interact.putBack([niche]));
        if (t >= 41) glide(t, 41, 43, 'toOffice', [0.65, 2.15, 1.6, 335, -0.3]);
        shown = caption(t, 33.3, 35.5, '03', 'A seat in the wall: slide it out') || caption(t, 35.6, 38.7, '03', 'Sit. Look out.') || caption(t, 38.9, 41.0, '03', 'Right-click: back in the wall');
      }
      else if (t < 49) {
        if (t < 45.6) place({ x: 0.65, y: 2.15, eye: 1.6, h: 335, pitch: -0.3 });
        if (t >= 43.3 && t < 45.4) { st.sT ??= faceNorth(sling); move(sling, t, 43.3, 45.4, 'sl', [[0.3, 3.95]], st.sT, 0.4); }
        if (t >= 45.6) once('sitS', () => sit(sling));
        shown = caption(t, 43.2, 45.5, '04', 'The office: turn the chair to the garden') || caption(t, 45.6, 48.9, '04', 'Sit');
      }
      else if (t < 56) {
        once('bed-cut', () => { p.stand(); a.interact.putBack([sling]); });
        if (t < 51.6) place({ x: 5.35 + 0.05 * (t - 49) / 2.6, y: -2.4, eye: 1.6, h: 172 + 4 * (t - 49) / 2.6, pitch: -0.42 });
        if (t >= 49.4 && t < 51.0) move(pouf, t, 49.4, 51.0, 'pf', [[5.2, -3.3]]);
        if (t >= 51.6) once('sitBed', () => sit(bedPine));
        shown = caption(t, 49.2, 51.5, '05', 'A bedroom: slide the pouf') || caption(t, 51.6, 55.9, '05', 'Sit. The garden in the window.');
      }
      else if (t < 63) {
        once('patio-cut', () => { p.stand(); a.interact.putBack([pouf]); });
        if (t < 59.2) place({ x: 3.2 - 0.2 * (t - 56) / 3.2, y: 10.0 - 0.2 * (t - 56) / 3.2, eye: 1.6, h: 215 + 7 * (t - 56) / 3.2, pitch: -0.32 });
        if (t >= 56.6 && t < 58.6) move(lounge, t, 56.6, 58.6, 'lg', [[2.3, 8.4]], -1.4, 0.4);
        if (t >= 59.2) once('sitL', () => sit(lounge));
        shown = caption(t, 56.4, 59.1, '06', 'The patio: turn a lounge chair to the garden') || caption(t, 59.2, 62.9, '06', 'Sit in the sun');
      }
      else if (t < 72) {
        // the plan: toggle the photograph pins, then the panorama pins, then click a photograph and fly there
        once('map', () => { p.stand(); a.minimap.bigOpen = true; big.classList.remove('hidden'); bigCanvas.style.transform = 'none'; bigCanvas.style.width = '1560px'; bigCanvas.style.height = '920px'; a.minimap.drawBig(); });
        if (t < 67.8) {
          big.style.opacity = clamp01((t - 63) / 0.4);
          const r = bigCanvas.getBoundingClientRect(), m = a.minimap.bigMetrics(), dpr = a.minimap.dpr, [cx, cy] = m.toC(photo.x, photo.y);
          const leg = (i) => [r.left + 27, r.top + r.height - 22 - (2 - i) * 22 - 5];
          const P0 = [r.right - 220, r.bottom - 160], P1 = leg(2), P2 = leg(1), P3 = [r.left + cx / dpr, r.top + cy / dpr];
          const seg = (q, A, B, t0, t1) => { const u = ease(clamp01((t - t0) / (t1 - t0))); return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u]; };
          const pos = t < 64.4 ? seg(0, P0, P1, 63.4, 64.3) : t < 65.6 ? seg(0, P1, P2, 64.7, 65.4) : seg(0, P2, P3, 65.9, 67.2);
          cur.style.opacity = clamp01((t - 63.2) / 0.3); cur.style.transform = 'translate(' + pos[0].toFixed(1) + 'px, ' + pos[1].toFixed(1) + 'px)';
          const clickAt = [64.4, 65.6, 67.4].find(c => t >= c && t < c + 0.6);
          if (clickAt !== undefined) { const k = (t - clickAt) / 0.6; ring.style.opacity = (1 - k).toFixed(2); ring.style.transform = 'scale(' + (0.6 + 1.4 * k).toFixed(2) + ')'; } else ring.style.opacity = 0;
          if (t >= 64.4) once('pinsPhoto', () => a.markers.toggle('photo', true));
          if (t >= 65.6) once('pinsPano', () => a.markers.toggle('pano', true));
          a.minimap.drawBig();
        } else {
          once('fly', () => { cur.style.opacity = 0; big.style.opacity = 0; big.classList.add('hidden'); a.minimap.bigOpen = false; for (const k of ['photo', 'pano']) a.markers.toggle(k, false); a.viewpoints.goTo(photo, { silent: true, duration: 3.6 }); });
        }
        shown = caption(t, 63.2, 64.6, '07', 'The plan: show the photographs') || caption(t, 64.7, 65.8, '07', 'and the panoramas') || caption(t, 65.9, 67.7, '07', 'Click one') || caption(t, 67.8, 71.9, '07', 'And fly there');
      }
      else if (t < 78) {
        once('cmp', () => a.viewpoints.openCompare(photo.img));
        const u = t < 74.4 ? ease(clamp01((t - 72.2) / 2.0)) : t < 76.4 ? 1 - 0.55 * ease(clamp01((t - 74.4) / 1.8)) : 0.45;
        a.viewpoints.setWipe((100 * (1 - u)).toFixed(1));
        shown = caption(t, 72.2, 77.8, '08', 'The listing photograph, over the model');
      }
      else if (t < 84) {
        once('pano', () => { a.viewpoints.closeCompare(); a.viewpoints.enterPano(pano); });
        p.yaw = rad(-(300 + 100 * ease(clamp01((t - 78.6) / 5.0)))); p.pitch = 0.04; cam.rotation.set(0, 0, 0, 'YXZ'); cam.rotation.y = p.yaw; cam.rotation.x = p.pitch;
        shown = caption(t, 78.4, 83.8, '09', 'Step into the Zillow panorama');
      }
      else if (t < 94) {
        once('dusk-shot', () => { a.viewpoints.exitPano(); stage('dog', 4.6, 6.6, 'lie', 7.0, 7.2); stage('cat', 5.2, 6.4, 'sit', 7.0, 7.2); });
        place(t < 88.6 ? K(t) : Z(t)); shown = caption(t, 85, 93.8, '10', 'Day into dusk');
      }
      else { end.style.opacity = clamp01((t - 94) / 0.6); }
      if (!shown) cap.style.opacity = 0;
    },
  };
})();`;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { localStorage.setItem('croton-lang', 'en'); localStorage.setItem('croton-music', '0'); });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8780/index.html?auto=1&capture&petseed=3', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 200000 });
await page.evaluate(() => document.fonts.ready);
await page.addScriptTag({ content: PAGE });
const dur = await page.evaluate(() => window.__promo.duration), [fadeA, fadeB] = await page.evaluate(() => window.__promo.dusk), [dA, dB] = await page.evaluate(() => window.__promo.duskRange);
const from = arg('--from', 0), to = arg('--to', dur);
const step = (t) => page.evaluate((t) => { window.__promo.step(t); window.renderAt(window.simTime() + 1 / 30); }, t);
const shot = (file) => page.screenshot({ path: file, type: 'jpeg', quality: 93 });

if (stills) {
  // one frame per shot (stepping the whole timeline so state is right), for checking compositions
  const marks = [2, 7, 10, 12.5, 14.5, 16.4, 19, 22.8, 25.5, 28, 31.5, 34.2, 35.3, 37.5, 40, 42.4, 44.4, 47.5, 50.2, 54, 57.8, 61, 64.6, 66.6, 70, 75, 81, 86.5, 90, 93.6, 97];
  let mi = 0;
  for (let f = 0; f <= Math.round(dur * FPS) && mi < marks.length; f++) {
    const t = f / FPS;
    if (!(await page.evaluate(() => window.__app.state.dusk)) && t >= fadeA) { await page.evaluate(async () => { window.__app.state.dusk = true; window.__promo.prepare(true); await window.__app.applyTime(); }); }
    await step(t);
    if (t >= marks[mi]) { await shot(`${out}/still_${String(mi).padStart(2, '0')}_${marks[mi]}s.jpg`); mi++; }
  }
  console.log('stills written'); await browser.close(); process.exit(0);
}

// full film: render every frame; shot 5 is rendered twice (day, then dusk) and crossfaded later
const total = Math.round(dur * FPS), t0 = Date.now();
let duskDone = false;
for (let f = 0; f < total; f++) {
  const t = f / FPS;
  if (t < from || t > to) { await page.evaluate((t) => { window.__promo.step(t); window.renderAt(window.simTime() + 1 / 30); }, t); continue; }
  await step(t);
  await shot(`${out}/f${String(f).padStart(5, '0')}.jpg`);
  // after the day pass of shot 5, re-render shot 5 at dusk into d*.jpg
  if (!duskDone && t >= dB - 1 / FPS) {
    duskDone = true;
    await page.evaluate(async () => { window.__app.state.dusk = true; window.__promo.prepare(true); await window.__app.applyTime(); });
    for (let g = Math.round(dA * FPS); g < Math.round(dB * FPS); g++) { await step(g / FPS); await shot(`${out}/d${String(g).padStart(5, '0')}.jpg`); }
    // stay at dusk: the map fades in over the last garden frame, which must match the dusk ending of the crossfade
  }
  if (f % 60 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
fs.writeFileSync(`${out}/meta.json`, JSON.stringify({ fps: FPS, total, duskFade: [fadeA, fadeB], duskRange: [dA, dB] }));
console.log('done', total, 'frames'); await browser.close();
