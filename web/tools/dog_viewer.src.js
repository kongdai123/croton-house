// Standalone dog viewer / test harness. Bundle: node tools/dog_build.mjs → tools/dog_viewer.bundle.js; open
// http://127.0.0.1:8780/tools/dog_viewer.html (drag to orbit, keys 1-5 = idle/walk/sit/lie/jump). Automation hooks on window:
// show(opts) poses a fresh dog and renders it, slide(speed) measures foot sliding, cpu() times update(), exportGLB() bakes clips.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPet } from '../src/pets/dog.js';

const Q = new URLSearchParams(location.search);
const W = +(Q.get('w') ?? innerWidth), H = +(Q.get('h') ?? innerHeight);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(+(Q.get('dpr') ?? 1)); renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = +(Q.get('exp') ?? 1);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x7d7f7c);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.75;
scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x55524c, 0.7));
const sun = new THREE.DirectionalLight(0xfff3e4, 1.3); sun.position.set(-1.2, 3, 1.6); scene.add(sun);

// overcast gravel, like the reference photo
function gravel() {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
  g.fillStyle = '#2c2f31'; g.fillRect(0, 0, 1024, 1024);
  let s = 9; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const x = r() * 1024, y = r() * 1024, rx = 5 + r() * 9, ry = rx * (0.55 + r() * 0.4), l = 55 + r() * 70, a = r() * Math.PI;
    for (const [dx, dy] of [[0, 0], [1024, 0], [-1024, 0], [0, 1024], [0, -1024]]) {
      g.fillStyle = `rgb(${l * 0.95},${l},${l * 1.06})`; g.beginPath(); g.ellipse(x + dx, y + dy, rx, ry, a, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.ellipse(x + dx - rx * 0.2, y + dy - ry * 0.25, rx * 0.5, ry * 0.4, a, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: gravel(), roughness: 0.95 }));
ground.receiveShadow = true; scene.add(ground);

const camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 30);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0.15, 0); camera.position.set(0.55, 0.35, 0.65); controls.update();
let pet = createPet(); scene.add(pet.root);
const hud = document.getElementById('hud');

const VIEWS = {
  front: { az: 0, el: 8, d: 0.85, ty: 0.15 }, q34: { az: 40, el: 18, d: 0.85, ty: 0.15 }, side: { az: 90, el: 5, d: 0.9, ty: 0.15 },
  back: { az: 180, el: 15, d: 0.9, ty: 0.15 }, top: { az: 20, el: 70, d: 0.9, ty: 0.1 }, head: { az: 15, el: 12, d: 0.45, ty: 0.24, tz: 0.15 },
  ref: { az: 36, el: 34, d: 0.4, ty: 0.18, tz: 0.06, tx: 0.03, fov: 46 },
  player: { az: 0, el: 58, d: 1.45, ty: 0.18, fov: 24 },   // a person standing ~0.8 m in front, looking down at the dog
  pet: { az: 30, el: 32, d: 0.95, ty: 0.14 }, belly: { az: 25, el: 40, d: 0.75, ty: 0.08 },
};
function setView(v) {
  const o = typeof v === 'string' ? VIEWS[v] : v, az = THREE.MathUtils.degToRad(o.az), el = THREE.MathUtils.degToRad(o.el);
  const t = new THREE.Vector3(o.tx ?? 0, o.ty ?? 0.15, o.tz ?? 0);
  camera.fov = o.fov ?? 35; camera.aspect = W / H; camera.updateProjectionMatrix();
  camera.position.set(t.x + o.d * Math.sin(az) * Math.cos(el), t.y + o.d * Math.sin(el), t.z + o.d * Math.cos(az) * Math.cos(el));
  controls.target.copy(t); camera.lookAt(t); controls.update();
}

