// Hover + click interaction: sit on seats, grab & drag movable pieces, open/close doors. Raycast from the screen centre
// (pointer-locked) or from the pointer (touch / unlocked).
import { THREE } from './kit.js';
import { getDoors, setFrench, setHinged, setBifold, setSlider, getColliders, poseFrench, doorEase } from './house.js';
import { t, getLang } from './ui.js';
import { scenicView, viewDepth, SEAT_LOOK_RANGE } from './view.js';
import { otherSide, roomName } from './plan.js';
import { fastPicks } from './pick_bvh.js';

const WALL_BOX = new THREE.Box3(), WALL_HIT = new THREE.Vector3();


// Name of a door as seen from plan point (px, py): the space on its far side from plan.json's openings ("Door to the
// front bedroom"), or "Front door" when the front door leads outside.
export function doorName(d, px, py, lang) {
  const s = otherSide(d.id, px, py), r = s ? { en: s.label.en, zh: s.label.zh, outside: s.zone === 'exterior' } : roomName(d.plan.cx, d.plan.cy);
  if (d.kind === 'front' && r.outside) return lang === 'zh' ? '入户门' : 'Front door';
  return lang === 'zh' ? `通往${r.zh}的门` : `Door to the ${r.en.toLowerCase()}`;
}

// Timed ease from wherever the leaf is now to its goal; a new goal mid-swing restarts from the current pose.
function easeDoor(d, dt, get, set, goal, span) {
  if (d._goal !== goal) { d._goal = goal; d._from = get(); d._t = 0; d._dur = 0.35 + 0.75 * Math.min(1, Math.abs(goal - d._from) / span); }
  if (d._t >= 1) return;
  d._t = Math.min(1, d._t + dt / d._dur); set(d._from + (goal - d._from) * doorEase(d._t));
}
export const doorIsOpen = (d) => d.kind === 'french' || d.kind === 'bifold' ? d.target > 0.5 : d.kind === 'slider' ? d.open > 0.3 : Math.abs(d.target ?? 0) > 0.1;

