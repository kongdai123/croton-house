// First-person player: pointer-lock mouse look, WASD, capsule-vs-AABB sliding collision, sitting with eased camera.
import { THREE } from './kit.js';
import { getColliders } from './house.js';

const EYE_STAND = 1.62, RADIUS = 0.17, SPEED = 2.4, RUN = 4.2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (x) => x * x * (3 - 2 * x);

export class Player {
  constructor(camera, dom, state) {
    this.camera = camera; this.dom = dom; this.state = state;
    this.pos = new THREE.Vector3(0, 0, 3.0);     // feet position (world)
    this.yaw = 0; this.pitch = 0;                 // yaw 0 looks toward -Z (north)
    this.vel = new THREE.Vector3();
    this.keys = new Set(); this.locked = false;
    this.seat = null; this.sitT = 0; this.sitFrom = null;  // sitting state
    this.bob = 0; this.eye = EYE_STAND; this.eyeHeight = EYE_STAND;
    this.enabled = true; this.touch = null; this.lookVel = { x: 0, y: 0 };
    this.extraColliders = () => [];
    this.onStand = null;
    dom.addEventListener('mousemove', (e) => { if (!this.locked || !this.enabled) return; this.yaw -= e.movementX * 0.0022; this.pitch = clamp(this.pitch - e.movementY * 0.0022, -1.45, 1.45); });
    addEventListener('keydown', (e) => { if (e.target?.tagName === 'INPUT') return; this.keys.add(e.code); if (this.seat && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) this.stand(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; this.state.onLock?.(this.locked); });
  }
  lock() { if (!this.locked) this.dom.requestPointerLock?.({ unadjustedMovement: true })?.catch?.(() => this.dom.requestPointerLock()); }
  unlock() { if (this.locked) document.exitPointerLock(); }
  teleport(x, z, yawDeg = null, pitch = 0) { this.pos.set(x, 0, z); if (yawDeg !== null) this.yaw = THREE.MathUtils.degToRad(-yawDeg); this.pitch = pitch; this.vel.set(0, 0, 0); if (this.seat) { this.seat = null; this.eye = EYE_STAND; } }
  get heading() { return (-THREE.MathUtils.radToDeg(this.yaw) % 360 + 360) % 360; }   // plan heading, 0 = north, clockwise
  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  eyePos() { return this.camera.position.clone(); }

  sit(seat) {   // seat: {position: Vector3 (seat top, world), facing: yaw radians (world), kind, root}
    if (this.seat) return;
    this.seat = seat; this.sitT = 0; this.sitFrom = { pos: this.pos.clone(), eye: this.eye, yaw: this.yaw, pitch: this.pitch };
    this.vel.set(0, 0, 0);
  }
  stand() { if (!this.seat) return; const s = this.seat; this.seat = null; this.sitT = 0; this.standFrom = { pos: this.pos.clone(), eye: this.eye }; this.pos.copy(s.exitPos ?? this.pos); this.eye = this.eyeHeight; this.onStand?.(s); }

  update(dt) {
    dt = Math.min(dt, 0.1);
    if (this.seat) { this.updateSit(dt); return; }
    // movement input
    const f = this.forward(), r = new THREE.Vector3(f.z, 0, -f.x);
    let ix = 0, iz = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz += 1; if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1; if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
      if (this.touch) { ix += this.touch.x; iz += this.touch.y; }
      this.yaw -= this.lookVel.x * dt; this.pitch = clamp(this.pitch - this.lookVel.y * dt, -1.45, 1.45);
    }
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const want = new THREE.Vector3().addScaledVector(f, iz).addScaledVector(r, ix);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(run ? RUN : SPEED);
    // accelerate / decelerate (ease-out feel per motion-lab: enter fast, settle)
    const k = want.lengthSq() > 0 ? 10 : 14;
    this.vel.lerp(want, 1 - Math.exp(-k * dt));
    const step = this.vel.clone().multiplyScalar(dt);
    this.move(step);
    // head bob
    const speed = this.vel.length();
    this.bob += dt * speed * 3.4;
    const bobY = Math.sin(this.bob) * 0.012 * Math.min(1, speed / SPEED);
    const eyeTarget = this.eyeHeight + bobY;
    this.eye += (eyeTarget - this.eye) * Math.min(1, dt * 12);
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
    this.camera.rotation.set(0, 0, 0, 'YXZ'); this.camera.rotation.y = this.yaw; this.camera.rotation.x = this.pitch;
  }
  updateSit(dt) {
    const s = this.seat; this.sitT = Math.min(1, this.sitT + dt / 0.9);
    const t = smooth(this.sitT);
    // target: eye 0.62 above the seat top, slightly forward of the seat point, facing the seat direction
    const facing = s.facing; const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const target = s.position.clone().addScaledVector(fwd, 0.08); target.y += 0.62;
    const from = this.sitFrom.pos.clone(); from.y += this.sitFrom.eye;
    const cam = from.lerp(target, t);
    // arc: dip slightly then rise so it feels like lowering into the seat
    cam.y -= Math.sin(t * Math.PI) * 0.05;
    this.camera.position.copy(cam);
    const yawTarget = Math.atan2(fwd.x, fwd.z); // yaw such that forward() = fwd: forward = (-sin yaw, -cos yaw) -> yaw = atan2(-fwd.x, -fwd.z)
    const yawT = Math.atan2(-fwd.x, -fwd.z);
    let dy = yawT - this.sitFrom.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const lookFree = this.sitT >= 1;
    if (!lookFree) { this.yaw = this.sitFrom.yaw + dy * t; this.pitch = this.sitFrom.pitch * (1 - t) + (-0.05) * t; }
    this.pos.set(s.position.x, 0, s.position.z); this.eye = target.y;
    this.camera.rotation.set(0, 0, 0, 'YXZ'); this.camera.rotation.y = this.yaw; this.camera.rotation.x = this.pitch;
  }
  // capsule (circle on the floor) vs AABB list, with sliding
  move(step) {
    const cols = getColliders().concat(this.extraColliders());
    const p = this.pos;
    for (const axis of ['x', 'z']) {
      p[axis] += step[axis];
      for (const c of cols) {
        if (c.circle) { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + RADIUS; if (d < min && d > 1e-6) { p.x += dx / d * (min - d); p.z += dz / d * (min - d); } continue; }
        const nx = clamp(p.x, c.x0, c.x1), nz = clamp(p.z, c.z0, c.z1);
        const dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
        if (d2 < RADIUS * RADIUS) {
          if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x += dx / d * (RADIUS - d); p.z += dz / d * (RADIUS - d); }
          else { // inside: push out along the axis we moved on
            if (axis === 'x') p.x = step.x > 0 ? c.x0 - RADIUS : c.x1 + RADIUS; else p.z = step.z > 0 ? c.z0 - RADIUS : c.z1 + RADIUS;
          }
        }
      }
    }
    // stay on the lot
    p.x = clamp(p.x, -40, 40); p.z = clamp(p.z, -40, 40);
  }
}
