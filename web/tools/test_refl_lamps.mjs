// Reflection probes' lamp layers and box selection, CPU only (no fetches, WebGL, browser or GPU): the generated GLSL,
// the array layout (single slot: daylight then lamps; slots: both halves then lamps), the weights from the lamp groups'
// levels by group name, and the fallback when the layers do not match the probes.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-refl-'));
try {
  const internals = { name: 'fixture-exports', setup(b) {
    b.onLoad({ filter: /\/pets\/roam\.js$/ }, () => ({ contents: 'export const groundY = () => 0;', loader: 'js' }));
  } };
  const result = await build({ stdin: { contents: "export { reflGLSL, attachLampReflections } from './src/lightmap.js'; export { reflArray } from './src/lightmap_slots.js'; export * as THREE from 'three';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [internals] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, result.outputFiles[0].contents);
  globalThis.location = { search: '' };
  const { THREE: T, reflGLSL, attachLampReflections, reflArray } = await import(pathToFileURL(file));

  // GLSL: no lamp code without layers; with them one loop bounded by the most layers any probe has, weights packed in vec4s
  const plain = reflGLSL(27), lit = reflGLSL(27, true, false, { count: 9, max: 4 });
  assert.ok(!plain.includes('uReflLamp')); assert.ok(lit.includes('uniform vec4 uReflLampW[ 3 ];')); assert.ok(lit.includes('k < 4;'));
  assert.ok(lit.includes('uReflLampBase + float( l )') && lit.includes('uReflLampW[ l >> 2 ][ l & 3 ]'));
  for (const s of [plain, lit, reflGLSL(27, false, true)]) {
    // strictly inside a box beats the margin, the margin beats the nearest probe
    assert.ok(s.includes("inBox ? 0.0 : nearBox ? 100.0 : 1000.0")); assert.ok(s.includes('uReflMin[ i ] - 0.03'));
    assert.equal((s.match(/textureLod\( uReflTex/g) ?? []).length, (s === lit ? 3 : s.includes('uReflNext') ? 2 : 1));
  }
  assert.ok(reflGLSL(27, false, true).includes('uReflMin[ i ] - 0.03 ) ) && all( lessThanEqual( P, uReflMax[ i ] + 0.03 ) );\n    float score'));

  // fixtures: 3 probes of 2 x 1 texels; probe 0 has two lamp layers, probe 1 none, probe 2 one
  const w = 2, h = 1, layer = w * h * 4, day = () => {
    const t = new T.DataArrayTexture(new Uint16Array(layer * 3).fill(1), w, h, 3);
    Object.assign(t, { type: T.HalfFloatType, generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, wrapS: T.RepeatWrapping }); return t;
  };
  const lamps = () => ({ count: 3, max: 2, probes: 3, w, h, data: new Uint16Array(layer * 3).fill(7), range: Float32Array.from([0, 2, 2, 0, 2, 1]),
    mix: [[[0, 1]], [[1, 0.75], [2, 0.25]], [[2, 1]]] });
  const groups = () => ({ levels: Float32Array.from([1, 0, 0.5]), volumes: new Set() });
  const refl = () => ({ count: 3, key: '3', uniforms: { uReflTex: { value: day() } } });

  // one slot: a new array with the lamp layers after the daylight ones
  let r = refl(), g = groups(); attachLampReflections(r, lamps(), g, false);
  const t = r.uniforms.uReflTex.value;
  assert.equal(t.image.depth, 6); assert.equal(t.image.data[0], 1); assert.equal(t.image.data[layer * 3], 7); assert.equal(t.type, T.HalfFloatType); assert.ok(t.generateMipmaps);
  assert.equal(r.uniforms.uReflLampBase.value, 3); assert.equal(r.key, '3:3:2'); assert.deepEqual([...r.uniforms.uReflLampW.value], [1, 0.125, 0.5, 0]);
  // a switch: the weights follow the levels through the groups' refill hook
  g.levels.set([0, 1, 0]); for (const f of g.volumes) f(); assert.deepEqual([...r.uniforms.uReflLampW.value], [0, 0.75, 0, 0]);

  // slots: both halves, then the lamp layers (lightmap_slots.js)
  r = refl(); g = groups(); const src = r.uniforms.uReflTex.value; attachLampReflections(r, lamps(), g, true);
  assert.equal(r.uniforms.uReflTex.value, src, 'slot staging texture is kept'); assert.equal(r.uniforms.uReflLampBase.value, 6);
  const a = reflArray(src, 3, r.lamps); assert.equal(a.image.depth, 9); assert.equal(a.image.data[layer * 6], 7); assert.equal(a.image.data[layer * 6 - 1], 0);
  assert.deepEqual([...a.layerUpdates].sort(), [6, 7, 8], 'the first upload carries the lamp layers (a half listed later must not hide them)');
  assert.equal(reflArray(src, 3).image.depth, 6);

  // layers for another probe set or size: daylight reflections only, nothing attached
  const warn = console.warn, warnings = []; console.warn = (...m) => warnings.push(m);
  try {
    r = refl(); g = groups(); attachLampReflections(r, { ...lamps(), probes: 4 }, g, false);
    assert.equal(r.lamps, undefined); assert.equal(r.key, '3'); assert.equal(g.volumes.size, 0); assert.equal(warnings.length, 1);
  } finally { console.warn = warn; }
  console.log('reflection lamps: GLSL with/without layers, strict-box selection, single/slot array layouts, level weights and refresh, mismatch fallback OK');
} finally { await rm(dir, { recursive: true, force: true }); }
