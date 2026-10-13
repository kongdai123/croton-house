// Zillow viewpoints: fly to the exact spot a listing photo or 3D-Home panorama was taken, then compare the real image with
// the 3D view (wipe slider), or step into the panorama itself (C toggles).
import { THREE } from './kit.js';
import { t, getLang } from './ui.js';
import { buildGrid, navPath } from './nav.js';
import { getDoors, setFrench, setHinged, setBifold } from './house.js';
import { doorIsOpen } from './interact.js';

const SWING_DOORS = new Set(['door', 'front', 'french', 'bifold']);
const OPEN_AHEAD = 2.4;   // metres of route before a doorway at which its door starts to open
export function setDoorOpen(d, on) { if (d.kind === 'french') setFrench(d, on ? 1 : 0); else if (d.kind === 'bifold') setBifold(d, on ? 1 : 0); else setHinged(d, on); }
// Distance from (x,z) beyond which a door's leaves can swing without touching the camera.
const swingClear = (d, x, z) => Math.hypot(x - d.plan.cx, z + d.plan.cy) > (d.w ?? 0.8) * (d.kind === 'french' ? 0.5 : 1) + 0.35;
// Arc length along the route at which it passes through each swinging doorway.
function doorCrossings(curve, L) {
  const n = Math.max(2, Math.ceil(L / 0.05)), pts = curve.getSpacedPoints(n), out = [];
  for (const d of getDoors()) {
    if (!SWING_DOORS.has(d.kind)) continue;
    const { cx, cy, isH } = d.plan, half = (d.w ?? 0.8) / 2 + 0.05;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], sa = isH ? a.z + cy : a.x - cx, sb = isH ? b.z + cy : b.x - cx;
      if ((sa <= 0) === (sb <= 0)) continue;
      const f = sa / (sa - sb), along = isH ? a.x + (b.x - a.x) * f - cx : a.z + (b.z - a.z) * f + cy;
      if (Math.abs(along) <= half) { out.push({ d, s: (k - 1 + f) / n * L }); break; }
    }
  }
  return out;
}

const VB = [-8.246258596094643, -5.699660161646401, 16.50411768657405, 11.778618533436845];
const toPlan = (px, py) => [VB[0] + px / 100 * VB[2], -(VB[1] + py / 100 * VB[3])];
const easeInOutQuart = (x) => x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const angTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));   // shortest signed turn from a to b
const angMix = (a, b, w) => a + angTo(a, b) * w;
const CAM_H = 1.5;   // real-estate tripod height
const TRIM = { '26bd39e7b7': 10, '954f8388b8': 15, d5e1aedcc0: 25, ee4635b067: -28, b9a18422cd: -10, '03fae42bc1': 35 };   // degrees, from the side-by-side check
// Outdoor panoramas are not on the Zillow plan; placed from their content (patio by the office doors, backyard by the fire pit)
const EXTRA_PANO = { f393dd3f56: { x: 0.9, y: 7.4, title: 'Patio' }, '24094ad9a5': { x: 6.0, y: 12.8, title: 'Backyard' } };

