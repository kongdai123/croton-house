// TAA motion vectors (src/motion.js), node only: the velocity shader's construction on the real materials, the jitter and
// sign conventions it shares with taa.js's resolve, and the previous-frame state it draws with: a rigid mover's world
// matrix, a skinned mesh's bones, the grass wind's time (sway at t - dt) and the dog's fur lag, and what counts as moving.
import assert from 'node:assert/strict';
import { buildRealScene } from './harness/scene.mjs';

const W = await buildRealScene({ variant: 'motion', extra: `
  export { createMotion, doubleVertex, resolveIncludes, screenMotion, shaderMotion, MIN_PIXELS } from './src/motion.js';
  export { windOffset, windRate } from './src/grass.js';
  export { createPet as createDog } from './src/pets/dog.js';
  export { createPet as createCat } from './src/pets/cat.js';` });
const { T, createMotion, doubleVertex, resolveIncludes, MIN_PIXELS } = W;

// ---- the double vertex shader: the previous frame's copy renames the camera, the matrices, the bones and the material's
// own animated uniforms, and only that copy
const blocks = vs => {
  const i = vs.indexOf('vec4 mvPrevClip = vec4(0.0);'), j = vs.indexOf('\n  {\n', i + 1), k = vs.indexOf('\n  {\n', j + 1);
  return { head: vs.slice(0, vs.search(/void\s+main/)), before: vs.slice(j, k), now: vs.slice(k) };
};
{
  const vs = doubleVertex(T.ShaderLib.depth.vertexShader), b = blocks(vs);
  assert.match(b.before, /mvPrevClip = mvPrevProjection \* mvPosition;/);
  assert.match(b.before, /mvPosition = mvPrevModelView \* mvPosition;/);
  assert.match(b.before, /mvPrevBone\( skinIndex\.x \)/);
  for (const name of ['gl_Position', 'projectionMatrix', 'modelViewMatrix', 'getBoneMatrix', '#include']) assert.ok(!b.before.includes(name), `previous copy still has ${name}`);
  assert.match(b.now, /#include <project_vertex>/);
  assert.match(vs, /vMotionNow = vec4\(gl_Position\.xy - uMotionJitter \* gl_Position\.w, gl_Position\.zw\);\s*vMotionPrev = mvPrevClip;\s*\}\s*$/);
  assert.equal(resolveIncludes(b.before).length, b.before.length, 'every include resolved in the previous copy');
}
// every material that animates in its vertex shader: the uniforms it lists exist, and the previous copy reads their copies
const hooked = source => {
  const lib = T.ShaderLib.standard, sh = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {}, defines: {} };
  source.onBeforeCompile.call(source, sh); return sh;
};
const dog = W.createDog({ fresh: true }), cat = W.createCat({ fresh: true });
const specs = new Set();
for (const root of [W.scene, dog.root, cat.root]) root.traverse(o => { for (const m of [].concat(o.material ?? [])) if (m?.userData?.motion) specs.add(m); });
const kinds = new Set([...specs].map(m => m.name || m.type));
assert.ok([...specs].some(m => m.name?.startsWith('garden-')), 'the garden wind declares its motion');
assert.ok(specs.size >= 4, `materials with vertex animation: ${[...kinds].join(', ')}`);
for (const m of specs) {
  const sh = hooked(m), own = m.userData.motion.uniforms ?? {};
  assert.notEqual(sh.vertexShader, T.ShaderLib.standard.vertexShader, `${m.name}: its hook edits the vertex shader`);
  const vs = doubleVertex(sh.vertexShader, own), b = blocks(vs);
  for (const [name, type] of Object.entries(own)) {
    assert.match(b.head, new RegExp(`uniform\\s+${type}\\s+[^;]*\\b${name}\\b`), `${m.name}: ${name} is a ${type} uniform of its shader`);
    assert.ok(sh.uniforms[name], `${m.name}: its hook binds ${name}`);
    assert.match(b.head, new RegExp(`uniform ${type} ${name}_mvPrev;`));
    assert.ok(b.before.includes(`${name}_mvPrev`) && !new RegExp(`\\b${name}\\b`).test(b.before), `${m.name}: the previous copy reads ${name}_mvPrev only`);
    assert.ok(new RegExp(`\\b${name}\\b`).test(b.now), `${m.name}: this frame's copy reads ${name}`);
  }
}

