// Browser-free local exposure/edge fixtures and real output hooks with recorded draws; no WebGL or network.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-local-adapt-'));
try {
  const built = await build({ stdin: { contents: `
    export * from './src/local_adapt.js'; export { createBakedAutoExposure } from './src/auto_exposure.js';
    export { SLOTS } from './src/lighting_slots.js'; export { blenderAgX } from './src/agx.js';
    export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'; export * as THREE from 'three';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const { LOCAL_ADAPTATION: settings, localAdaptationEnabled, localMapSize, localExposureEV, localGuideWeight,
    createBakedAutoExposure, SLOTS, blenderAgX, OutputPass, THREE: T } = await import(pathToFileURL(file));
  const query = s => new URLSearchParams(s);
  assert.equal(localAdaptationEnabled(query('')), true);
  for (const s of ['autoexp=0', 'fixedexposure', 'rawtone', 'capture', 'localadapt=0', 'fast'])
    assert.equal(localAdaptationEnabled(query(s)), false, s);
  assert.equal(localAdaptationEnabled(query('localadapt=1'), 'mobile'), false);
  assert.equal(settings.mesopic, 0);
  assert.deepEqual(localMapSize(2560, 1440), [160, 90]);
  assert.deepEqual(localMapSize(3840, 2160), [192, 108]);
  assert.deepEqual(localMapSize(1, 1), [1, 1]);
  // Room at log L=-4: the room within the knee (1.5 stops) and its shadows stay as lit; a window drops by half of what lies
  // past the knee, at most 1.5 EV. The first version (strength 0.5 both ways) lifted every dark region and halved the room's
  // contrast (1.8 stops from p10 to p90 in the visitor's rooms, the listing photos 3.3).
  assert.equal(settings.knee, 1.5); assert.equal(settings.lift, 0);
  for (const l of [-4, -2.5, -5.5, -8, -16]) assert.equal(localExposureEV(-4, l), 0, `room and shadows at ${l}`);
  assert.equal(localExposureEV(-4, -1.5), -0.5);   // a sunlit patch 2.5 stops up: 0.5 x the stop past the knee
  assert.equal(localExposureEV(-4, 1), -1.5); assert.equal(localExposureEV(-4, 10), -1.5);   // windows: capped
  assert.equal((1 + localExposureEV(-4, 1)) - (-4), 3.5);   // a window 5 stops up still reads 3.5 stops over the room
  assert.equal(localExposureEV(-4, -8, 0.5, 1.5, 1.5, 0.5), 1.25);   // lift, where a caller asks for it
  assert.equal(localGuideWeight(-4, 3, -4, 3), 1);
  assert.equal(localGuideWeight(-4, 3, 0, 3), 0); // bright window on the same depth plane
  assert.equal(localGuideWeight(-4, 3, -4, 30), 0); // door edge, even with identical luminance
  // A dark 2-pixel frame surrounded by a bright garden has no matching low-res sample: own-log fallback.
  const upsample = (pixel, taps) => {
    let sum = pixel.log * 0.0001, total = 0.0001;
    for (const tap of taps) { const w = tap.spatial * localGuideWeight(pixel.log, pixel.z, tap.guide, tap.z); sum += tap.adapted * w; total += w; }
    return sum / total;
  };
  assert.equal(upsample({ log: -4, z: 3 }, [{ spatial: 1, guide: 0, z: 30, adapted: 0 }]), -4);
  assert.equal(upsample({ log: -4, z: 3 }, [{ spatial: 1, guide: 0, z: 3, adapted: 0 }]), -4);

  const camera = new T.PerspectiveCamera(70, 16 / 9, 0.1, 100), outputPass = new OutputPass(), draws = [];
  camera.updateMatrixWorld();
  let bound = null, indoor = 1, tier = 'laptop', sceneCalls = 0;
  const targets = new Set(), materials = new Set(), depthCopies = [];
  const renderer = {
    toneMapping: T.AgXToneMapping, toneMappingExposure: 0.5, outputColorSpace: T.SRGBColorSpace,
    domElement: new T.EventDispatcher(), getRenderTarget: () => bound, setRenderTarget(t) { bound = t; },
    initRenderTarget(rt) { targets.add(rt); },
    copyTextureToTexture(src, dst) { depthCopies.push([src, dst]); },
    render(mesh) {
      draws.push({ target: bound, material: mesh.material, uniforms: Object.fromEntries(Object.entries(mesh.material.uniforms)
        .map(([key, u]) => [key, u.value?.clone && !u.value.isTexture ? u.value.clone() : u.value])) });
      if (bound !== read && bound !== write && bound !== sceneBuffer) targets.add(bound);
      if (mesh.material !== agx && mesh.material !== outputPass.material) materials.add(mesh.material);
    },
  };
  const scenePass = { isRenderPass: true, render() { sceneCalls++; } }, originalSceneRender = scenePass.render;
  const lighting = { camera, outputPass, indoorWeight: () => indoor, composer: { passes: [scenePass, outputPass] } };
  const originalOutputShader = outputPass.material.fragmentShader;
  const agx = await blenderAgX(outputPass, undefined, [new T.Data3DTexture(), new T.Data3DTexture()]);
  const originalAgxShader = agx.fragmentShader;
  const read = new T.WebGLRenderTarget(2560, 1440), write = read.clone(), sceneBuffer = read.clone();
  sceneBuffer.depthTexture = new T.DepthTexture(2560, 1440);
  read.depthTexture = new T.DepthTexture(2560, 1440); // deliberately the wrong post-process attachment
  const exposure = createBakedAutoExposure({ renderer, lighting, getSlot: () => SLOTS.noon, getTier: () => tier, query: query('') });
  await Promise.resolve(); // patch the already staged Blender AgX material
  assert.ok(agx.fragmentShader.indexOf('t.rgb = localAdapt') < agx.fragmentShader.indexOf('float gain'));
  const fallback = outputPass.material.fragmentShader;
  assert.ok(fallback.indexOf('gl_FragColor.rgb = localAdapt') < fallback.indexOf('gl_FragColor.rgb *= texture2D(tAutoExposure'));
  const draw = (dt = 1 / 60) => {
    draws.length = 0; scenePass.render(renderer, write, sceneBuffer); exposure.update(dt);
    outputPass.render(renderer, write, read); return draws;
  };
  draw(); assert.equal(sceneCalls, 1); assert.equal(draws.length, 8);
  const local = draws.filter(d => d.uniforms.tLocalRaw || d.uniforms.tScene && d.uniforms.tLocalDepth);
  assert.equal(local.length, 3);
  assert.deepEqual(local.map(d => [d.target.width, d.target.height]), [[160, 90], [160, 90], [160, 90]]);
  assert.equal(local[0].uniforms.tScene, read.texture);
  assert.equal(local[0].uniforms.tLocalDepth, sceneBuffer.depthTexture);
  assert.equal(local[2].uniforms.uLocalValid, 0);
  assert.equal(agx.uniforms.tLocalMap.value, local[2].target.texture);
  assert.equal(agx.uniforms.tLocalGlobal.value, exposure.texture); // reference is the every-frame glide, not the intermittent target
  const firstMap = agx.uniforms.tLocalMap.value;
  draw(); assert.equal(draws.length, 5); // global glide + 3 local draws + existing output, between meter ticks
  assert.equal(draws[3].uniforms.uLocalValid, 1); assert.equal(draws[3].uniforms.tLocalPrevious, firstMap);
  assert.notEqual(agx.uniforms.tLocalMap.value, firstMap);
  // Camera motion supplies the previous view/projection; teleport rejects stale local history without resetting global EV.
  camera.position.x = 0.1; camera.updateMatrixWorld(); draw();
  assert.equal(draws[3].uniforms.uLocalPrevView.elements[12], 0);
  camera.position.x = 4; camera.updateMatrixWorld(); draw();
  assert.equal(draws[3].uniforms.uValid, 1); assert.equal(draws[6].uniforms.uLocalValid, 0);
  assert.equal(draws[3].uniforms.uFast, 1);
  // Quality switches cost no local draws on mobile and resume safely when returning to laptop.
  tier = 'mobile'; draw(); assert.equal(draws.length, 2); assert.equal(agx.uniforms.uLocalStrength.value, 0);
  tier = 'laptop'; draw(); assert.equal(draws.length, 5); assert.equal(draws[3].uniforms.uLocalValid, 0);
  // Resize and context restore invalidate reprojected history, preserving pre-output/depth ordering.
  read.setSize(1280, 720); draw(); assert.deepEqual(agx.uniforms.uLocalSize.value.toArray(), [80, 45]);
  assert.equal(draws.at(-2).uniforms.uLocalValid, 0);
  renderer.domElement.dispatchEvent({ type: 'webglcontextrestored' }); draw();
  assert.equal(draws[3].uniforms.uValid, 0); assert.equal(draws.at(-2).uniforms.uLocalValid, 0);
  // TAA uses its scene depth and jittered inverse VP, not the outer composer's stale depth.
  const taaDepth = new T.DepthTexture(640, 360), jitter = new T.Vector2(0.001, -0.002);
  lighting.taa = { resolve: { uniforms: { tDepth: { value: taaDepth }, uJitter: { value: jitter }, uInvVP: { value: new T.Matrix4() } } } };
  draw(); assert.equal(draws[1].uniforms.tLocalDepth, taaDepth);
  assert.deepEqual(draws.at(-2).uniforms.uLocalInvProjection.elements, camera.matrixWorldInverse.elements);
  assert.deepEqual(draws[1].uniforms.uLocalJitter.toArray(), jitter.toArray());
  delete lighting.taa;
  write.depthTexture = sceneBuffer.depthTexture; draw();
  assert.equal(depthCopies.length, 1); assert.equal(depthCopies[0][0], sceneBuffer.depthTexture);
  assert.equal(agx.uniforms.tLocalDepth.value, depthCopies[0][1]);
  assert.notEqual(agx.uniforms.tLocalDepth.value, write.depthTexture); // output must never sample an attached depth texture
  write.depthTexture = null;
  renderer.toneMapping = T.NeutralToneMapping; draw(); assert.equal(draws.at(-1).material, outputPass.material);
  indoor = 0; draw(5); assert.equal(outputPass.uniforms.uLocalStrength.value, 0);
  assert.ok(draws.every(d => !d.uniforms.tLocalRaw));
  let released = 0, releasedMaterials = 0;
  for (const rt of targets) rt.addEventListener('dispose', () => released++);
  for (const mat of materials) mat.addEventListener('dispose', () => releasedMaterials++);
  exposure.dispose(); exposure.dispose();
  assert.equal(released, targets.size); assert.equal(releasedMaterials, materials.size);
  assert.equal(scenePass.render, originalSceneRender);
  assert.equal(outputPass.material.fragmentShader, originalOutputShader); assert.equal(agx.fragmentShader, originalAgxShader);
  assert.equal(agx.uniforms.tLocalMap, undefined);
  // A pending material callback must not install hooks after disposal.
  const late = createBakedAutoExposure({ renderer, lighting, getSlot: () => SLOTS.noon, query: query('') });
  late.dispose(); await Promise.resolve(); assert.equal(agx.fragmentShader, originalAgxShader);
  for (const rt of [read, write, sceneBuffer]) rt.dispose();
  console.log('local adaptation: bounded contrast compression, depth/luminance edge rejection, thin-frame fallback, HDR/output order, depth capture, reprojection, TAA, mobile/outdoor bypass, resize/restore/disposal OK');
} finally { await rm(dir, { recursive: true, force: true }); }