// Overlay layer: drawn after post-processing, on top of the finished frame (main.js). The panorama sphere and the floating
// photo cards live here, so ambient occlusion and the tone curve never touch them.
export const OVERLAY_LAYER = 7, PANO_LAYER = OVERLAY_LAYER;
export class Viewpoints {
  constructor(scene, camera, player, points, tour, ui, renderer, photoSpots = []) {
    this.scene = scene; this.camera = camera; this.player = player; this.points = points; this.tour = tour; this.ui = ui; this.renderer = renderer;
    this.photoSpots = photoSpots;
    this.fly = null; this.compareOpen = false; this.panoActive = false; this.current = null;
    this.panoYaw = {}; this.calibratePanos();
    this.targets = this.buildTargets();
    // pano sphere
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(30, 64, 32), new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false })); this.sphere.layers.set(PANO_LAYER);   // drawn by main.js as an overlay, never inside the house render
    this.sphere.scale.x = -1; this.sphere.visible = false; this.sphere.renderOrder = 999; scene.add(this.sphere);
    this.texCache = new Map(); this.loader = new THREE.TextureLoader(); this.renderer = renderer;
    this.panoProgress = new Map(); this.panoReady = new Set();
    this.panoLoadEl = document.getElementById('panoload'); this.panoLoadText = document.getElementById('panoloadText'); this.panoLoadBar = document.getElementById('panoloadBar');
    this.compare = document.getElementById('compare'); this.compareImg = document.getElementById('compareImg'); this.slider = document.getElementById('compareSlider');
    const bar = document.createElement('div'); bar.className = 'bar'; this.compare.appendChild(bar); this.bar = bar;
    this.slider.oninput = () => this.setWipe(+this.slider.value);
    this.exitBox = document.getElementById('viewExit');
    document.getElementById('viewExitBtn').onclick = () => { this.exitPano(); this.closeCompare(); };
    addEventListener('langchange', () => { if (this.panelOpen) this.renderPanel(); });
  }
  // Each pano's forward direction: destinations give departureAngle (deg) toward a neighbour whose plan position we know.
  calibratePanos() {
    const pos = {}; for (const p of this.points.panorama) pos[p.id] = toPlan(p.x, p.y); for (const [id, e] of Object.entries(EXTRA_PANO)) pos[id] = [e.x, e.y];
    for (const p of this.tour.panos) {
      const a = pos[p.id]; if (!a) continue; let sx = 0, sy = 0, n = 0;
      for (const d of p.destinations) { const b = pos[d.dest]; if (!b) continue; const bearing = Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;  // plan heading to the neighbour
        const f = bearing - d.departureAngle; sx += Math.cos(f * Math.PI / 180); sy += Math.sin(f * Math.PI / 180); n++; }
      this.panoYaw[p.id] = (n ? Math.atan2(sy, sx) * 180 / Math.PI : 0) + (TRIM[p.id] || 0);   // heading (deg) that the pano's u=0.5 column looks toward
    }
  }
  buildTargets() {
    const list = [];
    const byId = Object.fromEntries(this.tour.panos.map(p => [p.id, p]));
    for (const p of [...this.points.panorama].sort((a, b) => a.order - b.order)) { const [x, y] = toPlan(p.x, p.y); list.push({ kind: 'pano', id: p.id, x, y, heading: this.panoYaw[p.id] ?? 0, title: p.title, thumb: `assets/pano_thumbs/${p.id}.webp`, order: p.order }); }
    for (const [id, e] of Object.entries(EXTRA_PANO)) list.push({ kind: 'pano', id, x: e.x, y: e.y, heading: this.panoYaw[id] ?? 0, title: e.title, thumb: `assets/pano_thumbs/${id}.webp`, order: 20 });
    const order = this.points.photo.slice().sort((a, b) => a.gallery - b.gallery);
    for (const p of order) {
      const [x, y] = toPlan(p.x, p.y), id = `g${String(p.gallery).padStart(2, '0')}`;
      const s = this.photoSpots.find(s => s.id === id || s.id === p.id || s.file?.startsWith(id + '_'));
      list.push({ kind: 'photo', id: p.id, x: s?.x ?? x, y: s?.y ?? y, heading: s?.heading ?? p.angle, pitch: s?.pitch ?? 0, eye: s?.eye ?? CAM_H, quality: s?.quality, zh: s?.zh, en: s?.en, gallery: p.gallery, title: `#${p.gallery}`, img: `assets/photos/${s?.file ?? `${id}_${p.id.slice(0, 8)}.jpg`}` });
    }
    for (const s of this.photoSpots) {
      const gallery = +s.id.replace(/^g/, ''); if (list.some(v => v.kind === 'photo' && v.gallery === gallery)) continue;
      list.push({ ...s, kind: 'photo', gallery, title: `#${gallery}`, img: `assets/photos/${s.file}` });
    }
    return list.sort((a, b) => a.kind === b.kind && a.kind === 'photo' ? a.gallery - b.gallery : 0);
  }
  extraBlips() { return Object.entries(EXTRA_PANO).map(([id, e]) => ({ kind: 'pano', id, x: e.x, y: e.y, title: e.title })); }
  roomOf(x, y) { for (const n of this.points_notes || []) {} return ''; }
  togglePanel(kind = 'pano') {
    if (this.panelOpen && this.panelKind === kind) { this.ui.closePanel(); this.panelOpen = false; this.panelKind = ''; return; }
    this.renderPanel(kind);
  }
  renderPanel(kind = 'pano') {
    const body = document.createElement('div');
    const sec = (title) => { const h = document.createElement('div'); h.style.cssText = 'font-weight:700;margin:10px 8px 4px;color:#8a847a;font-size:12px;letter-spacing:.08em;text-transform:uppercase'; h.textContent = title; body.appendChild(h); };
    if (kind !== 'photo') { sec(t('panos') + ' · Zillow 3D Home'); for (const v of this.targets.filter(v => v.kind === 'pano')) body.appendChild(this.row(v)); }
    if (kind !== 'pano') { sec(t('photos') + ' · Zillow'); for (const v of this.targets.filter(v => v.kind === 'photo')) body.appendChild(this.row(v)); }
    this.ui.openPanel(kind === 'photo' ? t('photos') : t('viewpointsTitle'), body); this.panelOpen = true; this.panelKind = kind;
  }
  row(v) {
    const el = document.createElement('div'); el.className = 'vp' + (this.current?.id === v.id ? ' active' : '');
    const img = document.createElement('img'); img.loading = 'lazy'; img.src = v.img || v.thumb; el.appendChild(img);
    const tx = document.createElement('div'); tx.innerHTML = `<div class="t"><span class="dot ${v.kind}"></span>${v.kind === 'pano' ? t(v.title) : t('photo') + ' ' + v.title}</div><div class="s">${v.kind === 'pano' ? t('pano') : `${Math.round(v.heading)}°`}</div>`; el.appendChild(tx);
    el.onclick = () => { this.goTo(v); this.ui.closePanel(); this.panelOpen = false; };
    return el;
  }
  // Fly to a target (plan x,y, heading), then show its photo card.
  goTo(target, opts = {}) {
    if (!target) return;
    this.exitPano(); this.closeCompare(); this.markers?.closeCard();
    if (target.kind === 'pano') this.loadPano(target.id);
    this.player.resetJump(); this.player.viewEye = null;
    const full = target.kind === 'point' ? target : (this.targets.find(v => v.id === target.id) || target);
    const from = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw, pitch: this.player.pitch, eye: this.player.eye };
    const to = { x: full.x, z: -full.y, yaw: THREE.MathUtils.degToRad(-(full.heading ?? this.player.heading)), pitch: full.pitch ?? 0, eye: full.eye ?? (full.kind === 'point' ? 1.62 : CAM_H) };
    let dy = to.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); to.yaw = from.yaw + dy;
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    // route around walls and furniture through the doorways instead of flying straight through them
    let path = null;
    if (dist > 0.6 && !opts.direct) { try { path = navPath(buildGrid(this.player.extraColliders?.() ?? []), from.x, from.z, to.x, to.z); } catch (e) { console.warn('nav', e); } }
    const len = path ? path.length : dist;
    const dur = opts.duration ?? (path ? Math.min(9, Math.max(1.2, 0.9 + len / 1.9)) : Math.min(2.6, 0.8 + dist * 0.12));
    if (this.player.seat) this.player.stand();
    this.fly = { from, to, t: 0, dur, target: full, onDone: opts.onDone, silent: opts.silent, keepDriven: opts.keepDriven, path, yaw: from.yaw, doors: path ? doorCrossings(path.curve, path.length) : [] };
    this.player.enabled = false; this.player.driven = true;
    if (!opts.silent) this.ui.toast(t('fly'), 900);
  }
  // Doors on the route open ahead of the camera; doors it opened close again once the camera is out of their swing.
  directDoors(s, dt = 0) {
    this.autoOpened ??= new Set();
    const f = this.fly, ahead = new Set();
    let lead = OPEN_AHEAD;
    if (f) { if (f.prevS !== undefined && dt > 0) lead = Math.max(OPEN_AHEAD, (s - f.prevS) / dt * 1.3); f.prevS = s; }
    for (const c of f?.doors ?? []) {
      if (c.s - s > -0.3) ahead.add(c.d);
      if (!c.opened && c.s - s < lead) { c.opened = true; if (!doorIsOpen(c.d)) { setDoorOpen(c.d, true); this.autoOpened.add(c.d); } }
    }
    const p = this.player.pos;
    for (const d of this.autoOpened) if (!ahead.has(d) && swingClear(d, p.x, p.z)) { setDoorOpen(d, false); this.autoOpened.delete(d); }
  }
  update(dt) {
    if (this.player.driven && !this.fly && this.autoOpened?.size) this.directDoors(0);
    if (this.fly) {
      const f = this.fly; f.t = Math.min(1, f.t + dt / f.dur);
      if (f.path) {
        // walk the route: look where we're going mid-flight, settle into the target view at the end
        const e = easeInOutSine(f.t), c = f.path.curve, L = f.path.length, p = c.getPointAt(e);
        this.directDoors(e * L, dt);
        const a = c.getPointAt(Math.min(1, e + 1.4 / L)), travel = Math.hypot(a.x - p.x, a.z - p.z) > 0.05 ? Math.atan2(-(a.x - p.x), -(a.z - p.z)) : f.yaw;
        const wS = 1 - sstep(0, 0.22, e), wE = L < 1.5 ? e : sstep(0.6, 1, e);
        const want = angMix(angMix(travel, f.from.yaw, wS), f.to.yaw, wE);
        f.yaw = angMix(f.yaw, want, 1 - Math.exp(-dt * 6));
        this.player.yaw = angMix(f.yaw, want, sstep(0.85, 1, e));
        const level = f.from.pitch + (0 - f.from.pitch) * (1 - wS);
        this.player.pitch = level + (f.to.pitch - level) * wE;
        this.player.pos.x = p.x; this.player.pos.z = p.z;
        // big height changes (aerial tour stops) finish descending well before the route reaches a doorway
        const de = f.to.eye - f.from.eye, ke = de < -1 ? sstep(0, 0.55, e) : de > 1 ? sstep(0.45, 1, e) : e;
        this.player.eye = f.from.eye + de * ke;
      } else {
        const e = easeInOutQuart(f.t);
        this.player.pos.x = f.from.x + (f.to.x - f.from.x) * e; this.player.pos.z = f.from.z + (f.to.z - f.from.z) * e;
        this.player.yaw = f.from.yaw + (f.to.yaw - f.from.yaw) * e; this.player.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * e;
        // straight aerial legs keep their height over the planting and drop at the end (or climb first)
        const de = f.to.eye - f.from.eye, ke = de < -1 ? sstep(0.45, 1, e) : de > 1 ? sstep(0, 0.55, e) : e;
        this.player.eye = f.from.eye + de * ke;
      }
      if (f.t >= 1) { this.player.pos.x = f.to.x; this.player.pos.z = f.to.z; this.player.yaw = f.to.yaw; this.player.pitch = f.to.pitch; this.player.eye = f.to.eye; }
      this.player.camera.position.set(this.player.pos.x, this.player.eye, this.player.pos.z);
      this.player.camera.rotation.set(0, 0, 0, 'YXZ'); this.player.camera.rotation.y = this.player.yaw; this.player.camera.rotation.x = this.player.pitch;
      if (f.t >= 1) { this.fly = null; this.player.enabled = true; this.player.driven = !!f.keepDriven; this.current = f.target; this.player.viewEye = ['rn', 'photo', 'pano'].includes(f.target.kind) ? f.to.eye : null; if (!f.silent) this.arrived(f.target); f.onDone?.(); }
      return;
    }
    if (this.panoActive) {
      // keep the sphere on the camera; fade in; freeze walking (looking stays free)
      this.sphere.position.copy(this.camera.position);
      this.sphere.material.opacity = Math.min(1, this.sphere.material.opacity + dt * 2.5);
      this.player.enabled = false; this.player.pos.x = this.panoPos.x; this.player.pos.z = this.panoPos.z;
      // leaving: any move key exits
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some(k => this.player.keys.has(k))) this.exitPano();
    }
  }
  // Panoramas are 4096 x 2048. Decoding one with an <img> and uploading it on first draw froze the tab for 0.2–0.9 s, so
  // they decode off the main thread (createImageBitmap, flipped like a TextureLoader image) and upload ahead of time.
  // Arriving at a panorama's viewpoint, or flying to one, starts this in the background, so C opens it at once.
  loadPano(id) {
    let job = this.texCache.get(id);
    if (job) return job;
    const finish = (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 8; tex.needsUpdate = true; try { this.renderer?.initTexture(tex); } catch (_) {} return tex; };
    const viaImage = () => this.loader.loadAsync(`assets/panos/${id}.jpg`).then(finish);
    // Read the download in chunks so the loading indicator can show real progress (Content-Length is always sent for JPEGs).
    const download = async () => {
      const r = await fetch(`assets/panos/${id}.jpg`);
      if (!r.ok) throw new Error(String(r.status));
      const total = +r.headers.get('content-length') || 0;
      if (!r.body || !total) return r.blob();
      const reader = r.body.getReader(), chunks = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; this.panoProgress.set(id, Math.min(1, got / total)); }
      return new Blob(chunks, { type: 'image/jpeg' });
    };
    job = (typeof createImageBitmap === 'function'
      ? download()
        .then(blob => createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
        .then(bitmap => { const tex = new THREE.Texture(bitmap); tex.flipY = false; return finish(tex); })
        .catch(viaImage)
      : viaImage());
    job.then(() => this.panoReady.add(id), () => this.texCache.delete(id));
    this.texCache.set(id, job);
    return job;
  }
  // Loading indicator: a small glass pill in the middle of the view with the real download percentage, then "decoding".
  showPanoLoading(id, request) {
    const el = this.panoLoadEl; if (!el) return;
    this.panoLoadRequest = request; el.classList.remove('hidden');
    const tick = () => {
      if (this.panoLoadRequest !== request || el.classList.contains('hidden')) return;
      const p = this.panoProgress.get(id) ?? 0;
      this.panoLoadText.textContent = p >= 1 ? t('panoDecoding') : `${t('panoLoading')} ${Math.round(p * 100)}%`;
      this.panoLoadBar.style.transform = `scaleX(${Math.max(0.04, p)})`;
      requestAnimationFrame(tick);
    };
    tick();
  }
  hidePanoLoading(request) { if (request === undefined || this.panoLoadRequest === request) { this.panoLoadEl?.classList.add('hidden'); this.panoLoadRequest = 0; } }
  // Once the panorama has faded in it covers everything: main.js then draws only the sphere and lifts the frame cap.
  get panoOpaque() { return this.panoActive && this.sphere.material.opacity >= 1; }
  arrived(v) {
    if (v.kind === 'pano') this.loadPano(v.id);
    if (v.kind === 'photo' || v.kind === 'pano') this.markers?.openTargetCard(v);
  }
  openCompare(src) { this.markers?.closeCard(); this.compareImg.src = src; this.compare.classList.remove('hidden'); this.compareOpen = true; this.setWipe(+this.slider.value); this.player.unlock(); this.syncExit(); }
  closeCompare() { if (!this.compareOpen) return; this.compare.classList.add('hidden'); this.compareOpen = false; this.syncExit(); }
  syncExit() { const mode = this.panoActive ? 'pano' : this.compareOpen ? 'compare' : ''; this.exitBox.dataset.mode = mode; this.exitBox.classList.toggle('hidden', !mode); }
  setWipe(v) { this.compareImg.style.clipPath = `inset(0 ${100 - v}% 0 0)`; this.bar.style.left = `${v}%`; }
  toggleCompare() {
    if (this.compareOpen) { this.closeCompare(); return; }
    if (this.fly || window.__app?.tourCtl?.active) return;
    if (this.panoActive) { this.exitPano(); return; }
    if (this.current?.kind === 'photo') this.openCompare(this.current.img);
    else if (this.current?.kind === 'pano') this.enterPano(this.current);
  }
  async enterPano(v) {
    this.markers?.closeCard(); this.player.resetJump();
    const request = this.panoRequest = (this.panoRequest || 0) + 1;
    const job = this.loadPano(v.id);
    if (!this.panoReady.has(v.id)) this.showPanoLoading(v.id, request);
    const tex = await job.catch(() => null);
    this.hidePanoLoading(request);
    if (!tex) { this.ui.toast(t('panoFailed')); return; }
    if (this.panoRequest !== request || this.fly || window.__app?.tourCtl?.active) return;
    this.sphere.material.map = tex; this.sphere.material.needsUpdate = true; this.sphere.material.opacity = 0; this.sphere.visible = true;
    // Orientation: the texture's centre column should look toward plan heading `v.heading`. With scale.x=-1 the sphere's
    // u=0.5 faces +Z (world south, heading 180). Rotate so it faces the calibrated heading instead.
    this.sphere.rotation.y = THREE.MathUtils.degToRad(180 - v.heading) + (this.panoTrim || 0);
    this.panoActive = true; this.panoPos = { x: v.x, z: -v.y }; this.panoTarget = v; this.syncExit();
    document.body.classList.add('in-pano');   // hides the crosshair and aim label; interact.js stops aiming at the hidden house
    this.ui.toast(`${t('pano')} · ${t(v.title)} · ${t('panoCard')}`, 3500);
    this.player.lock();
  }
  exitPano() { this.panoRequest = (this.panoRequest || 0) + 1; this.hidePanoLoading(); if (!this.panoActive) return; this.panoActive = false; document.body.classList.remove('in-pano'); this.sphere.visible = false; this.sphere.material.opacity = 0; this.player.enabled = true; this.syncExit(); }
}
