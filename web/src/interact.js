// Hover + click interaction: sit on seats, grab & drag movable pieces, open/close doors. Raycast from the screen centre
// (pointer-locked) or from the pointer (touch / unlocked).
import { THREE } from './kit.js';
import { getDoors, setFrench, setHinged, getColliders } from './house.js';
import { t } from './ui.js';

export class Interact {
  constructor(scene, camera, player, layout, ui, human) {
    this.scene = scene; this.camera = camera; this.player = player; this.layout = layout; this.ui = ui; this.human = human;
    this.ray = new THREE.Raycaster(); this.ray.far = 4.0;
    this.hover = null; this.grab = null; this.pointer = new THREE.Vector2(0, 0);
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.highlightMats = [];
    const canvas = document.getElementById('gl');
    canvas.addEventListener('mousedown', (e) => { if (e.button !== 0) return; if (!player.locked) { this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); } this.press(); });
    canvas.addEventListener('mouseup', () => this.release());
    canvas.addEventListener('mousemove', (e) => { if (!player.locked) this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); });
    addEventListener('touchact', () => { this.pointer.set(0, 0); this.press(); setTimeout(() => this.release(), 150); });
    addEventListener('keydown', (e) => { if (e.code === 'KeyE' || e.code === 'KeyF') { this.press(); setTimeout(() => this.release(), 100); } });
    player.extraColliders = () => this.layout.movableColliders(this.grab?.root);
    player.onStand = (seat) => { this.human.hide(); };
  }
  target() { return this.player.locked || matchMedia('(pointer:coarse)').matches ? new THREE.Vector2(0, 0) : this.pointer; }
  pick() {
    this.ray.setFromCamera(this.target(), this.camera);
    const hits = this.ray.intersectObjects(this.layout.interactive, true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.interactiveRoot) o = o.parent; if (o) return { root: o, point: h.point, dist: h.distance }; }
    const doorHits = this.ray.intersectObjects(getDoors().map(d => d.group), true);
    if (doorHits.length) { let o = doorHits[0].object; while (o && !o.userData.door) o = o.parent; if (o) return { door: o.userData.door, point: doorHits[0].point, dist: doorHits[0].distance }; }
    return null;
  }
  press() {
    if (this.player.seat) return;
    const h = this.pick(); if (!h) return;
    if (h.door) { this.toggleDoor(h.door); return; }
    const u = h.root.userData;
    if (u.movable) { this.grab = { root: h.root, start: h.root.position.clone(), t: 0, yaw0: h.root.rotation.y, prev: null }; this.ui.setLabel(t('grab') + ' · ' + this.name(h.root)); return; }
    if (u.seats?.length) { this.sitOn(h.root, h.point); }
  }
  release() { if (this.grab) { this.grab = null; } }
  toggleDoor(d) {
    if (d.kind === 'french') setFrench(d, d.open > 0.5 ? 0 : 1);
    else if (d.kind === 'slider') { d.open = d.open > 0.3 ? 0.02 : 0.6; }
    else if (d.pivot) setHinged(d, Math.abs(d.target) < 0.1);
    this.ui.toast((d.open > 0.5 || Math.abs(d.target ?? 0) > 0.1 ? t('open') : t('close')) + ' · ' + t('door'));
  }
  sitOn(root, point) {
    // nearest seat to the click point
    root.updateMatrixWorld(true);
    let best = null, bd = 1e9;
    for (const s of root.userData.seats) { const wp = new THREE.Vector3(s.x, s.y, s.z).applyMatrix4(root.matrixWorld); const d = wp.distanceTo(point); if (d < bd) { bd = d; best = { ...s, world: wp }; } }
    if (!best) return;
    const facing = root.rotation.y + best.facing;            // world yaw of the seat (0 = +Z)
    const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const exitPos = best.world.clone().addScaledVector(fwd, 0.55); exitPos.y = 0;
    this.player.sit({ position: best.world, facing, kind: best.kind, root, exitPos });
    this.human.sitAt(best.world, facing);
    this.ui.setLabel(''); this.ui.toast(t('stand'), 3000);
  }
  name(root) { const u = root.userData; return (document.documentElement.lang === 'zh' ? u.zh : u.name) || u.name || u.id || ''; }
  update(dt) {
    // dragging: project the pointer ray onto the floor plane and ease the piece toward it
    if (this.grab) {
      this.ray.setFromCamera(this.target(), this.camera);
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.floor, p)) {
        const r = this.grab.root; const target = p.clone(); target.y = r.position.y;
        // keep it within reach and out of walls (circle vs AABB)
        const maxReach = 2.6; const cam = this.camera.position; const d = Math.hypot(target.x - cam.x, target.z - cam.z); if (d > maxReach) { target.x = cam.x + (target.x - cam.x) / d * maxReach; target.z = cam.z + (target.z - cam.z) / d * maxReach; }
        const rad = r.userData.movable.radius;
        for (const c of getColliders()) { const nx = Math.max(c.x0, Math.min(target.x, c.x1)), nz = Math.max(c.z0, Math.min(target.z, c.z1)); const dx = target.x - nx, dz = target.z - nz, dd = Math.hypot(dx, dz); if (dd < rad && dd > 1e-6) { target.x += dx / dd * (rad - dd); target.z += dz / dd * (rad - dd); } }
        const k = 1 - Math.exp(-dt * (90 / r.userData.movable.mass));
        const prev = r.position.clone();
        r.position.lerp(target, k);
        // chairs rotate a little toward their motion, like being dragged by one hand
        const v = r.position.clone().sub(prev); if (v.length() > 0.002) { const yawT = Math.atan2(v.x, v.z) + Math.PI; let dy = yawT - r.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.rotation.y += dy * Math.min(1, dt * 2.5) * 0.3; }
        r.userData.onMove?.(r);
      }
      return;
    }
    if (this.player.seat) { this.ui.setLabel(''); return; }
    const h = this.pick();
    const root = h?.root || null;
    if (root !== this.hover) { this.setHighlight(this.hover, false); this.hover = root; this.setHighlight(root, true); }
    if (h?.door) this.ui.setLabel(`${t('door')} · ${d2s(h.door)}`);
    else if (root) { const u = root.userData; const what = u.seats?.length ? t('sit') : u.movable ? t('grab') : ''; this.ui.setLabel(`${what ? what + ' · ' : ''}${this.name(root)}`); }
    else this.ui.setLabel('');
    function d2s(d) { return (d.kind === 'french' ? (d.open > 0.5 ? t('close') : t('open')) : d.kind === 'slider' ? (d.open > 0.3 ? t('close') : t('open')) : (Math.abs(d.target) > 0.1 ? t('close') : t('open'))); }
    // animate hinged doors toward their targets
    for (const d of getDoors()) {
      if (d.pivot) { d.pivot.rotation.y += (d.target - d.pivot.rotation.y) * Math.min(1, dt * 4); }
      if (d.slide) { const x = d.w / 2 - d.open; d.slide.position.x += (x - d.slide.position.x) * Math.min(1, dt * 4); }
    }
  }
  setHighlight(root, on) {
    if (!root) return;
    root.traverse(o => { if (!o.isMesh || !o.material?.emissive) return; if (on) { if (!o.userData.hl) { o.userData.hl = o.material; o.material = o.material.clone(); o.material.emissive.set(0xffffff); o.material.emissiveIntensity = 0.06; } } else if (o.userData.hl) { o.material.dispose(); o.material = o.userData.hl; o.userData.hl = null; } });
  }
}
