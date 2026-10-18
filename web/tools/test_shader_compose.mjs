// Every reachable flag set of the composed baked shader (harness/flag_space.mjs) through compose(), in node: applied to
// three's Standard and Physical templates (and, with wet ground, to a leaf hook's template whose normal chunk is
// expanded), resolved against three's ShaderChunk. Per combination: every site found once, no include left unresolved,
// no declaration twice, nothing used before its declaration, the sampler plan's count equal to what the generated text
// uses (and within 16 units after the plan for a five-map material); across combinations: one cache key per distinct
// flag set and one text per key. No browser, no GPU (shader_link_test.mjs links them in WebGL2).
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { enumerateFlags } from './harness/flag_space.mjs';
import { resolveIncludes, usedBeforeDeclared, stockNames } from './harness/shaders.mjs';

globalThis.location = { search: '' };
const dir = await mkdtemp(join(tmpdir(), 'croton-compose-'));
try {
  const built = await build({ stdin: { contents: `export { compose, applyComposed } from './src/shaders/compose.js'; export { bakedFeatures, flagsKey, FLAG_DEFAULTS } from './src/shaders/features.js';
    export { samplerPlan, bakedSamplers } from './src/shaders/sampler_plan.js'; export { fragmentSamplers } from './src/sampler_budget.js'; export * as THREE from 'three';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const { compose, applyComposed, bakedFeatures, flagsKey, FLAG_DEFAULTS, samplerPlan, bakedSamplers, fragmentSamplers, THREE: T } = await import(pathToFileURL(file));
  const all = enumerateFlags({ bakedFeatures, samplerPlan });
  const lib = { standard: T.ShaderLib.standard, physical: T.ShaderLib.physical };
  // a leaf / blade hook expands normal_fragment_begin (plants_parts.js, grass.js): the wet mask's other site
  const leaf = { vertexShader: lib.standard.vertexShader, fragmentShader: lib.standard.fragmentShader.replace('#include <normal_fragment_begin>', T.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '')) };
  // a textured material's program parameters: map, normal, roughness, metalness, AO (+ dfgLUT, environment, shadow = 8)
  const params = f => ({ shaderID: 'physical', map: true, normalMap: true, roughnessMap: true, metalnessMap: true, aoMap: true, envMap: !f.diffuse, shadowMapEnabled: true, numDirLightShadows: 1, lightMap: f.path === 'lightmap' });
  const fStock = stockNames(T, 'fragment'), vStock = stockNames(T, 'vertex');
  // top-level declarations of the baked text (uniforms, varyings, attributes, functions by signature)
  const declarations = src => {
    const s = src.replace(/\/\/[^\n]*/g, ''), out = [];
    for (const m of s.matchAll(/(?:^|[;}\n])\s*(?:uniform|varying|attribute)\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)/g)) out.push('var ' + m[1]);
    for (const m of s.matchAll(/(?:^|[;}\n])\s*(\w+)\s+(\w+)\s*\(([^;{}()]*)\)\s*\{/g)) if (!['if', 'for', 'while', 'else', 'return'].includes(m[1])) out.push(`fn ${m[2]}(${m[3].replace(/\s+/g, ' ').replace(/\b(in|out|inout|const|highp|mediump|lowp)\s+/g, '').replace(/\s*\w+\s*(,|$)/g, '$1')})`);
    return out;
  };
  const keys = new Map(), texts = new Map(); let applied = 0, over = 0;
  for (const [id, f] of all) {
    const key = flagsKey(f);
    // one key per distinct flag set (flags compared whole)
    if (keys.has(key)) assert.equal(keys.get(key), id, `two flag sets, one key: ${key}`); else keys.set(key, id);
    const c = compose(f);
    assert.equal(c.key, key); assert.equal(compose(f), c);   // memoised, deterministic
    for (const [name, tpl] of [...Object.entries(lib), ...(f.wet ? [['leaf', leaf]] : [])]) {
      const sh = applyComposed({ uniforms: {}, vertexShader: tpl.vertexShader, fragmentShader: tpl.fragmentShader }, c); applied++;
      const text = sh.vertexShader + '\n//--\n' + sh.fragmentShader;
      const k = key + '|' + name;
      if (texts.has(k)) assert.equal(texts.get(k), text, `one key, two texts: ${k}`); else texts.set(k, text);
      const missing = new Set(), rv = resolveIncludes(T, sh.vertexShader, missing), rf = resolveIncludes(T, sh.fragmentShader, missing);
      assert.equal(missing.size, 0, `unresolved includes ${[...missing]} in ${key}`);
      assert.ok(!/#include\s*</.test(rv + rf), `an include left in ${key}`);
      for (const [stage, src, stock] of [['fragment', rf, fStock], ['vertex', rv, vStock]]) {
        const own = declarations(src).filter(d => !stock.has(d.replace(/^(var|fn) /, '').replace(/\(.*$/, '')));
        const twice = own.filter((d, i) => own.indexOf(d) !== i);
        assert.deepEqual(twice, [], `declared twice in the ${stage} of ${key} (${name})`);
        assert.deepEqual(usedBeforeDeclared(src, stock), [], `used before declared in the ${stage} of ${key} (${name})`);
      }
      if (name === 'standard') {
        // the plan counts what the text uses (three's eight here plus the baked shader's own)
        assert.equal(fragmentSamplers({ ...sh, ...params(f) }), 8 - (f.diffuse ? 1 : 0) + (f.path === 'lightmap' ? 1 : 0) + bakedSamplers(f), `sampler count of ${key}`);
        const plan = samplerPlan({ ...f, threeSamplers: 8 - (f.diffuse ? 1 : 0) + (f.path === 'lightmap' ? 1 : 0) }, 16);
        if (plan.over) over++;
        else assert.ok(plan.count <= 16);
      }
    }
  }
  assert.equal(over, 0, `${over} combinations over 16 units after the plan`);
  // every flag a composition can carry is exercised both ways
  for (const k of Object.keys(FLAG_DEFAULTS)) if (typeof FLAG_DEFAULTS[k] === 'boolean') for (const v of [false, true]) assert.ok([...all.values()].some(f => f[k] === v), `${k} = ${v} never composed`);
  console.log(`shader compose: ${all.size} flag sets (${keys.size} keys), ${applied} compositions: sites, includes, declarations, order, samplers, keys OK`);
} finally { await rm(dir, { recursive: true, force: true }); }