// The guided tour and an open panorama both own the view: nothing in the house can be aimed at, clicked or dragged.
const viewOwned = () => document.body.classList.contains('touring') || document.body.classList.contains('in-pano');
export class Interact {
  constructor(scene, camera, player, layout, ui, human) {
    this.scene = scene; this.camera = camera; this.player = player; this.layout = layout; this.ui = ui; this.human = human;
    this.ray = new THREE.Raycaster(); this.ray.far = 4.0;
    this.hover = null; this.grab = null; this.pointer = new THREE.Vector2(0, 0);
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.highlightMats = [];
    this.pending = null; this.returning = [];
    this.togglePress = null;
    this.shadowLights = []; scene.traverse(o => { if (o.isLight && o.castShadow) this.shadowLights.push(o); });
    this.lightRoots = []; scene.traverse(o => { if (!o.isLight && o.userData.lightSwitch) this.lightRoots.push(o); });
    this.pickRoots = [...this.layout.interactive, ...this.lightRoots];
    this.heavy = fastPicks([...this.pickRoots, ...getDoors().map(d => d.group)]);
    const canvas = document.getElementById('gl');
    canvas.addEventListener('mousedown', (e) => {
      if (!player.locked) { this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); }
      if (e.button === 2) { this.contextMenu(e); return; }
      if (e.button !== 0) return;
      this.closeMenu(); this.press();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mouseup', (e) => { if (e.button === 0) this.release(); });
    canvas.addEventListener('mousemove', (e) => {
      if (!player.locked) this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      // a press on a chair stays a click (sit) until the pointer or view moves; then it becomes a drag
      if (this.pending) { this.pending.move += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); if (this.pending.move > 10) this.startGrab(this.pending.root); }
      if (this.togglePress) this.togglePress.move += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    });
    addEventListener('keydown', (e) => { if (e.code === 'Escape') { if (!this.menu.classList.contains('hidden') || this.togglePress) e.crotonMenu = true; this.closeMenu(); this.togglePress = null; } });
    addEventListener('mouseup', (e) => { if (e.button === 0 && this.togglePress) this.release(); });
    addEventListener('blur', () => { this.togglePress = null; });
    this.menu = document.createElement('div'); this.menu.id = 'ctxmenu'; this.menu.className = 'hidden'; document.getElementById('app')?.appendChild(this.menu) ?? document.body.appendChild(this.menu);
    addEventListener('touchact', () => { this.pointer.set(0, 0); this.press(); setTimeout(() => this.release(), 150); });
    addEventListener('keydown', (e) => { if (e.code === 'KeyE' || e.code === 'KeyF') { this.press(); setTimeout(() => this.release(), 100); } });
    player.extraColliders = () => this.layout.movableColliders(this.grab?.root);
    player.onStand = (seat) => { this.human.hide(); };
  }
  target() { return this.player.locked || matchMedia('(pointer:coarse)').matches ? new THREE.Vector2(0, 0) : this.pointer; }
  pick() {
    const m = this.markers?.pick(this.target()); if (m) return m;
    this.ray.setFromCamera(this.target(), this.camera);
    const wall = this.wallDist(this.ray.ray);
    let best = null;
    // nothing past the first wall (or past a nearer pick, for doors) can be chosen: the ray stops there, so three skips
    // every mesh whose bounds start beyond it (the per-frame aim cost ~1.5-5 ms on a 2.1 GHz Xeon, most of it far meshes)
    const far = this.ray.far;
    this.ray.far = Math.min(far, wall);
    for (const h of this.ray.intersectObjects(this.pickRoots, true)) {
      if (h.distance > wall) break;
      let o = h.object; while (o && !o.userData.interactiveRoot && !o.userData.lightSwitch) o = o.parent;
      if (o) { best = { root: o, point: h.point, dist: h.distance }; break; }
    }
    this.ray.far = Math.min(far, wall + 0.05, best?.dist ?? Infinity);
    const dh = this.ray.intersectObjects(getDoors().map(d => d.group), true)[0];
    this.ray.far = far;
    if (dh && dh.distance <= wall + 0.05 && (!best || dh.distance < best.dist)) { let o = dh.object; while (o && !o.userData.door) o = o.parent; if (o) return { door: o.userData.door, point: dh.point, dist: dh.distance }; }
    const pet = this.pets?.pick(this.ray.ray, Math.min(wall, best?.dist ?? Infinity, 2.2));
    if (pet) return pet;
    return best;
  }
  // Distance to the first wall, closet front or fixed glass panel along the ray: nothing behind them can be picked.
  // Walls under windows stop at the sill, so pieces seen through an open window stay reachable.
  wallDist(ray) {
    let best = Infinity;
    for (const c of getColliders()) {
      if (c.tag !== 'wall' && c.tag !== 'closet' && c.tag !== 'slider') continue;
      WALL_BOX.min.set(c.x0, 0, c.z0); WALL_BOX.max.set(c.x1, c.top, c.z1);
      if (ray.intersectBox(WALL_BOX, WALL_HIT)) best = Math.min(best, WALL_HIT.distanceTo(ray.origin));
    }
    return best;
  }
  doorLabel(d) { return doorName(d, this.camera.position.x, -this.camera.position.z, getLang()); }
  press() {
    if (viewOwned()) return;
    const h = this.pick();
    // sitting only gives up furniture grabs; a pet in front of the seat can still be petted
    if (this.player.seat) { if (h?.pet) this.pets.pet(h.pet); return; }
    if (!h) return;
    if (h.pin || h.card) { this.markers.activate(h); return; }
    if (h.door) { this.toggleDoor(h.door); return; }
    if (h.pet) { this.pets.pet(h.pet); return; }
    const u = h.root.userData;
    if (u.toggle || u.lightSwitch) { this.togglePress = { root: h.root, move: 0, time: performance.now(), cam: this.camera.position.clone() }; return; }
    if (u.movable && u.seats?.length) { this.pending = { root: h.root, point: h.point, move: 0, cam: this.camera.position.clone() }; return; }
    if (u.movable) { this.startGrab(h.root); return; }
    if (u.seats?.length) { this.sitOn(h.root, h.point); }
  }
  startGrab(root) {
    this.pending = null;
    root.userData.home ??= { pos: root.position.clone(), ry: root.rotation.y };
    this.returning = this.returning.filter(r => r.root !== root);
    this.grab = { root, start: root.position.clone(), t: 0, yaw0: root.rotation.y, prev: null, off: new THREE.Vector3() };
    this.ray.setFromCamera(this.target(), this.camera);
    const p0 = new THREE.Vector3(); if (this.ray.ray.intersectPlane(this.floor, p0)) { this.grab.off.set(root.position.x - p0.x, 0, root.position.z - p0.z); }
    this.ui.setLabel(t('grab') + ' · ' + this.name(root));
  }
  release() {
    if (this.togglePress) {
      const p = this.togglePress; this.togglePress = null;
      if (p.move <= 10 && performance.now() - p.time < 450 && this.camera.position.distanceTo(p.cam) < 0.15 && this.pick()?.root === p.root) {
        const toggle = p.root.userData.toggle || p.root.userData.lightSwitch; toggle.set(!toggle.on);
      }
      return;
    }
    if (this.pending) { const p = this.pending; this.pending = null; this.sitOn(p.root, p.point); return; }
    if (this.grab) { this.grab = null; }
  }
  // ---- putting moved pieces back
  moved(root) { const h = root?.userData.home; if (!h) return false; return h.pos.distanceTo(root.position) > 0.01 || Math.abs(Math.atan2(Math.sin(root.rotation.y - h.ry), Math.cos(root.rotation.y - h.ry))) > 0.01; }
  movedAll() { return this.layout.movables.filter(r => this.moved(r)); }
  putBack(roots) {
    for (const root of roots) {
      if (this.player.seat?.root === root || this.grab?.root === root) continue;
      const h = root.userData.home;
      this.returning = this.returning.filter(r => r.root !== root);
      this.returning.push({ root, from: root.position.clone(), fromRy: root.rotation.y, to: h.pos, toRy: root.rotation.y + Math.atan2(Math.sin(h.ry - root.rotation.y), Math.cos(h.ry - root.rotation.y)), t: 0 });
    }
  }
  contextMenu(e) {
    if (viewOwned()) return;
    this.togglePress = null;
    if (this.player.seat) return;
    const h = this.pick(), root = h?.root?.userData.movable ? h.root : null, all = this.movedAll();
    const items = [];
    if (root && this.moved(root)) items.push({ label: `${t('putBack')} · ${this.name(root)}`, run: () => this.putBack([root]) });
    items.push(all.length ? { label: `${t('putAll')} (${all.length})`, run: () => this.putBack(all) } : { label: t('nothingMoved'), disabled: true });
    items.push({ label: t('statsForNerds'), sep: true, run: () => dispatchEvent(new Event('crotonstats')) });
    const wasLocked = this.player.locked;
    const x = wasLocked ? innerWidth / 2 : e.clientX, y = wasLocked ? innerHeight / 2 : e.clientY;
    this.player.unlock?.();
    this.menu.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button'); b.textContent = it.label; b.disabled = !!it.disabled; if (it.sep) b.className = 'sep';
      b.addEventListener('click', (ev) => { ev.stopPropagation(); it.run?.(); this.closeMenu(); if (wasLocked) this.player.lock(); });
      this.menu.appendChild(b);
    }
    this.menu.style.left = Math.min(x, innerWidth - 260) + 'px'; this.menu.style.top = Math.min(y, innerHeight - 40 * items.length - 10) + 'px';
    this.menu.classList.remove('hidden');
    const away = (ev) => { if (!this.menu.contains(ev.target)) { this.closeMenu(); removeEventListener('mousedown', away, true); } };
    setTimeout(() => addEventListener('mousedown', away, true));
  }
  closeMenu() { this.menu?.classList.add('hidden'); }
  toggleDoor(d) {
    if (d.kind === 'french') setFrench(d, d.target > 0.5 ? 0 : 1);
    else if (d.kind === 'bifold') setBifold(d, d.target > 0.5 ? 0 : 1);
    else if (d.kind === 'slider') setSlider(d, !doorIsOpen(d));
    else if (d.pivot) setHinged(d, Math.abs(d.target) < 0.1);
    this.ui.toast((doorIsOpen(d) ? t('open') : t('close')) + ' · ' + this.doorLabel(d));
  }
  sitOn(root, point) {
    root.updateMatrixWorld(true);
    // candidates: the piece's seats (world facing = piece yaw + seat facing); a bed also offers a perch on every free mattress edge
    const cands = root.userData.seats.map(s => ({ kind: s.kind, world: new THREE.Vector3(s.x, s.y, s.z).applyMatrix4(root.matrixWorld), facing: root.rotation.y + s.facing }));
    const bed = cands.find(c => c.kind === 'bed'); if (bed) cands.push(...this.bedPerches(root, bed.world.y));
    // nearest to the click, except on a bed, where the perch with the best view wins (you never end up facing a wall)
    let best = null, bs = -Infinity;
    for (const c of cands) {
      const fwd = new THREE.Vector3(Math.sin(c.facing), 0, Math.cos(c.facing));
      const eye = c.world.clone().addScaledVector(fwd, 0.08); eye.y += 0.62;
      const range = c.kind === 'bed' ? Math.PI / 2 : SEAT_LOOK_RANGE[c.kind] ?? Math.PI / 3;
      const v = this.viewRoots ? scenicView(this.viewRoots, eye, c.facing, range, { exclude: root }) : { yaw: c.facing, score: 0 };
      c.look = v.yaw;
      const s = (bed ? v.score : 0) - c.world.distanceTo(point) * (bed ? 0.3 : 10);
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) return;
    const fwd = new THREE.Vector3(Math.sin(best.facing), 0, Math.cos(best.facing));
    const exitPos = best.world.clone().addScaledVector(fwd, 0.55); exitPos.y = 0;
    this.player.sit({ position: best.world, facing: best.facing, look: best.look, kind: best.kind, root, exitPos });
    this.human.sitAt(best.world, best.facing);
    this.ui.setLabel(''); this.ui.toast(t('stand'), 3000);
  }
  // A perch at the middle of each mattress edge, facing out. Walks in from the bounding box (headboards and benches can be
  // wider than the mattress) to the first mattress-height surface; skipped if it meets the headboard first or if the floor
  // where the feet go is blocked (wall, nightstand, bench).
  bedPerches(root, topY) {
    const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), out = [];
    const down = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), skip = new Set();
    root.traverse(o => { if (o.isMesh) skip.add(o); });
    for (const [ex, ez, f] of [[box.max.x, c.z, Math.PI / 2], [box.min.x, c.z, -Math.PI / 2], [c.x, box.max.z, 0], [c.x, box.min.z, Math.PI]]) {
      const n = new THREE.Vector3(Math.sin(f), 0, Math.cos(f));
      for (let t = 0.04; t < 0.9; t += 0.04) {
        const p = new THREE.Vector3(ex, 3, ez).addScaledVector(n, -t);
        down.set(p, DOWN); const hit = down.intersectObject(root, true)[0];
        if (!hit || hit.point.y < topY - 0.15) continue;
        if (hit.point.y > topY + 0.15) break;
        const seat = p.addScaledVector(n, -0.1); seat.y = Math.min(hit.point.y, topY + 0.05);
        const knee = seat.clone(); knee.y = 0.3;
        if (this.viewRoots && viewDepth(this.viewRoots, knee, n, { max: 0.8, skip }).d < 0.65) break;
        out.push({ kind: 'bed', world: seat, facing: f });
        break;
      }
    }
    return out;
  }
  name(root) { const u = root.userData; return (document.documentElement.lang === 'zh' ? u.zh : u.name) || u.name || u.id || ''; }
  update(dt) {
    if (this.layout.interactive.some(r => r.userData.toggle?.moving)) {
      for (const light of this.shadowLights) light.shadow.needsUpdate = true;
    }
    // ease doors toward their targets
    for (const d of getDoors()) {
      if (d.pivot) easeDoor(d, dt, () => d.pivot.rotation.y, (v) => { d.pivot.rotation.y = v; }, d.target, 1.45);
      if (d.kind === 'french') easeDoor(d, dt, () => d.open, (v) => poseFrench(d, v), d.target, 1);
      if (d.slide) { const x = d.w / 2 - d.open; d.slide.position.x += (x - d.slide.position.x) * Math.min(1, dt * 4); }
      d.tick?.(dt);
    }
    // put-back glides
    for (const r of this.returning) {
      r.t = Math.min(1, r.t + dt / 0.6); const e = r.t * r.t * (3 - 2 * r.t);
      r.root.position.lerpVectors(r.from, r.to, e); r.root.rotation.y = r.fromRy + (r.toRy - r.fromRy) * e; r.root.userData.onMove?.(r.root);
    }
    this.returning = this.returning.filter(r => r.t < 1);
    // The tour or a panorama owns the view. No crosshair, label, or emissive hover, and a moving camera must not turn a click into a drag.
    if (viewOwned()) {
      this.pending = null; this.togglePress = null; this.grab = null;
      if (this.hover) { this.setHighlight(this.hover, false); this.hover = null; }
      if (this.markers) this.markers.hover = null;
      this.ui.setLabel('');
      return;
    }
    if (this.pending && this.camera.position.distanceTo(this.pending.cam) > 0.15) this.startGrab(this.pending.root);
    // dragging: project the pointer ray onto the floor plane and ease the piece toward it
    if (this.grab) {
      this.ray.setFromCamera(this.target(), this.camera);
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.floor, p)) {
        const r = this.grab.root; const target = p.clone().add(this.grab.off); target.y = r.position.y;
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
    if (this.player.seat) { const h = this.pick(); this.ui.setLabel(h?.pet ? this.pets.label(h.pet) : ''); return; }
    const h = this.pick();
    const root = h?.root || null;
    if (root !== this.hover) { this.setHighlight(this.hover, false); this.hover = root; this.setHighlight(root, true); }
    if (this.markers) this.markers.hover = h?.pin || null;
    if (h?.pin || h?.card) this.ui.setLabel(this.markers.label(h));
    else if (h?.door) this.ui.setLabel(`${this.doorLabel(h.door)} · ${d2s(h.door)}`);
    else if (h?.pet) this.ui.setLabel(this.pets.label(h.pet));
    else if (root) {
      const u = root.userData;
      const toggle = u.toggle || u.lightSwitch;
      if (toggle) { const label = toggle.on ? toggle.labelOn : toggle.label; this.ui.setLabel(typeof label === 'string' ? label : label?.[getLang()] || label?.en || this.name(root)); return; }
      const what = u.seats?.length && u.movable ? t('sitOrDrag') : u.seats?.length ? t('sit') : u.movable ? t('grab') : '';
      this.ui.setLabel(`${what ? what + ' · ' : ''}${this.name(root)}${this.moved(root) ? ' · ' + t('rightBack') : ''}`);
    }
    else this.ui.setLabel('');
    function d2s(d) { return doorIsOpen(d) ? t('close') : t('open'); }
  }
  setHighlight(root, on) {
    if (!root || root.userData.lightSwitch) return;
    root.traverse(o => {
      if (!o.isMesh || !o.material?.emissive || o.userData.noHighlight) return;
      if (on) {
        if (!o.userData.hl) {
          const base = o.material, hl = base.clone();
          // clone() drops the shader hooks (daylight, HQ shadow, lighting chunk), which would give the highlight its own
          // program: a fresh compile on first hover, several seconds on Windows, and a look without the daylight tint.
          hl.onBeforeCompile = base.onBeforeCompile; hl.customProgramCacheKey = base.customProgramCacheKey; hl.onBeforeRender = base.onBeforeRender; if (base.ownShader) hl.ownShader = base.ownShader;
          hl.emissive.set(0xffffff); hl.emissiveIntensity = 0.06;
          o.userData.hl = base; o.material = hl;
        }
      } else if (o.userData.hl) { o.material.dispose(); o.material = o.userData.hl; o.userData.hl = null; }
    });
  }
}
