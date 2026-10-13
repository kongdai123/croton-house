// The demonstration: a scripted promenade that shows the controls by using them. It walks with W, turns the eye, calls
// and pets the dog and the cat, shows the pins, flies to a panorama, enters it and leaves. A Swiss strip at the bottom
// names each step and lights the key being "pressed". X starts or stops it; any real key, click or touch hands control back.
// Everything runs on the frame clock (update(dt)), so it is as smooth as the tour and deterministic under renderAt.
import { THREE } from './kit.js';
import { getLang } from './ui.js';

const CANCEL = Symbol('demo-cancel');
const ease = (u) => u * u * (3 - 2 * u);
const T = {
  intro: ['The promenade, step by step', '建筑漫步，一步一步'],
  walk: ['Walk the plan', '沿平面行走'],
  look: ['Turn the eye', '转动目光'],
  dog: ['Call the dog', '叫狗狗'],
  petDog: ['Pet the dog', '摸摸狗狗'],
  cat: ['Call the cat', '叫猫咪'],
  petCat: ['Pet the cat', '摸摸猫咪'],
  sit: ['Sit on the sofa', '坐到沙发上'],
  stand: ['Stand up', '起身'],
  drag: ['Move the furniture', '移动家具'],
  back: ['Return it to its place', '物归原处'],
  pins: ['Show the pins', '显示标记'],
  fly: ['Choose a panorama', '选择一处全景'],
  pano: ['Enter the panorama', '进入全景'],
  around: ['Look around inside', '在全景中环顾'],
  leave: ['Leave the panorama', '离开全景'],
  end: ['Now the house is yours', '现在，房子交给你'],
  label: ['Demonstration', '演示'],
};
const tr = (k) => T[k][getLang() === 'zh' ? 1 : 0];

