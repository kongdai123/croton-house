// Node-only shader/scene fixtures: no fetches, canvas, WebGL context, browser or GPU.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-baked-'));
try {
  const internals = { name: 'fixture-exports', setup(b) {
    b.onLoad({ filter: /\/pets\/roam\.js$/ }, () => ({ contents: 'export const groundY = () => 0;', loader: 'js' }));
  } };
  const result = await build({ stdin: { contents: "export * from './src/lightmap.js'; export * from './src/foliage_bake.js'; export * as THREE from 'three'; export { leafMat } from './src/furniture/plants_parts.js';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [internals] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, result.outputFiles[0].contents);
  globalThis.location = { search: '?lightmap=sunrise&contact&agx=three' };
  const { THREE: T, probeLit, createSunPCSS, shaderPatch, shaderReplace, FOLIAGE, reflGLSL, TONE_DECODE, LM_SAMPLE, loadRGBM, leafMat } = await import(pathToFileURL(file));
  const shader = () => ({ uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader });
  const scene = new T.Scene(), sun = new T.DirectionalLight(); scene.add(sun, sun.target);
  const calls = [], renderer = { autoClear: false, capabilities: { maxTextureSize: 16384 }, shadowMap: { enabled: true }, getRenderTarget() { return null; }, setRenderTarget() {}, render(s) { const mats = []; s.traverse(o => { if (o.isMesh) mats.push(o.material); }); calls.push(mats); } };
  const pcss = createSunPCSS(renderer, scene, sun, 16), seen = new Map();
  const warn = console.warn, warnings = []; console.warn = (...a) => warnings.push(a);
  try {
    // Any differing generated source must have a differing cache key, independent of compile order.
    for (const name of ['plain', 'plant-leaf', 'garden-leaf']) for (const alphaTest of [0, 0.4]) for (const wet of [0, 1]) for (const refl of [null, { count: 2, uniforms: {} }]) for (const fol of [false, true]) {
      // plant leaves and garden leaf cards declare their surface (lighting manifest), as plants_parts.js and grass.js do
      const m = new T.MeshStandardMaterial({ alphaTest }); m.name = name; if (fol) m.foliageBake = FOLIAGE;
      if (name !== 'plain') m.userData.lighting = { surface: name === 'garden-leaf' ? 'leafCard' : 'foliage' };
      const original = m.customProgramCacheKey();
      probeLit(m, { uniforms: {}, wet, refl }, pcss);
      const key = m.customProgramCacheKey(), sh = shader(); m.onBeforeCompile(sh, renderer);
      assert.ok(key.startsWith(original)); assert.equal(m.customProgramCacheKey(), key);
      assert.ok(sh.fragmentShader.includes('sunPCSS')); assert.ok(sh.vertexShader.includes('vBakedWorld'));
      const source = sh.vertexShader + sh.fragmentShader;
      if (seen.has(key)) assert.equal(source, seen.get(key), key); else seen.set(key, source);
      // leaves stay dry: leaf cards, and a plant's cut-out leaves (an alpha mask alone is not a plant)
      assert.equal(sh.fragmentShader.includes('float wetPuddle ='), wet > 0 && name !== 'garden-leaf' && !(name === 'plant-leaf' && alphaTest));
      assert.equal(sh.fragmentShader.includes('foliageScale'), fol);
    }
    const leaf = leafMat('wet-fixture', new T.Texture(), { soft: true, alpha: false });
    probeLit(leaf, { uniforms: {}, wet: 1 }, pcss); const leafLit = shader(); leaf.onBeforeCompile(leafLit, renderer);
    assert.ok(leafLit.fragmentShader.includes('float wetMask =')); assert.ok(leafLit.fragmentShader.includes('sunPCSS'));
    const sheer = new T.MeshPhysicalMaterial(); sheer.userData.sheer = { reflect: 0.3, transmit: 0.7 };
    probeLit(sheer, { uniforms: {}, wet: 1, refl: { count: 2, uniforms: {} } }, pcss);
    const sh = shader(); sheer.onBeforeCompile(sh, renderer);
    assert.ok(sh.fragmentShader.includes('sheerResponse')); assert.ok(sh.fragmentShader.includes('1.0 - pow( max( 1.0 - diffuseColor.a'));
    const alpha = (a, spread) => 1 - (1 - a) ** Math.max(1, 0.7 / Math.max(spread, 0.02));
    assert.equal(alpha(0.8, 1), 0.8); assert.ok(alpha(0.8, 0.05) > 0.99999);
    // A retained fur/wind hook survives; the old raster GI wrapper must never run.
    const m = new T.MeshStandardMaterial(); let deformation = 0;
    m.ownShader = { compile(s) { deformation++; s.vertexShader = '// deformation\n' + s.vertexShader; }, key: 'fur' };
    m.onBeforeCompile = () => { throw new Error('legacy GI ran'); };
    // (installing runs the hook once on a scratch copy of the template: the samplers it adds count in the plan)
    probeLit(m, { uniforms: {}, wet: 0 }, pcss); deformation = 0; const f = shader(); m.onBeforeCompile(f, renderer); assert.equal(deformation, 1); assert.ok(f.vertexShader.startsWith('// deformation\n') && f.vertexShader.includes('varying vec3 vBakedWorld;\nvoid main() {'));
    assert.deepEqual(warnings, []);
    // Missing or duplicated replacements leave both strings and uniforms untouched, warn once per patch.
    const bad = shader(), original = structuredClone(bad);
    assert.equal(shaderPatch(bad, 'fixture missing', s => { s.uniforms.bad = {}; s.vertexShader = 'broken'; s.fragmentShader = shaderReplace(s.fragmentShader, 'missing', '', 'fixture token'); }), false);
    shaderPatch(bad, 'fixture missing', s => { shaderReplace(s.fragmentShader, 'missing', '', 'fixture token'); });
    assert.deepEqual(bad, original); assert.equal(warnings.length, 1); assert.match(warnings[0][0], /fixture missing/);
    assert.throws(() => shaderReplace('xx', 'x', '', 'duplicate'), /got 2/);
    // A foliage-baked material whose probe crossfade the sampler plan leaves out keeps its per-vertex level on the
    // current slot too (it used to blend toward the next slot while the probes' mean stayed on the current one).
    const leafy = new T.MeshStandardMaterial(); leafy.name = 'fixture-leafy'; leafy.foliageBake = FOLIAGE; leafy.userData.lighting = { surface: 'foliage' };
    const slots = { uniforms: { uSlotBlend: { value: 0 }, uSlotLampA: { value: 0 }, uSlotLampB: { value: 0 } }, wet: { value: 0 } };
    probeLit(leafy, { uniforms: {}, wet: 0, multi: true, slots }, pcss);
    const roomy = shader(); leafy.onBeforeCompile(roomy, { capabilities: { maxTextures: 16 } });
    assert.ok(roomy.vertexShader.includes('foliageNext') && roomy.fragmentShader.includes('uProbeNextSH'));
    // 8 samplers: dfgLUT, environment, sun shadow, uSunDepth, uProbeSH + next, contact sun 2; at 5 the contact sun and
    // the crossfade leave
    const tight = shader(); leafy.onBeforeCompile(tight, { capabilities: { maxTextures: 5 } });
    assert.deepEqual(tight.samplerDropped, ['contact sun', 'slot crossfade']);
    assert.ok(!tight.vertexShader.includes('foliageNext') && !tight.fragmentShader.includes('uProbeNextSH') && tight.fragmentShader.includes('foliageScale( bakedProbe )'));
    assert.match(warnings.at(-1)[0], /"fixture-leafy": 8 fragment samplers > 5 texture units; dropped contact sun, slot crossfade$/);
  } finally { console.warn = warn; }
  // Tracked casters: world transform and effective visibility, including parent transforms, every frame.
  const parent = new T.Group(), mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial({ alphaTest: 0.3 }));
  mesh.castShadow = true; parent.add(mesh); scene.add(parent); pcss.track(parent);
  pcss.update(0.1); const depth = calls.at(-1)[0], v = pcss.version;
  mesh.rotation.y = 0.5; pcss.update(0.01); assert.equal(pcss.version, v); // throttle
  mesh.rotation.y = 1; pcss.update(0.01); assert.equal(pcss.version, v);
  pcss.update(0.01); assert.equal(pcss.version, v + 1); // settled pose, even inside 100 ms
  assert.equal(calls.at(-1)[0], depth); assert.equal(mesh.material.isMeshStandardMaterial, true);
  parent.position.x = 1; pcss.update(0.1); assert.equal(pcss.version, v + 2);
  parent.visible = false; pcss.update(0.1); assert.equal(pcss.version, v + 3);
  parent.visible = true; pcss.update(0.1);
  const custom = new T.MeshDepthMaterial(); mesh.customDepthMaterial = custom;
  pcss.update(0.1); assert.equal(calls.at(-1)[0], custom); // custom wind/deformation remains authoritative
  // shader-only wind is a snapshot: no refresh of its own
  const windVersion = pcss.version; pcss.update(0.01); assert.equal(pcss.version, windVersion); pcss.update(0.1); assert.equal(pcss.version, windVersion);
  const door = new T.Mesh(mesh.geometry, mesh.material); door.castShadow = true; scene.add(door); pcss.track(door); pcss.update(0.1);
  door.rotation.y = 0.4; pcss.update(0.01); const settleVersion = pcss.version;
  pcss.update(0.01); assert.equal(pcss.version, settleVersion + 1); // flush the door's final pose while wind still runs
  pcss.update(0.01); assert.equal(pcss.version, settleVersion + 1); // no redundant settled refresh
  scene.remove(door); pcss.update(0.1);
  delete mesh.customDepthMaterial;
  const bone = new T.Bone(); parent.add(bone); mesh.skeleton = { bones: [bone] }; mesh.morphTargetInfluences = [0];
  mesh.instanceMatrix = new T.InstancedBufferAttribute(new Float32Array(16), 16); mesh.count = 1;
  pcss.update(0.1); let shapeVersion = pcss.version;
  bone.rotation.x = 0.3; pcss.update(0.1); assert.equal(pcss.version, ++shapeVersion);
  mesh.morphTargetInfluences[0] = 0.5; pcss.update(0.1); assert.equal(pcss.version, ++shapeVersion);
  mesh.instanceMatrix.needsUpdate = true; pcss.update(0.1); assert.equal(pcss.version, ++shapeVersion);
  pcss.update(0.1); assert.equal(pcss.version, shapeVersion);
  delete mesh.skeleton; delete mesh.morphTargetInfluences; delete mesh.instanceMatrix;
  mesh.castShadow = false; pcss.update(0.1); assert.equal(mesh.visible, true);
  assert.equal(renderer.shadowMap.enabled, true); assert.equal(renderer.autoClear, false);
  // An untracked caster found moving by the slow scan joins the moving set; one that never stops becomes ambient.
  const still = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()); still.castShadow = true; scene.add(still); pcss.invalidate(); pcss.update(0.1);
  // (still casters' world matrices come from the frame's render: the test updates them itself)
  const stillMoving = pcss.stats.tracked; still.position.x = 1; scene.updateMatrixWorld(); pcss.update(0.02); pcss.update(0.02); assert.equal(pcss.stats.tracked, stillMoving + 1);
  for (let i = 0; i < 150; i++) { still.position.x += 0.01; scene.updateMatrixWorld(); pcss.update(0.02); }
  const ambient = pcss.version; for (let i = 0; i < 20; i++) { still.position.x += 0.01; scene.updateMatrixWorld(); pcss.update(0.02); } assert.equal(pcss.version, ambient); assert.equal(pcss.stats.ambient, 1);
  scene.remove(still); pcss.update(0.1);
  // The hover highlight (interact.js) swaps in a tinted copy with the same shader hook: depth does not change, so the still
  // caster is neither promoted nor redrawn (it was: every seat the crosshair crossed cost a full base redraw).
  const seat = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()); seat.castShadow = true; scene.add(seat); pcss.invalidate(); pcss.update(0.1);
  const seatTracked = pcss.stats.tracked, seatStatic = pcss.stats.staticRenders, tint = seat.material.clone(); tint.onBeforeCompile = seat.material.onBeforeCompile;
  seat.material = tint; for (let i = 0; i < 150; i++) pcss.update(0.02);
  assert.equal(pcss.stats.tracked, seatTracked); assert.equal(pcss.stats.staticRenders, seatStatic);
  tint.alphaTest = 0.5; for (let i = 0; i < 150; i++) pcss.update(0.02); assert.equal(pcss.stats.tracked, seatTracked + 1);   // a cut-out change still counts
  scene.remove(seat); pcss.update(0.1);
  // A tracked caster leaves base (one base redraw) when it starts moving and returns there 2 s after it stops.
  mesh.castShadow = true; for (let i = 0; i < 25; i++) pcss.update(0.1); pcss.invalidate(); pcss.update(0.1); assert.equal(pcss.stats.hot, 0);
  const staticRenders = pcss.stats.staticRenders; parent.position.x += 0.5; pcss.update(0.1);
  assert.equal(pcss.stats.staticRenders, staticRenders + 1); assert.equal(pcss.stats.hot, 1);
  parent.position.x += 0.5; pcss.update(0.1); assert.equal(pcss.stats.staticRenders, staticRenders + 1);   // a cheap refresh
  for (let i = 0; i < 25; i++) pcss.update(0.1); assert.equal(pcss.stats.hot, 1); pcss.render(); assert.equal(pcss.stats.hot, 0);
  // without a forced render, the cooled caster is folded back by one base redraw about a second later
  const folded = pcss.stats.staticRenders; parent.position.x += 0.5; pcss.update(0.1); assert.equal(pcss.stats.hot, 1);
  for (let i = 0; i < 40; i++) pcss.update(0.1); assert.equal(pcss.stats.hot, 0); assert.ok(pcss.stats.staticRenders >= folded + 2);
  // Real leaf callbacks reference normal even in a depth variant; their alpha map and normal chunks survive.
  mesh.castShadow = true; mesh.material = leafMat('fixture', new T.Texture(), { soft: true }); pcss.render();
  const leafDepth = calls.at(-1)[0], leafShader = { uniforms: {}, vertexShader: T.ShaderLib.depth.vertexShader, fragmentShader: T.ShaderLib.depth.fragmentShader };
  leafDepth.onBeforeCompile(leafShader, renderer);
  assert.ok(leafShader.fragmentShader.includes('vec3 normal = normalize( vNormal )')); assert.ok(leafShader.vertexShader.includes('vHighPrecisionZW = gl_Position.zw')); assert.equal(leafDepth.map, mesh.material.map);
  // Exceptions restore every swap and renderer flag.
  mesh.castShadow = true; const material = mesh.material, render = renderer.render;
  renderer.render = () => { throw new Error('render fixture'); };
  assert.throws(() => pcss.render(), /render fixture/); assert.equal(mesh.material, material); assert.equal(mesh.visible, true); assert.equal(renderer.shadowMap.enabled, true); renderer.render = render;
  let depthDisposed = false; depth.addEventListener('dispose', () => { depthDisposed = true; }); pcss.dispose(); assert.ok(depthDisposed);
  // A tracked caster leaving base, and folding back, redraws only base's texels around it: the casters whose bounds reach
  // that rect, under a scissor, with the scene's lights as a full redraw has them; one far away is not drawn.
  {
    const s2 = new T.Scene(), sun2 = new T.DirectionalLight(), lamp = new T.PointLight(); sun2.position.set(3, 10, 2); s2.add(sun2, sun2.target, lamp);
    Object.assign(sun2.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 60 }); sun2.shadow.camera.updateProjectionMatrix();
    const drawn = [], scissors = [];
    const r2 = { autoClear: false, capabilities: { maxTextureSize: 16384 }, shadowMap: { enabled: true }, target: null, getRenderTarget() { return this.target; }, setRenderTarget(t) { this.target = t; },
      render(s, cam) {
        const list = [], lit = []; s.traverseVisible(o => { if (o.isMesh && o.layers.test(cam.layers)) list.push(o); if (o.isLight && o.layers.test(cam.layers)) lit.push(o); });
        drawn.push({ list, lit }); scissors.push(this.target?.scissorTest ? this.target.scissor.clone() : null);
      } };
    const box = (x, z) => { const m = new T.Mesh(new T.BoxGeometry(0.5, 1, 0.5), new T.MeshStandardMaterial()); m.position.set(x, 0.5, z); m.castShadow = true; s2.add(m); return m; };
    const near = box(1, 0), far = box(15, 15), door = new T.Group(), leaf = box(0, 0); s2.remove(leaf); door.add(leaf); s2.add(door);
    s2.updateMatrixWorld(true);
    const p2 = createSunPCSS(r2, s2, sun2, 512); p2.track(door); p2.update(0.1);
    const fullLights = drawn.at(-1).lit.length;
    assert.equal(p2.stats.partialRenders, 0); assert.ok(drawn.some(d => d.list.includes(far)));   // the first redraw is a full one
    const before = drawn.length; door.rotation.y = 0.3; door.updateMatrixWorld(true); p2.update(0.1);
    const region = drawn.slice(before).find((d, i) => scissors[before + i]);
    assert.equal(p2.stats.partialRenders, 1, 'leaving base is a partial redraw'); assert.ok(region, 'under a scissor');
    assert.ok(region.list.includes(near) && !region.list.includes(far) && !region.list.includes(leaf), 'the casters around the door, not the far one, not the hot leaf');
    assert.equal(region.lit.length, fullLights, 'the same lights as a full redraw');
    assert.equal(p2.stats.staticRenders, 2);
    for (let i = 0; i < 40; i++) p2.update(0.1);   // cools after 2 s, folds back about a second later
    assert.equal(p2.stats.partialRenders, 2, 'folding back is a partial redraw too'); assert.equal(p2.stats.hot, 0);
    const back = drawn.filter((d, i) => scissors[i]).at(-1);
    assert.ok(back.list.includes(leaf) && !back.list.includes(far), 'the leaf returns to base, the far caster is not redrawn');
    assert.ok(near.layers.test(new T.Camera().layers) && !near.layers.isEnabled(28) && !lamp.layers.isEnabled(28), 'layers restored');
    p2.render(); assert.equal(p2.stats.partialRenders, 2, 'a forced render is a full one');
    p2.dispose();
  }
  // Slabs explicitly branch around parallel rays (including origins ON a box face), mip zero at roughness zero.
  const slab = (p, r) => {
    let near = -1e20, far = 1e20;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(r[i]) < 1e-7) { if (p[i] < -1 || p[i] > 1) return null; }
      else { const a = (-1 - p[i]) / r[i], b = (1 - p[i]) / r[i]; near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); }
    }
    return far >= Math.max(near, 0) ? far : null;
  };
  assert.equal(slab([1, 0, 0], [0, 1, 0]), 1); assert.equal(slab([1, 0, 0], [1, 0, 0]), 0); assert.equal(slab([1, 0, 0], [-1, 0, 0]), 2); assert.equal(slab([1.1, 0, 0], [0, 1, 0]), null);
  const refl = reflGLSL(2); assert.ok(refl.includes('abs( R[ axis ] ) < 1e-7')); assert.ok(refl.includes('farT >= max( nearT, 0.0 )')); assert.ok(refl.includes('clamp( rough, 0.0, 1.0 ) * uReflMips'));
  assert.ok(TONE_DECODE.includes('float K')); assert.ok(!TONE_DECODE.includes('toFixed')); assert.equal((LM_SAMPLE.match(/texelFetch/g) ?? []).length, 4);
  // Nonlinear decode before averaging is numerically different from averaging encoded light first.
  const decode = y => 0.2 * y * y / Math.max(1 - y * y, 1 / 255);
  assert.ok((decode(0.2) + decode(0.9)) / 2 > decode(0.55) * 3);
  // Split texture restore reuses retained decoded parts, then releases each bitmap exactly once.
  let closed = 0, uploads = 0;
  globalThis.fetch = async () => ({ ok: true, blob: async () => ({}) });
  globalThis.createImageBitmap = async () => ({ width: 4, height: 2, close() { closed++; } });
  const atlasRenderer = { capabilities: { maxTextureSize: 16 }, initTexture() {}, copyTextureToTexture() { uploads++; } };
  const atlas = await loadRGBM(['slot0', 'slot1'], [2, 2], atlasRenderer);
  assert.equal(uploads, 2); assert.equal(closed, 0); assert.equal(atlas.generateMipmaps, true); assert.equal(atlas.minFilter, T.LinearMipmapLinearFilter);
  atlas.userData.restore(); assert.equal(uploads, 4); assert.equal(closed, 0); atlas.dispose(); atlas.userData.release(); assert.equal(closed, 2);
  console.log(`baked shaders: ${seen.size} cache variants, atomic failures, GI removal, sheer coverage, PCSS transforms/throttle/reuse/custom depth, split restore OK`);
} finally { await rm(dir, { recursive: true, force: true }); }