// Drive the pet the way roam.js does: root position / yaw are ours, the rig is the pet's.
function simulate(p, seq, { dt = 1 / 60, onFrame } = {}) {
  let t = 0;
  for (const st of seq) {
    const n = Math.round(st.dur / dt);
    for (let i = 0; i < n; i++) {
      const s = { mode: st.mode, speed: st.speed ?? 0, turn: st.turn ?? 0, t: i * dt, jumpT: 0, look: st.look === 'cam' ? camera.position : null, attend: !!st.attend, excite: st.excite ?? 0 };
      if (st.mode === 'pet') Object.assign(s, { petT: i * dt, petLeft: Math.max(0, (st.petDur ?? 5) - i * dt), petN: st.petN ?? 0 });
      if (st.mode === 'walk') { p.root.rotation.y += s.turn * dt; p.root.position.x += Math.sin(p.root.rotation.y) * s.speed * dt; p.root.position.z += Math.cos(p.root.rotation.y) * s.speed * dt; }
      if (st.mode === 'jump') {
        const jt = Math.min(1, (i + 1) * dt / p.jumpDuration), u = (jt - p.jumpTakeoff) / (p.jumpLand - p.jumpTakeoff), air = u > 0 && u < 1;
        s.jumpT = jt; p.root.position.y = air ? 4 * p.jumpHeight * u * (1 - u) : 0; s.lift = p.root.position.y; if (air) p.root.position.z += 0.4 * dt;
      } else p.root.position.y = 0;
      p.update(dt, s); t += dt; onFrame?.(s, t);
    }
  }
}
function fresh() { pet.dispose(); pet = createPet(); scene.add(pet.root); return pet; }
function render() { renderer.render(scene, camera); }

window.show = (o = {}) => {
  const p = fresh();
  setView(o.view ?? 'q34'); camera.updateMatrixWorld();   // the camera is the look target for { look: 'cam' } steps
  simulate(p, o.seq ?? [{ mode: 'idle', dur: 0.6 }]);
  // re-centre the finished pose on the origin so every camera preset frames the dog
  if (o.center !== false) { p.root.position.x = 0; p.root.position.z = 0; }
  p.root.rotation.y = o.yaw ?? 0;
  if (o.headYaw || o.headPitch) { const h = p.bones.head, n = p.bones.neck; h.rotation.y += (o.headYaw ?? 0) * 0.6; n.rotation.y += (o.headYaw ?? 0) * 0.4; h.rotation.x += o.headPitch ?? 0; }
  ground.visible = o.ground !== false; scene.background.set(o.bg ?? 0x7d7f7c);
  const v = { ...(typeof o.view === 'object' ? o.view : VIEWS[o.view ?? 'q34']) }; v.ty = (v.ty ?? 0.15) + p.root.position.y;
  setView(v);
  renderer.info.reset(); render();
  return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, counts: p.counts };
};

window.slide = (speed, dur = 3) => {
  const p = fresh(), paws = ['f4_L', 'f4_R', 'h4_L', 'h4_R'].map((n) => p.bones[n]), prev = paws.map(() => null), stats = paws.map(() => ({ n: 0, sum: 0, max: 0, sx: 0, sz: 0 }));
  simulate(p, [{ mode: 'idle', dur: 0.3 }, { mode: 'walk', dur: 1.2, speed }]);
  const v = new THREE.Vector3(), dt = 1 / 120;
  simulate(p, [{ mode: 'walk', dur, speed }], {
    dt, onFrame: () => {
      p.root.updateMatrixWorld(true);
      paws.forEach((b, i) => {
        b.getWorldPosition(v);
        if (prev[i] && v.y < 0.0133 && prev[i].y < 0.0133) { const sp = Math.hypot(v.x - prev[i].x, v.z - prev[i].z) / dt; const s = stats[i]; s.n++; s.sum += sp; s.max = Math.max(s.max, sp); s.sx += Math.abs(v.x - prev[i].x) / dt; s.sz += Math.abs(v.z - prev[i].z) / dt; }
        prev[i] = v.clone();
      });
    },
  });
  return { speed, paws: stats.map((s, i) => ({ paw: paws[i].name, stanceFrames: s.n, meanSlide: +(s.sum / Math.max(1, s.n)).toFixed(4), maxSlide: +s.max.toFixed(4), meanX: +(s.sx / Math.max(1, s.n)).toFixed(4), meanZ: +(s.sz / Math.max(1, s.n)).toFixed(4) })) };
};