export class Demo {
  constructor({ player, viewpoints, markers, pets, ui, tour, interact, layout }) {
    Object.assign(this, { player, viewpoints, markers, pets, ui, tour, interact, layout });
    this.active = false; this.tasks = [];
    const bar = this.bar = document.createElement('div'); bar.id = 'demobar'; bar.className = 'hidden'; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite');
    bar.innerHTML = '<span class="db-num"></span><span class="db-keys"></span><span class="db-text"></span><span class="db-label"></span>';
    document.getElementById('hud').appendChild(bar);
    // Any real input ends the demonstration (X itself toggles it in ui.js).
    const end = (e) => { if (this.active && e.isTrusted && !(e.type === 'keydown' && e.code === 'KeyX') && !e.target?.closest?.('#btn-demo')) this.stop(); };
    addEventListener('keydown', end, true); addEventListener('pointerdown', end, true);
  }
  toggle() { if (this.active) this.stop(); else this.start(); }
  async start() {
    if (this.active) return;
    if (this.tour.active) this.tour.stop();
    this.viewpoints.exitPano(); this.viewpoints.closeCompare(); this.ui.closePanel(); this.ui.toggleLegends(false); this.ui.toggleMedia?.(false);
    if (this.ui.helpOpen) this.ui.toggleHelp(false);
    if (this.ui.firstStepsOpen) this.ui.closeFirstSteps(false);
    this.player.unlock?.();
    this.active = true; this.tasks = []; this.pinsBefore = { ...this.markers.enabled };
    document.body.classList.add('demo'); document.getElementById('btn-demo')?.classList.add('on');
    this.bar.classList.remove('hidden');
    try { await this.script(); } catch (e) { if (e !== CANCEL) console.warn('demo', e); }
    this.finish();
  }
  stop() { if (!this.active) return; for (const t of this.tasks) t.reject(CANCEL); this.tasks = []; this.finish(); }
  finish() {
    if (!this.active) return;
    this.active = false;
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) this.player.keys.delete(code);
    if (this.player.seat) this.player.stand();
    if (this.dragged && this.interact.moved(this.dragged)) this.interact.putBack([this.dragged]);
    this.dragged = null;
    for (const a of this.pets?.agents ?? []) if (a.hold) a.hold = null;
    this.player.enabled = true; this.player.driven = false;
    for (const kind of ['rn', 'pano', 'photo']) if (this.markers.enabled[kind] !== this.pinsBefore[kind]) this.markers.toggle(kind, this.pinsBefore[kind]);
    document.body.classList.remove('demo'); document.getElementById('btn-demo')?.classList.remove('on');
    this.bar.classList.add('hidden');
  }

  // ---- frame clock ----
  update(dt) {
    if (!this.active) return;
    this.clock = (this.clock ?? 0) + dt;
    for (const t of [...this.tasks]) {
      t.t += dt; const u = Math.min(1, t.t / t.dur);
      t.fn?.(ease(u), u);
      if ((t.until && t.until()) || (t.dur && u >= 1)) { this.tasks.splice(this.tasks.indexOf(t), 1); t.resolve(); }
      else if (t.until && t.t >= t.dur) { this.tasks.splice(this.tasks.indexOf(t), 1); t.resolve(); }
    }
  }
  task(dur, fn, until) { return new Promise((resolve, reject) => this.tasks.push({ t: 0, dur, fn, until, resolve, reject })); }
  wait(sec) { return this.task(sec); }
  waitFor(pred, timeout) { return this.task(timeout, null, pred); }

  // ---- presentation ----
  show(n, total, keys, text) {
    this.bar.querySelector('.db-num').textContent = n ? `${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : '';
    const ks = this.bar.querySelector('.db-keys'); ks.replaceChildren();
    for (const k of keys) { const e = document.createElement('kbd'); e.textContent = k; if (k.length > 1) e.className = 'wide'; ks.appendChild(e); }
    this.bar.querySelector('.db-text').textContent = text;
    this.bar.querySelector('.db-label').textContent = tr('label');
  }
  press(i = 0) { const k = this.bar.querySelectorAll('.db-keys kbd')[i]; if (!k) return; k.classList.remove('hit'); void k.offsetWidth; k.classList.add('hit'); }

  // ---- motion helpers ----
  look() { const p = this.player, c = p.camera; c.rotation.set(0, 0, 0, 'YXZ'); c.rotation.y = p.yaw; c.rotation.x = p.pitch; }
  turn(deg, sec, pitchTo = null) {
    const p = this.player, y0 = p.yaw, y1 = y0 + THREE.MathUtils.degToRad(deg), p0 = p.pitch, p1 = pitchTo ?? p0;
    return this.task(sec, (e) => { p.yaw = y0 + (y1 - y0) * e; p.pitch = p0 + (p1 - p0) * e; if (this.viewpoints.panoActive) this.look(); });
  }
  face(x, z, sec, pitch = null) {
    const p = this.player, want = Math.atan2(-(x - p.pos.x), -(z - p.pos.z));
    const d = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
    return this.turn(THREE.MathUtils.radToDeg(d), sec, pitch);
  }
  // Yaw and pitch that put a world point dead centre from the eye.
  aimAt(x, y, z) {
    const c = this.player.camera.position, dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(y - c.y, Math.max(0.2, d)) };
  }
  // Turn to look straight at a world point.
  lookAt(x, y, z, sec) {
    const p = this.player, a = this.aimAt(x, y, z), d = Math.atan2(Math.sin(a.yaw - p.yaw), Math.cos(a.yaw - p.yaw));
    return this.turn(THREE.MathUtils.radToDeg(d), sec, a.pitch);
  }
  // Keep a moving thing centred for `sec` seconds (smoothed, so the camera follows rather than snaps).
  track(get, sec) {
    const p = this.player;
    return this.task(sec, () => {
      const t = get(); if (!t) return;
      const a = this.aimAt(t.x, t.y, t.z), k = 0.18, dy = Math.atan2(Math.sin(a.yaw - p.yaw), Math.cos(a.yaw - p.yaw));
      p.yaw += dy * k; p.pitch += (a.pitch - p.pitch) * k;
    });
  }
  // A composed camera move: glide to a plan position, heading and pitch (the same smooth flight the tour uses).
  async glide(px, py, heading, pitch, sec) {
    this.viewpoints.goTo({ kind: 'tour', id: 'demo', x: px, y: py, heading, pitch, eye: 1.6 }, { silent: true, direct: true, duration: sec });
    await this.wait(0.05); await this.waitFor(() => !this.viewpoints.fly, sec + 3);
  }
  async hold(code, sec) { this.player.keys.add(code); try { await this.wait(sec); } finally { this.player.keys.delete(code); } }
  near(name, r) { const a = this.pets?.get(name), p = this.player.pos; return !!a && Math.hypot(a.x - p.x, a.z - p.z) < r; }

  // ---- staging ----
  find(id) { let r = null; this.layout.root.traverse(o => { if (!r && o.userData?.id === id) r = o; }); return r; }
  // The piece with this id nearest a plan point (several Wishbone chairs share one id).
  findNear(id, px, py) {
    let r = null, best = Infinity; const w = new THREE.Vector3();
    this.layout.root.traverse(o => { if (o.userData?.id !== id) return; o.getWorldPosition(w); const d = Math.hypot(w.x - px, w.z + py); if (d < best) { best = d; r = o; } });
    return r;
  }
  // Place a pet at a plan position, settled in a pose, facing a world point; released later with free().
  stage(name, px, py, mode, lookX, lookZ) {
    const a = this.pets?.get(name); if (!a) return;
    const x = px, z = -py, yaw = Math.atan2(lookX - x, lookZ - z);
    a.perch = null; a.path = null; a.call = null; a.goal = null; a.x = x; a.z = z; a.yaw = yaw; a.state = 'pause'; a.st = 0;
    this.pets.hold(name, { x, z, yaw, mode, speed: 0 });
  }
  free(name) { const a = this.pets?.get(name); if (a) { a.hold = null; a.state = 'pause'; a.st = 0; } }
  // Drag a piece across the floor the way a visitor would, over `sec` seconds, ending at plan (px, py).
  drag(root, px, py, sec) {
    root.userData.home ??= { pos: root.position.clone(), ry: root.rotation.y };
    const from = root.position.clone(), to = new THREE.Vector3(px, from.y, -py), ry0 = root.rotation.y;
    this.dragged = root;
    return this.task(sec, (e) => { root.position.lerpVectors(from, to, e); root.rotation.y = ry0 + 0.2 * Math.sin(e * Math.PI); root.userData.onMove?.(root); });
  }

  // ---- the promenade: a choreographed scene in the living room ----
  // Every segment ends on a composed view: the room across to the window seat, the pets brought into frame with the
  // camera tilted to them, the pouf shot from where it can be seen, and back to the opening view at the end.
  async script() {
    const p = this.player, pets = this.pets;
    const sofa = this.find('living-sofa'), chair = this.findNear('wishbone-chair', 2.58, 2.78);
    const panoTarget = this.viewpoints.targets.find(v => v.kind === 'pano' && v.id === '954f8388b8') ?? this.viewpoints.targets.find(v => v.kind === 'pano');
    const hasDog = !!pets?.get('dog'), hasCat = !!pets?.get('cat');
    const steps = 2 + (sofa ? 2 : 0) + (hasDog ? 2 : 0) + (hasCat ? 2 : 0) + (chair ? 2 : 0) + 1 + (panoTarget ? 4 : 0);
    let n = 0;
    const OPEN = [2.65, 0.55, 180, -0.16];

    // Opening: behind the sofa, across the room to the window seat. Dog lying on the rug left of the coffee table,
    // cat sitting on the right, both facing the visitor and clear of the sofa back.
    p.teleport(OPEN[0], -OPEN[1], OPEN[2], OPEN[3]);
    if (hasDog) this.stage('dog', 1.25, -3.25, 'lie', OPEN[0], -OPEN[1]);
    if (hasCat) this.stage('cat', 3.45, -3.55, 'sit', OPEN[0], -OPEN[1]);
    this.show(0, steps, [], tr('intro')); await this.wait(2.6);

    this.show(++n, steps, ['W', 'A', 'S', 'D'], tr('walk')); this.press(0); await this.hold('KeyW', 0.85); await this.wait(0.5);
    this.show(++n, steps, ['Mouse'], tr('look')); this.press(0); await this.turn(-35, 1.7); await this.wait(0.2); await this.turn(35, 1.7); await this.wait(0.3);

    if (sofa) {
      const seatPoint = new THREE.Vector3(); sofa.getWorldPosition(seatPoint);
      await this.lookAt(seatPoint.x, 0.45, seatPoint.z, 1.1);
      this.show(++n, steps, ['Click'], tr('sit')); this.press(0);
      this.interact.sitOn(sofa, seatPoint); await this.wait(3.2);
      this.show(++n, steps, ['Space'], tr('stand')); this.press(0); p.stand(); await this.wait(1.3);
    }

    // The pets: stand clear of the sofa, tilt down toward the rug, call; they walk up into frame; pet them face to face.
    if (hasDog || hasCat) await this.glide(2.65, -1.75, 200, -0.42, 1.6);
    for (const [name, key, call, pet, on] of [['dog', 'G', 'dog', 'petDog', hasDog], ['cat', 'K', 'cat', 'petCat', hasCat]]) {
      if (!on) continue;
      const a0 = pets.get(name); await this.face(a0.x, a0.z, 0.9, -0.42);
      this.show(++n, steps, [key], tr(call)); this.press(0); this.free(name); pets.call(name);
      const t0 = this.clock ?? 0; const callAt = this.clock; await this.waitFor(() => this.near(name, 1.3) || (this.clock - callAt > 1.0 && !pets.get(name).path && pets.get(name).state !== 'walk'), 6); this.callTimes = { ...(this.callTimes || {}), [name]: +((this.clock ?? 0) - t0).toFixed(2) };
      const a = pets.get(name), head = name === 'dog' ? 0.36 : 0.26;
      await this.lookAt(a.x, head, a.z, 0.7);
      this.show(++n, steps, ['Click'], tr(pet)); this.press(0); pets.pet(name);
      await this.track(() => ({ x: a.x, y: head, z: a.z }), 2.8);
    }

    if (chair) {
      // A Wishbone chair at the dining table, filmed from beside the table: pulled out into the room, then sent home.
      await this.glide(2.05, 0.75, 15, -0.36, 1.8);
      this.show(++n, steps, ['Drag'], tr('drag')); this.press(0); await this.drag(chair, 3.0, 2.3, 2.0);   // clear of the east wall (x 3.35) and the stub at y 1.71–1.82 await this.wait(0.6);
      this.show(++n, steps, ['Right-click'], tr('back')); this.press(0); this.interact.putBack([chair]); await this.wait(1.9); this.dragged = null;
    }

    // Pins over the whole room, from the opening view.
    await this.glide(OPEN[0], OPEN[1], OPEN[2], -0.1, 1.8);
    this.show(++n, steps, ['H'], tr('pins')); this.press(0);
    for (const kind of ['rn', 'pano', 'photo']) this.markers.toggle(kind, true);
    await this.turn(-30, 2.2); await this.turn(30, 2.2); await this.wait(0.3);

    if (panoTarget) {
      this.show(++n, steps, ['P'], tr('fly')); this.press(0);
      this.viewpoints.goTo(panoTarget);
      await this.wait(0.2); await this.waitFor(() => !this.viewpoints.fly, 12); await this.wait(0.5);
      this.show(++n, steps, ['C'], tr('pano')); this.press(0);
      await this.viewpoints.enterPano(panoTarget);
      await this.waitFor(() => this.viewpoints.panoOpaque, 6);
      this.show(++n, steps, ['Mouse'], tr('around')); this.press(0);
      await this.turn(100, 4.2, 0.04); await this.turn(-100, 4.2, 0);
      this.show(++n, steps, ['Q'], tr('leave')); this.press(0); await this.wait(0.4);
      this.viewpoints.exitPano(); await this.wait(0.6);
    }
    // Close on the opening view.
    await this.glide(OPEN[0], OPEN[1], OPEN[2], -0.1, 2.4);
    this.show(0, steps, [], tr('end')); await this.wait(2.8);
  }
}