// ---- conventions shared with taa.js: the jitter is a clip-space offset of 2 x jitter x w (taa.js render), which the
// velocity shader takes off again (uMotionJitter = 2 x the uv jitter); velocity is uv now - uv before, and the resolve
// reads its history at vUv - velocity, where the point was
{
  const cam = new T.PerspectiveCamera(60, 16 / 9, 0.1, 100); cam.position.set(0.3, 1.6, 2); cam.lookAt(0, 1, 0); cam.updateMatrixWorld(true);
  const P = cam.projectionMatrix.clone(), J = P.clone(), jitter = new T.Vector2(0.37 / 1920, -0.21 / 1080), e = J.elements;
  for (let k = 0; k < 4; k++) { e[k * 4] += 2 * jitter.x * e[k * 4 + 3]; e[k * 4 + 1] += 2 * jitter.y * e[k * 4 + 3]; }
  const p = new T.Vector4(0.4, 1.2, -0.5, 1).applyMatrix4(cam.matrixWorldInverse);
  const clip = p.clone().applyMatrix4(J), plain = p.clone().applyMatrix4(P);
  assert.ok(Math.abs(clip.x - 2 * jitter.x * clip.w - plain.x) < 1e-9 && Math.abs(clip.y - 2 * jitter.y * clip.w - plain.y) < 1e-9, 'jitter removed in clip space');
  // a point moving right: velocity > 0 and the history sample lies to its left
  const uv = v => (v.x / v.w) * 0.5 + 0.5, before = new T.Vector4(0, 1.2, -0.5, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(P);
  const velocity = uv(plain) - uv(before); assert.ok(velocity > 0 && uv(plain) - velocity === uv(before));
}

// ---- previous-frame state and what moves
const camera = new T.PerspectiveCamera(50, 16 / 9, 0.1, 200); camera.updateMatrixWorld(true);
const PX = 1080 / (2 * Math.tan(T.MathUtils.degToRad(50) / 2)), DT = 1 / 60;
const frame = (motion, objects, dt = DT) => { for (const o of objects) { o.updateWorldMatrix(true, true); motion.seen(o); } const n = motion.classify(camera, PX, dt); return n; };
const proxyOf = (motion, o) => motion.scene.children.find(p => p.visible && p.geometry === o.geometry);
{
  // a door 3 m away swinging 1.5 degrees a frame about its hinge: moving from the second frame it is drawn
  const motion = createMotion(), hinge = new T.Group(), door = new T.Mesh(new T.BoxGeometry(0.9, 2, 0.04).translate(0.45, 1, 0), new T.MeshStandardMaterial());
  hinge.position.set(-0.5, 0, -3); hinge.add(door);
  assert.equal(frame(motion, [door]), 0, 'first frame: no previous pose, drawn as still'); const pose0 = door.matrixWorld.clone(); motion.advance();
  hinge.rotation.y = THREE_DEG(1.5);
  assert.equal(frame(motion, [door]), 1); assert.equal(motion.stats.rigid, 1);
  const p = proxyOf(motion, door); assert.ok(p && p.userData.prevModel.equals(pose0) && p.matrixWorld.equals(door.matrixWorld), 'previous and current world matrices');
  assert.ok(p.material.vertexShader.includes('mvPrevModelView'));
  motion.advance();
  // a frame not drawn (merged into a rest cluster, hidden): the next one has no previous pose
  motion.advance(); hinge.rotation.y = THREE_DEG(3);
  assert.equal(frame(motion, [door]), 0, 'after a frame away: still for one frame'); motion.advance();
  hinge.rotation.y = THREE_DEG(4.5); assert.equal(frame(motion, [door]), 1); motion.advance();
  // plant sway: a 1 m frond 3 m away turning 0.0003 rad a frame (a=0.012 rad, f=0.6/s, ~0.007 rad/s) stays under MIN_PIXELS
  const frond = new T.Mesh(new T.BoxGeometry(0.05, 1, 0.3).translate(0, 0.5, 0), new T.MeshStandardMaterial()); frond.position.set(0.5, 0, -3);
  frame(motion, [frond]); motion.advance(); frond.rotation.z = 0.0003;
  assert.equal(frame(motion, [frond]), 0, `sway under ${MIN_PIXELS} px is left to the depth reprojection`); motion.advance();
  // a mesh drawn again at the same world matrix is settled in the draw hook: not even a candidate (its record holds the
  // matrix exactly: a single-precision copy made every mesh at an unrepresentable position look moved)
  const shelf = new T.Mesh(new T.BoxGeometry(1, 2, 0.4), new T.MeshStandardMaterial()); shelf.position.set(0.1, 0.3, -2.7); shelf.rotation.y = 0.7;
  frame(motion, [shelf]); motion.advance(); frame(motion, [shelf]);
  assert.equal(motion.stats.candidates, 0, 'a still mesh is no candidate'); motion.advance();
  // a carried chair moving 2 cm in a frame, 2 m away: a mover
  const chair = new T.Mesh(new T.BoxGeometry(0.5, 0.9, 0.5), new T.MeshStandardMaterial()); chair.position.set(0, 0.45, -2);
  frame(motion, [chair]); motion.advance(); chair.position.x += 0.02; assert.equal(frame(motion, [chair]), 1); motion.advance();
}
{
  // skinned: the bones of the previous frame go to the velocity shader
  const motion = createMotion();
  dog.root.position.set(0, 0, -1.5); dog.update(DT, { mode: 'walk', speed: 0.4 });
  const fur = dog.mesh;
  frame(motion, [fur]); fur.skeleton.update(); const bones0 = fur.skeleton.boneMatrices.slice(); const lag0 = dog.mesh.material.userData.uniforms.uLag.value.clone();
  motion.advance();
  for (let i = 0; i < 6; i++) dog.update(DT, { mode: 'walk', speed: 0.4 });
  dog.root.position.x += 0.01;
  assert.equal(frame(motion, [fur]), 1); assert.equal(motion.stats.skinned, 1); fur.skeleton.update();
  const p = proxyOf(motion, fur), prev = p.userData.prevBones.image.data;
  assert.ok(p.isSkinnedMesh && p.skeleton === fur.skeleton, 'the proxy shares the skeleton');
  assert.deepEqual(Array.from(prev.slice(0, bones0.length)), Array.from(bones0), 'previous bone matrices');
  assert.ok(fur.skeleton.boneMatrices.some((v, i) => Math.abs(v - bones0[i]) > 1e-6), 'the walk moved the bones');
  const u = p.material.uniforms; assert.ok(u.uLag_mvPrev.value.equals(lag0), 'the fur lag of the previous frame');
  assert.ok(u.uLag === dog.mesh.material.userData.uniforms.uLag, "this frame's lag is the dog's own uniform");
  motion.advance();
}
{
  // grass: the wind's time of the previous frame (sway at t - dt), and only tiles near enough to move a fraction of a pixel
  const tiles = []; W.garden.group.traverse(o => { if (o.isInstancedMesh && o.material?.userData?.motion) tiles.push(o); });
  assert.ok(tiles.length > 10 && tiles.every(t => t.userData.motionSpeed > 0), 'every garden tile has a wind speed');
  const tile = tiles.find(t => t.material.name === 'garden-fountain') ?? tiles[0], c = tile.boundingSphere.center;
  const time = hooked(tile.material).uniforms.uTime;
  const motion = createMotion();
  camera.position.set(c.x, c.y + 1, c.z + tile.boundingSphere.radius + 1); camera.updateMatrixWorld(true);
  time.value = 12.5; frame(motion, [tile]); motion.advance();
  time.value = 12.5 + DT; assert.equal(frame(motion, [tile]), 1); assert.equal(motion.stats.shader, 1);
  const u = proxyOf(motion, tile).material.uniforms;
  assert.equal(u.uTime_mvPrev.value, 12.5); assert.equal(u.uTime.value, 12.5 + DT); assert.ok(u.uWind_mvPrev.value.equals(u.uWind.value));
  motion.advance();
  camera.position.set(c.x, c.y + 1, c.z + tile.boundingSphere.radius + 150); camera.updateMatrixWorld(true);
  time.value += DT; assert.equal(frame(motion, [tile]), 0, 'a far tile: its wind is under a fraction of a pixel');
  // the speed bound holds for the wind formula (a blade's top, 1 m tall)
  const wind = { x: -0.55 / Math.hypot(0.55, 0.83), y: -0.83 / Math.hypot(0.55, 0.83) };
  for (const [sway, flutter] of [[0.12, 0.04], [0.06, 0.025], [0.09, 0.03], [0.05, 0.03]]) {
    let fastest = 0;
    for (let t = 0; t < 30; t += 0.0137) for (const [ox, oz, ph] of [[0, 0, 0], [3.1, -7.2, 2.2], [-11, 4, 5.9]]) {
      const a = W.windOffset(t, wind, ox, oz, ph, sway, flutter, 1), b = W.windOffset(t + 1e-4, wind, ox, oz, ph, sway, flutter, 1);
      fastest = Math.max(fastest, Math.hypot(b[0] - a[0], b[1] - a[1]) / 1e-4);
    }
    assert.ok(fastest <= W.windRate(sway, flutter) && fastest > 0.5 * W.windRate(sway, flutter), `wind speed ${fastest.toFixed(3)} within its bound ${W.windRate(sway, flutter).toFixed(3)}`);
  }
}
{
  // screenMotion is an upper bound of the true motion of every point of the bounding sphere (it decides who is still)
  let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const eye = new T.Vector3(0.3, 1.5, 2), sphere = new T.Sphere(new T.Vector3(0.1, 0.4, -0.2), 0.6);
  for (let k = 0; k < 200; k++) {
    const pose = () => new T.Matrix4().compose(new T.Vector3(rnd() * 4 - 2, rnd(), -2 - rnd() * 4), new T.Quaternion().setFromEuler(new T.Euler(rnd() * 3, rnd() * 3, rnd() * 3)), new T.Vector3(1, 1, 1).multiplyScalar(0.5 + rnd()));
    const a = pose(), b = a.clone().multiply(new T.Matrix4().makeRotationY((rnd() - 0.5) * 0.1)).setPosition(new T.Vector3().setFromMatrixPosition(a).add(new T.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.05)));
    const bound = W.screenMotion(sphere, a.elements, b.elements, eye, PX);
    let worst = 0;
    for (let i = 0; i < 64; i++) {
      const u = new T.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(sphere.radius * rnd()).add(sphere.center);
      const pa = u.clone().applyMatrix4(a), pb = u.clone().applyMatrix4(b);
      worst = Math.max(worst, pa.distanceTo(pb) / Math.max(0.05, pa.distanceTo(eye)) * PX);
    }
    assert.ok(bound >= worst - 1e-9, `screen motion bound ${bound.toFixed(4)} under a point's ${worst.toFixed(4)} px`);
  }
}
function THREE_DEG(d) { return d * Math.PI / 180; }
console.log(`motion vectors: double vertex shader (${specs.size} animated materials: ${[...kinds].slice(0, 6).join(', ')}), jitter and sign, previous matrices, bones, wind time and fur lag, movers OK`);
