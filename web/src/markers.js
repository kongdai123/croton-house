// Photo, panorama and RedNote pins in the 3D world: a pulsing floor ring with a heading arrow, a thin stem and a floating thumbnail of the post.
// Clicking a pin flies to the spot it was shot from and floats the post's photo (or video) beside the view as a framed card.
import { THREE } from './kit.js';
import { getLang, t } from './ui.js';

const COLORS = { rn: '#ff2442', pano: '#2f6fe0', photo: '#2fa66a' }, STORE = { rn: 'croton-pins-rn', pano: 'croton-pins-pano', photo: 'croton-pins-photo' };
const HEAD_Y = 1.32, CARD_H = 0.66;
const loadImg = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function cover(ctx, im, x, y, w, h) { const s = Math.max(w / im.width, h / im.height), sw = w / s, sh = h / s; ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h); }

export class Markers {
  constructor(scene, camera, player, rednote, viewpoints, ui, occluders) {
    this.scene = scene; this.camera = camera; this.player = player; this.rednote = rednote; this.viewpoints = viewpoints; this.ui = ui; this.occluders = occluders;
    this.root = new THREE.Group(); this.root.name = 'view-pins'; scene.add(this.root);
    this.pins = []; this.card = null; this.hover = null; this.t = 0;
    this.visible = true; this.enabled = {}; this.layers = []; this.heads = []; this.fading = []; this.instance = new THREE.Object3D();
    this.ray = new THREE.Raycaster(); this.ray.far = 40; this.hits = []; this.blocks = [];
    const ringGeo = new THREE.RingGeometry(0.15, 0.19, 32).rotateX(-Math.PI / 2), pulseGeo = new THREE.RingGeometry(0.17, 0.19, 32).rotateX(-Math.PI / 2);
    const arrowGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.07, 0, -0.24), new THREE.Vector3(0.07, 0, -0.24), new THREE.Vector3(0, 0, -0.36)]);
    const stemGeo = new THREE.CylinderGeometry(0.004, 0.004, HEAD_Y - 0.16, 6).translate(0, (HEAD_Y - 0.16) / 2 + 0.02, 0);
    const sources = [];
    for (const p of rednote.posts) { const s = rednote.spotOf(p.slug); if (s) sources.push({ kind: 'rn', post: p, spot: s, target: { ...s, kind: 'rn', id: p.slug }, src: `assets/rednote/${p.media[0] || `${p.slug}_cover.jpg`}` }); }
    for (const v of viewpoints.targets) if (v.quality !== 'poor') sources.push(this.sourceOf(v));
    for (const kind of ['rn', 'pano', 'photo']) {
      const stored = localStorage.getItem(STORE[kind]) ?? (kind === 'rn' ? localStorage.getItem('croton-pins') : null);
      this.enabled[kind] = stored === '1';
      const root = new THREE.Group(); root.name = `${kind}-pins`; this.root.add(root);
      const pins = sources.filter(p => p.kind === kind), color = COLORS[kind];
      const solid = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
      const pulseMat = solid.clone(), stemMat = solid.clone(); stemMat.opacity = 0.55;
      const meshes = [new THREE.InstancedMesh(ringGeo, solid, pins.length), new THREE.InstancedMesh(pulseGeo, pulseMat, pins.length), new THREE.InstancedMesh(arrowGeo, solid, pins.length), new THREE.InstancedMesh(stemGeo, stemMat, pins.length)];
      for (const m of meshes) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
      const layer = { kind, root, pins, meshes, pulseMat }; this.layers.push(layer);
      for (let i = 0; i < pins.length; i++) {
        const pin = pins[i], s = pin.spot, g = new THREE.Group(); g.position.set(s.x, 0, -s.y); root.add(g);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, toneMapped: false, transparent: true, depthWrite: false }));
        head.scale.set(0.3, 0.3, 1); head.position.y = HEAD_Y; g.add(head);
        Object.assign(pin, { group: g, head, canvas, tex, phase: i * 0.73, color, layer, index: i }); head.userData.pin = pin;
        this.drawHead(pin, null); if (pin.src) loadImg(pin.src).then(im => this.drawHead(pin, im));
        this.pins.push(pin);
      }
    }
    addEventListener('langchange', () => { if (this.card?.ready) this.drawCard(this.card); });
    addEventListener('keydown', (e) => { if (e.code === 'Escape') this.closeCard(); });
  }
  sourceOf(v) { return { kind: v.kind, target: v, spot: v, post: { slug: v.id, title: v.title, media: [v.img || v.thumb] }, src: v.img || v.thumb, color: COLORS[v.kind] }; }
  openTargetCard(v) { return this.openCard(this.pins.find(p => p.kind === v.kind && p.target.id === v.id) || this.sourceOf(v)); }
  drawHead(pin, im) {
    const c = pin.canvas.getContext('2d'), S = 256;
    c.clearRect(0, 0, S, S);
    c.save(); roundRect(c, 10, 10, S - 20, S - 20, 46); c.fillStyle = pin.color; c.fill(); c.restore();
    c.save(); roundRect(c, 22, 22, S - 44, S - 44, 36); c.clip();
    if (im) cover(c, im, 22, 22, S - 44, S - 44); else { c.fillStyle = pin.color; c.fillRect(0, 0, S, S); c.fillStyle = '#fff'; c.font = 'bold 120px "PingFang SC", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(pin.kind === 'rn' ? '书' : pin.kind === 'pano' ? '360°' : '▧', S / 2, S / 2 + 6); }
    c.restore();
    if (pin.post.video) { c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.arc(S / 2, S / 2, 34, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(S / 2 - 11, S / 2 - 18); c.lineTo(S / 2 + 20, S / 2); c.lineTo(S / 2 - 11, S / 2 + 18); c.closePath(); c.fill(); }
    pin.tex.needsUpdate = true;
  }
  toggle(kind = 'rn', on = !this.enabled[kind]) {
    if (typeof kind === 'boolean') { on = kind; kind = 'rn'; }
    this.enabled[kind] = on; localStorage.setItem(STORE[kind], on ? '1' : '0');
    if (kind === 'rn') localStorage.setItem('croton-pins', on ? '1' : '0');
    this.ui.syncLegends();
    if (!on && this.card?.pin.kind === kind) this.closeCard();
    this.update(0);
  }
  // what the pointer ray hits first: a pin (not hidden behind a wall) or the floating card
  pick(ndc) {
    if (!this.root.visible) return null;
    this.ray.setFromCamera(ndc, this.camera); this.hits.length = 0; this.blocks.length = 0;
    if (this.card) { const h = this.ray.intersectObject(this.card.mesh, false, this.hits)[0]; if (h) return { card: this.card, dist: h.distance }; }
    const h = this.ray.intersectObjects(this.heads, false, this.hits)[0]; if (!h) return null;
    this.ray.far = h.distance - 0.05; const block = this.occluders && this.ray.intersectObject(this.occluders, true, this.blocks)[0]; this.ray.far = 40;
    return block ? null : { pin: h.object.userData.pin, dist: h.distance };
  }
  label(hit) {
    const zh = getLang() === 'zh';
    if (hit.card) return hit.card.pin.kind === 'rn' ? (zh ? `点击切换照片 · ${hit.card.i + 1} / ${hit.card.n}` : `Click for the next photo · ${hit.card.i + 1} / ${hit.card.n}`) : t(hit.card.pin.kind === 'pano' ? 'panoCard' : 'photoCard');
    const p = hit.pin, s = p.spot;
    return `${t(p.kind === 'rn' ? 'rednote' : p.kind)} · ${zh ? s.zh || t(p.post.title) : s.en || t(p.post.title)}`;
  }
  activate(hit) {
    if (hit.card) { if (hit.card.pin.kind === 'rn') this.nextImage(); else this.viewpoints.toggleCompare(); return; }
    const pin = hit.pin, s = pin.spot;
    this.closeCard();
    if (s.dusk && !window.__app.state.dusk) this.ui.toggleDusk();
    this.viewpoints.goTo(pin.target, { silent: true, onDone: () => this.openCard(pin) });
  }
  // ---- floating card: the post photo in a white frame with its caption, to the right of the view, facing the camera
  async openCard(pin) {
    this.closeCard();
    const p = pin.post;
    const canvas = document.createElement('canvas'), tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    // drawn over the scene (no depth test) so the card never slices into walls or furniture in tight rooms
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); mesh.renderOrder = 1000;
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, depthTest: false })); shade.renderOrder = 999;
    shade.position.set(0.012, -0.016, -0.004); mesh.add(shade);
    const group = new THREE.Group(); group.add(mesh);
    const cam = this.camera, fwd = new THREE.Vector3(), right = new THREE.Vector3();
    cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); right.set(-fwd.z, 0, fwd.x);
    group.position.copy(cam.position).addScaledVector(fwd, 1.5).addScaledVector(right, 0.66); group.position.y = cam.position.y - 0.04;
    group.lookAt(cam.position.x, group.position.y, cam.position.z);
    this.scene.add(group);
    const n = p.video ? 1 : Math.max(1, p.media.length);
    const card = { pin, group, mesh, shade, mat, tex, canvas, i: pin.kind === 'rn' ? Math.min(n - 1, pin.spot.img ?? 0) : 0, n, t: 0, out: false, home: { x: cam.position.x, z: cam.position.z }, imgs: [] };
    this.card = card;
    if (p.video) {
      const v = document.createElement('video'); v.src = `assets/rednote/${p.video}`; v.muted = true; v.loop = true; v.playsInline = true; v.crossOrigin = 'anonymous';
      card.video = v; v.play().catch(() => {});
      await new Promise(r => { v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 4000); });
    } else card.imgs = await Promise.all(p.media.map(m => loadImg(pin.kind === 'rn' ? `assets/rednote/${m}` : m)));
    if (this.card !== card) return;
    this.drawCard(card);
  }
  drawCard(card, zh = getLang() === 'zh') {
    const p = card.pin.post, s = card.pin.spot, src = card.video || card.imgs[card.i];
    const sw = card.video ? card.video.videoWidth || 720 : src?.width || 900, sh = card.video ? card.video.videoHeight || 960 : src?.height || 1200;
    const W = 900, pad = 34, iw = W - pad * 2, ih = Math.round(iw * Math.min(1.45, Math.max(0.6, sh / sw))), cap = 168, H = pad + ih + cap;
    const c = card.canvas; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; card.tex.dispose(); card.tex = new THREE.CanvasTexture(c); card.tex.colorSpace = THREE.SRGBColorSpace; card.tex.anisotropy = 8; card.mat.map = card.tex; card.mat.needsUpdate = true; }
    const x = c.getContext('2d');
    x.clearRect(0, 0, W, H); x.save(); roundRect(x, 0, 0, W, H, 26); x.fillStyle = '#fbfaf7'; x.fill(); x.clip();
    if (src) { x.save(); roundRect(x, pad, pad, iw, ih, 12); x.clip(); cover(x, src, pad, pad, iw, ih); x.restore(); }
    x.fillStyle = '#1d1b18'; x.font = '600 40px "PingFang SC", "Hiragino Sans GB", sans-serif'; x.textBaseline = 'top';
    x.fillText((card.pin.kind === 'rn' ? p.title : `${t(card.pin.kind)} · ${t(p.title)}`).slice(0, 36), pad, pad + ih + 26, iw);
    x.fillStyle = '#8a847a'; x.font = '28px "PingFang SC", "Hiragino Sans GB", sans-serif';
    x.fillText((zh ? s.zh : s.en) || (card.pin.kind === 'pano' ? 'Zillow 3D Home' : 'Zillow'), pad, pad + ih + 82, iw);
    x.fillStyle = card.pin.color; x.font = '600 26px "PingFang SC", sans-serif'; x.textAlign = 'right';
    x.fillText(card.pin.kind === 'rn' ? `${t('rednote')} · Studio Hu Dwelling${card.n > 1 ? `   ${card.i + 1}/${card.n}` : ''}` : `Zillow · ${t(card.pin.kind === 'pano' ? 'panoAction' : 'compareAction')}`, W - pad, pad + ih + 120, iw);
    x.textAlign = 'left'; x.restore();
    card.tex.needsUpdate = true;
    const h = CARD_H, w = h * W / H; card.mesh.scale.set(w, h, 1); card.shade.scale.set(1.01, 1.01, 1);
    card.ready = true;
  }
  nextImage() { const c = this.card; if (!c || c.n < 2) return; c.i = (c.i + 1) % c.n; this.drawCard(c); }
  closeCard() { const c = this.card; if (!c) return; c.out = true; this.card = null; this.fading.push(c); }
  disposeCard(c) { c.video?.pause(); this.scene.remove(c.group); c.mesh.geometry.dispose(); c.shade.geometry.dispose(); c.mat.dispose(); c.shade.material.dispose(); c.tex.dispose(); }
  update(dt) {
    this.t += dt;
    const touring = window.__app?.tourCtl?.active, pano = this.viewpoints.panoActive;
    this.root.visible = this.visible && !touring && !pano;
    if ((touring || pano) && this.card) this.closeCard();
    const cam = this.camera.position, o = this.instance;
    this.heads.length = 0;
    const u = (this.t * 0.6) % 1;
    for (const layer of this.layers) {
      layer.root.visible = this.enabled[layer.kind]; layer.pulseMat.opacity = 0.7 * (1 - u);
      for (const p of layer.pins) {
        const dx = p.spot.x - cam.x, dz = -p.spot.y - cam.z, d = Math.hypot(dx, dz);
        p.group.visible = layer.root.visible && d > 0.9 && d < 34 && !this.card;
        if (p.group.visible) this.heads.push(p.head);
        const k = p === this.hover ? 1.25 : 1, s = p.head.scale.x + (0.3 * k - p.head.scale.x) * Math.min(1, dt * 10);
        p.head.scale.set(s, s, 1); p.head.position.y = HEAD_Y + Math.sin(this.t * 1.6 + p.phase) * 0.025;
        p.head.material.opacity = Math.min(1, Math.max(0.25, (34 - d) / 14));
        o.position.set(p.spot.x, 0.02, -p.spot.y); o.rotation.set(0, 0, 0); o.scale.setScalar(p.group.visible ? 1 : 0); o.updateMatrix();
        layer.meshes[0].setMatrixAt(p.index, o.matrix); layer.meshes[3].setMatrixAt(p.index, o.matrix);
        o.scale.setScalar(p.group.visible ? 1 + u * 1.6 : 0); o.updateMatrix(); layer.meshes[1].setMatrixAt(p.index, o.matrix);
        o.scale.setScalar(p.group.visible ? 1 : 0); o.rotation.y = -p.spot.heading * Math.PI / 180; o.updateMatrix(); layer.meshes[2].setMatrixAt(p.index, o.matrix);
      }
      for (const m of layer.meshes) m.instanceMatrix.needsUpdate = true;
    }
    const c = this.card;
    if (c) {
      if (c.ready) { c.t = Math.min(1, c.t + dt / 0.45); const e = 1 - Math.pow(1 - c.t, 3); c.mat.opacity = e; c.shade.material.opacity = 0.22 * e; c.group.scale.setScalar(0.92 + 0.08 * e); }
      c.mesh.position.y = Math.sin(this.t * 1.2) * 0.012;
      if (c.video && c.ready && !c.video.paused && (this._vt = (this._vt || 0) + dt) > 1 / 30) { this._vt = 0; this.drawCard(c); }
      if (!this.viewpoints.fly && Math.hypot(cam.x - c.home.x, cam.z - c.home.z) > 1.4) this.closeCard();
    }
    for (let i = this.fading.length - 1; i >= 0; i--) { const f = this.fading[i]; f.t = Math.max(0, f.t - dt / 0.3); f.mat.opacity = f.t; f.shade.material.opacity = 0.22 * f.t; if (f.t <= 0) { this.disposeCard(f); this.fading.splice(i, 1); } }
  }
}
