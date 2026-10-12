// Zillow viewpoints: fly to the exact spot a listing photo or 3D-Home panorama was taken, then compare the real image with
// the 3D view (wipe slider), or step into the panorama itself (Space toggles).
import { THREE } from './kit.js';
import { t, getLang } from './ui.js';

const VB = [-8.246258596094643, -5.699660161646401, 16.50411768657405, 11.778618533436845];
const toPlan = (px, py) => [VB[0] + px / 100 * VB[2], -(VB[1] + py / 100 * VB[3])];
const easeInOutQuart = (x) => x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
const CAM_H = 1.5;   // real-estate tripod height
const TRIM = { '26bd39e7b7': 10, '954f8388b8': 15, d5e1aedcc0: 25, ee4635b067: -28, b9a18422cd: -10, '03fae42bc1': 35 };   // degrees, from the side-by-side check
// Outdoor panoramas are not on the Zillow plan; placed from their content (patio by the office doors, backyard by the fire pit)
const EXTRA_PANO = { f393dd3f56: { x: 0.9, y: 7.4, title: 'Patio' }, '24094ad9a5': { x: 6.0, y: 12.8, title: 'Backyard' } };

export class Viewpoints {
  constructor(scene, camera, player, points, tour, ui, renderer) {
    this.scene = scene; this.camera = camera; this.player = player; this.points = points; this.tour = tour; this.ui = ui; this.renderer = renderer;
    this.fly = null; this.compareOpen = false; this.panoActive = false; this.current = null;
    this.panoYaw = {}; this.calibratePanos();
    this.targets = this.buildTargets();
    // pano sphere
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(30, 64, 32), new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    this.sphere.scale.x = -1; this.sphere.visible = false; this.sphere.renderOrder = 999; scene.add(this.sphere);
    this.texCache = new Map(); this.loader = new THREE.TextureLoader();
    this.compare = document.getElementById('compare'); this.compareImg = document.getElementById('compareImg'); this.slider = document.getElementById('compareSlider');
    const bar = document.createElement('div'); bar.className = 'bar'; this.compare.appendChild(bar); this.bar = bar;
    this.slider.oninput = () => this.setWipe(+this.slider.value);
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
    for (const p of [...this.points.panorama].sort((a, b) => a.order - b.order)) { const [x, y] = toPlan(p.x, p.y); list.push({ kind: 'pano', id: p.id, x, y, heading: this.panoYaw[p.id] ?? 0, title: p.title, thumb: `assets/panos/${p.id}.jpg`, order: p.order }); }
    for (const [id, e] of Object.entries(EXTRA_PANO)) list.push({ kind: 'pano', id, x: e.x, y: e.y, heading: this.panoYaw[id] ?? 0, title: e.title, thumb: `assets/panos/${id}.jpg`, order: 20 });
    const order = this.points.photo.slice().sort((a, b) => a.gallery - b.gallery);
    for (const p of order) { const [x, y] = toPlan(p.x, p.y); list.push({ kind: 'photo', id: p.id, x, y, heading: p.angle, gallery: p.gallery, title: `#${p.gallery}`, img: `assets/photos/g${String(p.gallery).padStart(2, '0')}_${p.id.slice(0, 8)}.jpg` }); }
    return list;
  }
  extraBlips() { return Object.entries(EXTRA_PANO).map(([id, e]) => ({ kind: 'pano', id, x: e.x, y: e.y, title: e.title })); }
  roomOf(x, y) { for (const n of this.points_notes || []) {} return ''; }
  togglePanel() { if (this.panelOpen) { this.ui.closePanel(); this.panelOpen = false; return; } this.renderPanel(); }
  renderPanel() {
    const body = document.createElement('div');
    const sec = (title) => { const h = document.createElement('div'); h.style.cssText = 'font-weight:700;margin:10px 8px 4px;color:#8a847a;font-size:12px;letter-spacing:.08em;text-transform:uppercase'; h.textContent = title; body.appendChild(h); };
    sec(t('pano') + ' · Zillow 3D Home');
    for (const v of this.targets.filter(v => v.kind === 'pano')) body.appendChild(this.row(v));
    sec(t('photo') + ' · Zillow');
    for (const v of this.targets.filter(v => v.kind === 'photo')) body.appendChild(this.row(v));
    this.ui.openPanel(t('viewpointsTitle'), body); this.panelOpen = true;
  }
  row(v) {
    const el = document.createElement('div'); el.className = 'vp' + (this.current?.id === v.id ? ' active' : '');
    const img = document.createElement('img'); img.loading = 'lazy'; img.src = v.img || v.thumb; el.appendChild(img);
    const tx = document.createElement('div'); tx.innerHTML = `<div class="t"><span class="dot ${v.kind}"></span>${v.kind === 'pano' ? t(v.title) : t('photo') + ' ' + v.title}</div><div class="s">${v.kind === 'pano' ? t('pano') : `${Math.round(v.heading)}°`}</div>`; el.appendChild(tx);
    el.onclick = () => { this.goTo(v); this.ui.closePanel(); this.panelOpen = false; };
    return el;
  }
  // Fly the player to a target (plan x,y, heading) with an ease-in-out curve; on arrival open the compare (photo) or pano.
  goTo(target, opts = {}) {
    if (!target) return;
    this.exitPano(); this.closeCompare();
    const full = target.kind === 'point' ? target : (this.targets.find(v => v.id === target.id) || target);
    const from = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw, pitch: this.player.pitch, eye: this.player.eye };
    const to = { x: full.x, z: -full.y, yaw: THREE.MathUtils.degToRad(-(full.heading ?? this.player.heading)), pitch: full.pitch ?? 0, eye: full.kind === 'point' ? 1.62 : CAM_H };
    let dy = to.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); to.yaw = from.yaw + dy;
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const dur = opts.duration ?? Math.min(2.6, 0.8 + dist * 0.12);
    if (this.player.seat) this.player.stand();
    this.fly = { from, to, t: 0, dur, target: full, onDone: opts.onDone, silent: opts.silent };
    this.player.enabled = false;
    if (!opts.silent) this.ui.toast(t('fly'), 900);
  }
  update(dt) {
    if (this.fly) {
      const f = this.fly; f.t = Math.min(1, f.t + dt / f.dur); const e = easeInOutQuart(f.t);
      this.player.pos.x = f.from.x + (f.to.x - f.from.x) * e; this.player.pos.z = f.from.z + (f.to.z - f.from.z) * e;
      this.player.yaw = f.from.yaw + (f.to.yaw - f.from.yaw) * e; this.player.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * e;
      this.player.eye = f.from.eye + (f.to.eye - f.from.eye) * e;
      this.player.camera.position.set(this.player.pos.x, this.player.eye, this.player.pos.z);
      this.player.camera.rotation.set(0, 0, 0, 'YXZ'); this.player.camera.rotation.y = this.player.yaw; this.player.camera.rotation.x = this.player.pitch;
      if (f.t >= 1) { this.fly = null; this.player.enabled = true; this.current = f.target; if (!f.silent) this.arrived(f.target); f.onDone?.(); }
      return;
    }
    if (this.panoActive) {
      // keep the sphere on the camera; fade in; freeze walking (looking stays free)
      this.sphere.position.copy(this.camera.position);
      this.sphere.material.opacity = Math.min(1, this.sphere.material.opacity + dt * 2.5);
      this.player.enabled = false; this.player.pos.x = this.panoPos.x; this.player.pos.z = this.panoPos.z;
      // leaving: any move key exits
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].some(k => this.player.keys.has(k))) this.exitPano();
    }
  }
  arrived(v) {
    if (v.kind === 'photo') { this.openCompare(v.img); this.ui.toast(`${t('photo')} ${v.title} · ${t('comparehint')}`, 3500); }
    else if (v.kind === 'pano') { this.enterPano(v); }
  }
  openCompare(src) { this.compareImg.src = src; this.compare.classList.remove('hidden'); this.compareOpen = true; this.setWipe(+this.slider.value); this.player.unlock(); }
  closeCompare() { if (!this.compareOpen) return; this.compare.classList.add('hidden'); this.compareOpen = false; }
  setWipe(v) { this.compareImg.style.clipPath = `inset(0 ${100 - v}% 0 0)`; this.bar.style.left = `${v}%`; }
  toggleCompare() {
    if (this.compareOpen) { this.closeCompare(); return; }
    if (this.panoActive) { this.sphere.material.opacity = this.sphere.material.opacity > 0.5 ? 0 : 1; this.sphere.visible = this.sphere.material.opacity > 0.5; return; }
    if (this.current?.kind === 'photo') this.openCompare(this.current.img);
    else if (this.current?.kind === 'pano') this.enterPano(this.current);
  }
  async enterPano(v) {
    let tex = this.texCache.get(v.id);
    if (!tex) { tex = await this.loader.loadAsync(`assets/panos/${v.id}.jpg`); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 8; this.texCache.set(v.id, tex); }
    this.sphere.material.map = tex; this.sphere.material.needsUpdate = true; this.sphere.material.opacity = 0; this.sphere.visible = true;
    // Orientation: the texture's centre column should look toward plan heading `v.heading`. With scale.x=-1 the sphere's
    // u=0.5 faces +Z (world south, heading 180). Rotate so it faces the calibrated heading instead.
    this.sphere.rotation.y = THREE.MathUtils.degToRad(180 - v.heading) + (this.panoTrim || 0);
    this.panoActive = true; this.panoPos = { x: v.x, z: -v.y }; this.panoTarget = v;
    this.ui.toast(`${t('pano')} · ${t(v.title)} · ${t('comparehint')}`, 3500);
    this.player.lock();
  }
  exitPano() { if (!this.panoActive) return; this.panoActive = false; this.sphere.visible = false; this.sphere.material.opacity = 0; this.player.enabled = true; }
}
