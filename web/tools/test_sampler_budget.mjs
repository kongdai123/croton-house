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
  const built = await build({ stdin: { contents: "export * from './src/sampler_budget.js'; export * from './src/shaders/sampler_plan.js'; export { compose, applyComposed } from './src/shaders/compose.js'; export { bakedFeatures } from './src/shaders/features.js'; export * as THREE from 'three';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const { fragmentSamplers, samplerPlan, threeSamplers, bakedSamplers, compose, applyComposed, bakedFeatures, THREE } = await import(pathToFileURL(file));
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

  // the plan: optional features leave in a fixed order (planar puddle, contact sun, slot crossfade) while over
  const teak = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture(), aoMap: new THREE.Texture() });
  assert.equal(threeSamplers(teak), 7);   // 4 maps, dfgLUT, the environment, the sun's shadow
  const flags = { ...bakedFeatures({ wet: 'auto' }, { probeSide: 'none' }, { path: 'probe', multi: true, contact: { steps: 8, max: 16 }, refl: { count: 2, slots: true }, planarPuddle: true }), threeSamplers: 7 };
  assert.equal(bakedSamplers(flags), 1 + 2 + 1 + 2 + 1);   // uSunDepth, uProbeSH + next, uReflTex, contact 2, puddle
  const at = n => samplerPlan(flags, n);
  assert.deepEqual(at(16).dropped, []); assert.equal(at(16).count, 14);
  assert.deepEqual(at(13).dropped, ['planar puddle']); assert.equal(at(13).count, 13);
  assert.deepEqual(at(11).dropped, ['planar puddle', 'contact sun']); assert.equal(at(11).count, 11);
  assert.deepEqual(at(10).dropped, ['planar puddle', 'contact sun', 'slot crossfade']); assert.equal(at(10).over, false);
  assert.equal(at(9).over, true); assert.equal(at(9).start, 14);
  assert.equal(at(10).flags.planarPuddle || at(10).flags.contactSun || at(10).flags.slotFade, false);
  // the lightmapped crossfade costs 1 with the lamp-group array (one sampler for every group), 2 with the shared layer
  const lm = groups => ({ ...bakedFeatures({}, { weather: null }, { path: 'lightmap', multi: true, lampGroups: groups }), threeSamplers: 0 });
  assert.equal(bakedSamplers(lm(5)) - bakedSamplers({ ...lm(5), slotFade: false }), 1);
  assert.equal(bakedSamplers(lm(0)) - bakedSamplers({ ...lm(0), slotFade: false }), 2);

  // the plan's count is what the generated shader uses (three's parameters for a textured Standard material)
  for (const f of [flags, at(13).flags, at(11).flags, at(10).flags, lm(5), lm(0)]) {
    const params = { map: true, normalMap: true, roughnessMap: true, aoMap: true, envMap: true, shadowMapEnabled: true, numDirLightShadows: 1, lightMap: f.path === 'lightmap' };
    const sh = applyComposed(standard(params), compose(f));
    assert.equal(fragmentSamplers(sh), 7 + (f.path === 'lightmap' ? 1 : 0) + bakedSamplers(f), JSON.stringify(f));
  }
  console.log('sampler budget: parameter/custom counts, inactive declarations, the plan\'s drop order and its agreement with the generated text OK');
} finally { await rm(dir, { recursive: true, force: true }); }