window.cpu = (n = 3000) => {
  const p = fresh(), res = {};
  const head = new THREE.Vector3(0, 1.5, 0.8);
  for (const mode of ['idle', 'walk', 'sit', 'lie', 'jump', 'pet']) {
    const s = { mode, speed: mode === 'walk' ? 0.35 : 0, turn: 0.3, t: 0, jumpT: 0.5, look: mode === 'sit' || mode === 'pet' ? head : null, petT: 0, petLeft: 5, petN: 2 };
    for (let i = 0; i < 200; i++) p.update(1 / 60, s);
    let t0 = performance.now();
    for (let i = 0; i < n; i++) { s.jumpT = (i % 30) / 30; s.petT = 1 + (i % 180) / 60; p.update(1 / 60, s); }
    const upd = (performance.now() - t0) / n;
    t0 = performance.now();
    for (let i = 0; i < n; i++) { p.update(1 / 60, s); p.root.updateMatrixWorld(true); p.skeleton.update(); }
    res[mode] = { updateMs: +upd.toFixed(4), withMatricesMs: +((performance.now() - t0) / n).toFixed(4) };
  }
  return res;
};

window.trace = (speed, bone = 'f3_R', frames = 40) => {
  const p = fresh(), dt = 1 / 60, out = [];
  simulate(p, [{ mode: 'idle', dur: 0.3 }, { mode: 'walk', dur: 1.2, speed }]);
  for (let i = 0; i < frames; i++) { p.root.position.z += speed * dt; p.update(dt, { mode: 'walk', speed, turn: 0, t: i * dt }); const r = p.bones[bone].rotation; out.push([+r.x.toFixed(3), +p.bones[bone.replace('3', '2')].rotation.x.toFixed(3)]); }
  return out;
};

// Continuity: largest per-frame joint rotation (rad) and hips offset (m) change at 60 fps through call → sit and look up →
// three pettings (joy hops, play bow, belly rub) → idle. A pop shows up as a spike well above the motion's own speed.
window.pops = () => {
  const p = fresh(), head = new THREE.Vector3(0, 1.5, 1.2), dt = 1 / 60, prev = new Float32Array(p.skeleton.bones.length * 3), ph = new THREE.Vector3();
  const steps = [['walk', 2, { speed: 0.9, excite: 1 }], ['sit', 2.5, { look: head, attend: true, excite: 0.8 }]];
  for (let n = 0; n < 3; n++) steps.push(['pet', 5, { look: head, petN: n, excite: 1 }], ['sit', 1.5, { look: head, excite: 0.7 }]);
  steps.push(['idle', 1.5, {}]);
  const res = []; let first = true;
  for (const [mode, dur, extra] of steps) {
    let maxRot = 0, maxPos = 0, at = 0, bone = '';
    for (let i = 0; i < Math.round(dur / dt); i++) {
      const s = { mode, speed: 0, turn: 0, t: i * dt, ...extra };
      if (mode === 'pet') Object.assign(s, { petT: i * dt, petLeft: dur - i * dt });
      if (mode === 'walk') p.root.position.z += 0.9 * dt;
      p.update(dt, s);
      p.skeleton.bones.forEach((bn, j) => {
        for (let k = 0; k < 3; k++) { const v = bn.rotation['xyz'[k]], d = Math.abs(v - prev[j * 3 + k]); if (!first && d > maxRot) { maxRot = d; at = i * dt; bone = bn.name; } prev[j * 3 + k] = v; }
      });
      const hp = p.bones.hips.position; if (!first) maxPos = Math.max(maxPos, hp.distanceTo(ph)); ph.copy(hp); first = false;
    }
    res.push({ mode, petN: extra.petN, maxRot: +maxRot.toFixed(3), at: +at.toFixed(2), bone, maxHipsMove: +maxPos.toFixed(4) });
  }
  return res;
};

