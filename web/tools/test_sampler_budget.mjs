// Fragment sampler budget (Apple GPUs: 16 texture units per fragment shader). Browser-free; no GPU.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

globalThis.location = { search: '' };
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {} }, configurable: true });
const dir = await mkdtemp(join(tmpdir(), 'croton-samplers-'));
try {
  const built = await build({ stdin: { contents: "export * from './src/sampler_budget.js'; export { contactPatch } from './src/contact.js'; export { patchPuddleReflection } from './src/puddles.js'; export * as THREE from 'three';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const { fragmentSamplers, fitSamplers, contactPatch, patchPuddleReflection, THREE } = await import(pathToFileURL(file));
  const standard = (params = {}) => ({ uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, shaderID: 'physical', ...params });

  // three's samplers from the parameters (dfgLUT, maps, shadows; envMap only while an IBL call remains), custom ones
  // when declared and referenced, arrays by their size; the template's own declarations are not counted twice
  assert.equal(fragmentSamplers(standard()), 1);
  assert.equal(fragmentSamplers(standard({ map: true, normalMap: true, roughnessMap: true, aoMap: true, envMap: true, shadowMapEnabled: true, numDirLightShadows: 1 })), 7);
  const custom = standard();
  custom.fragmentShader = 'uniform highp sampler3D uA; uniform sampler2D uUnused; uniform highp sampler2DArray uB[ 2 ];\n' + custom.fragmentShader.replace('void main() {', 'void main() { vec4 t = texture( uA, vec3( 0.0 ) ) + texture( uB[ 1 ], vec3( 0.0 ) );');
  assert.equal(fragmentSamplers(custom), 4);
  const noIBL = standard({ envMap: true }); noIBL.fragmentShader = noIBL.fragmentShader.replace('#include <lights_fragment_maps>', '');
  assert.equal(fragmentSamplers(noIBL), 1);

  // drop order: pending features add to the count, and the first ones go first; one warning per material and outcome
  const warnings = [], warn = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const material = new THREE.MeshStandardMaterial(); material.name = 'teak';
    const sh = standard({ map: true, normalMap: true, roughnessMap: true, aoMap: true });   // 5
    const renderer = { capabilities: { maxTextures: 7 } };
    const features = () => [{ name: 'planar puddle', cost: 1 }, { name: 'contact sun', cost: 2 }, { name: 'slot crossfade', cost: 1, pending: false }];
    assert.deepEqual([...fitSamplers(sh, renderer, material, features())], ['planar puddle']); assert.equal(sh.samplerCount, 7);
    assert.deepEqual([...fitSamplers(sh, { capabilities: { maxTextures: 5 } }, material, features())], ['planar puddle', 'contact sun']);
    assert.deepEqual([...fitSamplers(sh, { capabilities: { maxTextures: 4 } }, material, features())], ['planar puddle', 'contact sun', 'slot crossfade']);
    assert.deepEqual([...fitSamplers(sh, { capabilities: { maxTextures: 16 } }, material, features())], []);
    material.userData.samplerCut = 9;   // after a failed link: the audit lowers this material's limit
    assert.ok(fitSamplers(sh, { capabilities: { maxTextures: 16 } }, material, features()).has('planar puddle'));
    assert.equal(warnings.length, 3); assert.match(warnings[0], /"teak": 8 fragment samplers > 7 texture units; dropped planar puddle$/);   // the repeat is not warned again

    // contact without its sun: no samplers, the moving AO stays, and a later wrapper cannot add the sun back
    const probe = standard(); probe.fragmentShader = probe.fragmentShader.replace('#include <lights_fragment_maps>', 'irradiance += probeIrradiance( vProbeWorld, n );');
    const before = fragmentSamplers(probe);
    contactPatch(probe, false, false);
    assert.equal(fragmentSamplers(probe), before); assert.ok(probe.fragmentShader.includes('contactAO(') && !probe.fragmentShader.includes('uContactDepth'));
    contactPatch(probe, false); assert.ok(!probe.fragmentShader.includes('uContactDepth'));
    const sun = standard(); sun.fragmentShader = sun.fragmentShader.replace('#include <lights_fragment_maps>', 'irradiance += probeIrradiance( vProbeWorld, n );');
    contactPatch(sun, false); assert.equal(fragmentSamplers(sun), before + 2);

    // planar puddle: never where the baked hook left it out, nor past the limit
    const wet = () => { const s = standard(); s.fragmentShader = s.fragmentShader.replace('void main() {', 'void main() { float wetPuddle = 0.0;'); return s; };
    assert.equal(patchPuddleReflection(Object.assign(wet(), { noPlanarPuddle: true }), {}), false);
    warnings.length = 0; material.name = 'paving';
    assert.equal(patchPuddleReflection(wet(), {}, { capabilities: { maxTextures: 1 } }, material), false); assert.match(warnings[0], /dropped planar puddle/);
    material.userData.samplerCut = 0;
    const ok = wet(); assert.equal(patchPuddleReflection(ok, { uPuddleTex: { value: null } }, { capabilities: { maxTextures: 16 } }, material), true);
    assert.equal(fragmentSamplers(ok), 2);
  } finally { console.warn = warn; }
  console.log('sampler budget: parameter/custom counts, inactive declarations, drop order, failed-link cut, sunless contact, puddle gating OK');
} finally { await rm(dir, { recursive: true, force: true }); }