// Bake procedural motion into clips and export skin + coat hull + armature as GLB (base64), then re-import to verify.
window.exportGLB = async () => {
  const p = fresh(), g = p.mesh.geometry, c = p.counts, nv = c.bodyVerts + c.solidVerts;
  const take = (name, n, k) => g.attributes[name].array.slice(0, n * k);
  const pos = take('position', nv, 3), nrm = take('normal', nv, 3), fur = take('aFur', nv, 4), dir = take('aDir', nv, 3);
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.BufferAttribute(pos, 3)); body.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  body.setAttribute('color', new THREE.BufferAttribute(take('color', nv, 3), 3));
  body.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(take('skinIndex', nv, 4), 4)); body.setAttribute('skinWeight', new THREE.BufferAttribute(take('skinWeight', nv, 4), 4));
  body.setIndex(Array.from(g.index.array.slice(0, c.bodyIndex + c.solidIndex)));
  // coat hull: the fur volume at ~60 % length, combed and drooped in the rest pose (a stand-in for the shader fur)
  const coat = new THREE.BufferGeometry(), nb = c.bodyVerts, cp = pos.slice(0, nb * 3);
  for (let i = 0; i < nb; i++) {
    const L = fur[i * 4 + 1] * 0.62, dr = fur[i * 4 + 3];
    for (let k = 0; k < 3; k++) cp[i * 3 + k] += L * (nrm[i * 3 + k] * 0.8 + (dir[i * 3 + k] + (k === 1 ? -dr : 0)) * 0.35);
  }
  coat.setAttribute('position', new THREE.BufferAttribute(cp, 3)); coat.setAttribute('color', new THREE.BufferAttribute(take('color', nb, 3), 3));
  coat.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(take('skinIndex', nb, 4), 4)); coat.setAttribute('skinWeight', new THREE.BufferAttribute(take('skinWeight', nb, 4), 4));
  coat.setIndex(Array.from(g.index.array.slice(0, c.bodyIndex))); coat.computeVertexNormals();
  const group = new THREE.Group(); group.name = 'ShihTzuPuppy';
  const rootBone = p.bones.root; group.add(rootBone);
  const mk = (geo, name, rough) => { const m = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, name })); m.name = name; group.add(m); m.bind(p.skeleton, new THREE.Matrix4()); return m; };
  mk(body, 'dog_body', 0.7); mk(coat, 'dog_coat', 0.9);
  // clips sampled at 30 fps from the live procedural controller
  const fps = 30, dt = 1 / fps, bones = p.skeleton.bones, clips = [];
  const bake = (name, warm, rec, frames, onStep) => {
    simulate(p, warm);
    const times = [], q = bones.map(() => []), hp = [], rp = [];
    for (let f = 0; f < frames; f++) {
      const s = rec(f); onStep?.(f, s); p.update(f ? dt : 0, s);
      times.push(f * dt); bones.forEach((b, i) => q[i].push(...b.quaternion.toArray())); hp.push(...p.bones.hips.position.toArray()); rp.push(0, p.root.position.y, 0);
    }
    const tracks = bones.map((b, i) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, q[i]));
    tracks.push(new THREE.VectorKeyframeTrack(`${p.bones.hips.name}.position`, times, hp), new THREE.VectorKeyframeTrack(`${p.bones.root.name}.position`, times, rp));
    clips.push(new THREE.AnimationClip(name, -1, tracks));
  };
  const reset = () => { p.root.position.set(0, 0, 0); p.root.rotation.y = 0; };
  // walk at 0.3 m/s: stride frequency 1.6 + 3 v = 2.5 Hz, i.e. exactly 12 frames per gait cycle, so the clip loops
  const wv = 0.3, cyc = Math.round(fps / (1.6 + 3 * wv));
  reset(); bake('walk', [{ mode: 'walk', dur: 2, speed: wv }], () => ({ mode: 'walk', speed: wv, turn: 0 }), cyc * 2 + 1, () => { p.root.position.z = 0; });
  reset(); bake('idle', [{ mode: 'idle', dur: 1 }], () => ({ mode: 'idle' }), fps * 6);
  reset(); bake('sit', [{ mode: 'idle', dur: 0.3 }], () => ({ mode: 'sit' }), fps * 4);
  reset(); bake('lie', [{ mode: 'idle', dur: 0.3 }], () => ({ mode: 'lie' }), fps * 5);
  // trot when called: 0.895 m/s gives 1.6 + 3 v = 4.29 Hz, exactly 7 frames per cycle
  const tv = 0.895, tc = Math.round(fps / (1.6 + 3 * tv));
  reset(); bake('trot', [{ mode: 'walk', dur: 1.5, speed: tv, excite: 1 }], () => ({ mode: 'walk', speed: tv, turn: 0, excite: 1 }), tc * 4 + 1, () => { p.root.position.z = 0; });
  // petting reactions (s.petN % 3: joy hops, play bow, belly rub), 5 s each from a stand; sitting and looking up at a person
  const petClip = (name, n) => { reset(); bake(name, [{ mode: 'idle', dur: 0.5 }], (f) => ({ mode: 'pet', petT: f * dt, petLeft: Math.max(0, 5 - f * dt), petN: n, excite: 1, look: new THREE.Vector3(0, 1.5, 0.8) }), fps * 5 + 1); };
  petClip('pet', 0); petClip('pet_bow', 1); petClip('pet_belly', 2);
  const att = { mode: 'sit', attend: true, excite: 0.8, look: new THREE.Vector3(0, 1.5, 0.8) };
  reset(); bake('sit_look', [{ mode: 'idle', dur: 0.3 }, { ...att, dur: 1.5 }], () => att, fps * 3);
  const jf = Math.round(p.jumpDuration * fps), arc = (f) => { const u = (Math.min(1, f / jf) - p.jumpTakeoff) / (p.jumpLand - p.jumpTakeoff); return u > 0 && u < 1 ? 4 * p.jumpHeight * u * (1 - u) : 0; };
  reset(); bake('jump', [{ mode: 'idle', dur: 0.5 }], (f) => ({ mode: f <= jf ? 'jump' : 'idle', jumpT: Math.min(1, f / jf), lift: arc(f) }), jf + 10, (f) => { p.root.position.y = arc(f); });
  const glb = await new GLTFExporter().parseAsync(group, { binary: true, animations: clips });
  const gltf = await new GLTFLoader().parseAsync(glb.slice(0), '');
  let skinned = 0, boneCount = 0; gltf.scene.traverse((o) => { if (o.isSkinnedMesh) { skinned++; boneCount = o.skeleton.bones.length; } });
  const bytes = new Uint8Array(glb); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), size: bytes.length, reimport: { skinnedMeshes: skinned, bones: boneCount, clips: gltf.animations.map((a) => `${a.name} ${a.duration.toFixed(2)}s ${a.tracks.length} tracks`) } };
};

// interactive mode
let mode = 'idle', last = performance.now(), jt = 0;
addEventListener('keydown', (e) => { const m = ['idle', 'walk', 'sit', 'lie', 'jump'][+e.key - 1]; if (m) { mode = m; jt = 0; } });
function loop() {
  if (window.__auto) return;
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
  const s = { mode, speed: mode === 'walk' ? pet.walkSpeed : 0, turn: 0, t: 0, jumpT: 0 };
  if (mode === 'jump') {
    jt += dt / pet.jumpDuration; if (jt >= 1) { mode = 'idle'; jt = 1; }
    const u = (jt - pet.jumpTakeoff) / (pet.jumpLand - pet.jumpTakeoff); s.jumpT = jt; pet.root.position.y = u > 0 && u < 1 ? 4 * pet.jumpHeight * u * (1 - u) : 0;
  } else pet.root.position.y = 0;
  pet.update(dt, s); controls.update(); render();
  hud.textContent = `${mode}  calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}`;
  requestAnimationFrame(loop);
}
window.__auto = Q.has('auto');
if (!window.__auto) requestAnimationFrame(loop); else { setView(Q.get('view') ?? 'q34'); render(); }
window.__ready = true;
