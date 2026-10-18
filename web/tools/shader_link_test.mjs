// Links every composed baked shader in a real WebGL2 context (Playwright + Chromium; SwiftShader by default, so no GPU
// is needed, or the machine's GPU with --gpu). Not part of `npm test` (it starts a browser): for a GPU node or CI.
//
// Every reachable flag set (harness/flag_space.mjs, the same set test_shader_compose.mjs checks in node) is compiled the
// way the walk compiles it: a MeshStandardMaterial and a MeshPhysicalMaterial with clear coat, each with five surface maps,
// an environment map (PMREM, so the baked irradiance branches compile), a lightmap on the lightmapped path, lit by one
// shadow-casting directional light (PCSS), with onBeforeCompile = the composed shader and every uniform it declares
// bound to a value of its type. Per program: LINK_STATUS (with the info log on failure), and the active fragment
// samplers against the sampler plan (the plan must never count fewer; on a GPU with fewer units, --units N plans for N).
//
//   node web/tools/shader_link_test.mjs                    SwiftShader, every flag set (slow: thousands of programs)
//   node web/tools/shader_link_test.mjs --sample 300       a deterministic sample
//   node web/tools/shader_link_test.mjs --gpu              the GPU (ANGLE's default backend)
//   node web/tools/shader_link_test.mjs --units 16         plan for 16 units (Apple GPUs) whatever the device reports
//   node web/tools/shader_link_test.mjs --build-only       write the page bundle and exit (no browser)
// Writes web/tools/out/shader_link_report.json; exits 1 if any program fails to link or uses more fragment samplers than
// its plan counted. Materials whose plan is still over the units (a five-map clear-coat material on the lightmapped path
// with everything on, for example) are listed, not failed: the house has none (test_shader_golden.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const WEB = fileURLToPath(new URL('../', import.meta.url)), OUT = join(WEB, 'tools/out');
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
const sample = +(opt('--sample') ?? 0), units = +(opt('--units') ?? 0), gpu = args.includes('--gpu');

// ---- the page: three, the composer and the flag space, bundled for the browser --------------------------------------
const PAGE = `
import * as THREE from 'three';
import { compose, applyComposed } from './src/shaders/compose.js';
import { bakedFeatures, flagsKey } from './src/shaders/features.js';
import { samplerPlan, threeSamplers } from './src/shaders/sampler_plan.js';
import { enumerateFlags } from './tools/harness/flag_space.mjs';

const SAMPLER_TYPES = new Set([0x8B5E, 0x8B5F, 0x8B60, 0x8B62, 0x8DC1, 0x8DC4, 0x8DC5, 0x8DCA, 0x8DCB, 0x8DCC, 0x8DCF, 0x8DD2, 0x8DD3, 0x8DD4, 0x8DD7]);
const VERTEX_ONLY = /^(boneTexture|batchingTexture|batchingIdTexture|batchingColorTexture|morphTargetsTexture|displacementMap)\\b/;
// a value of each GLSL type a baked uniform can have (the composed text declares them; the walk binds real ones)
const tex2 = new THREE.DataTexture(new Uint8Array(4), 1, 1); tex2.needsUpdate = true;
const tex3 = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1); Object.assign(tex3, { type: THREE.HalfFloatType, format: THREE.RGBAFormat }); tex3.needsUpdate = true;
const texA = new THREE.DataArrayTexture(new Uint16Array(4), 1, 1, 1); Object.assign(texA, { type: THREE.HalfFloatType, format: THREE.RGBAFormat }); texA.needsUpdate = true;
const scalar = { float: () => 0, int: () => 0, vec2: () => new THREE.Vector2(), vec3: () => new THREE.Vector3(), vec4: () => new THREE.Vector4(), mat3: () => new THREE.Matrix3(), mat4: () => new THREE.Matrix4(),
  sampler2D: () => tex2, sampler3D: () => tex3, sampler2DArray: () => texA };
const flat = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
function bindDeclared(sh) {
  const re = /uniform\\s+(?:(?:highp|mediump|lowp)\\s+)?(\\w+)\\s+([^;]+);/g;
  for (const [, type, names] of (sh.vertexShader + '\n' + sh.fragmentShader).matchAll(re)) for (const decl of names.split(',')) {
    const m = /(\\w+)\\s*(?:\\[\\s*(\\w+)\\s*\\])?/.exec(decl.trim()); if (!m || sh.uniforms[m[1]] || !scalar[type]) continue;
    let n = m[2]; if (n && !/^\\d+$/.test(n)) n = +(new RegExp('#define\\\\s+' + n + '\\\\s+(\\\\d+)').exec(sh.fragmentShader)?.[1] ?? 1);
    sh.uniforms[m[1]] = { value: n ? (flat[type] ? new Float32Array(+n * flat[type]) : Array.from({ length: +n }, scalar[type])) : scalar[type]() };
  }
}
window.runLinkTest = async ({ sample = 0, units = 0 } = {}) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas }); renderer.shadowMap.enabled = true;
  const gl = renderer.getContext(), limit = units || renderer.capabilities.maxTextures;
  const env = new THREE.PMREMGenerator(renderer).fromScene(new THREE.Scene()).texture;
  const map = () => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); t.needsUpdate = true; return t; };
  let flags = [...enumerateFlags({ bakedFeatures, samplerPlan }).values()];
  if (sample) { const step = flags.length / sample; flags = Array.from({ length: Math.min(sample, flags.length) }, (_, i) => flags[Math.floor(i * step)]); }
  const report = { device: { renderer: gl.getParameter(gl.RENDERER), maxTextures: renderer.capabilities.maxTextures, limit }, programs: 0, failed: [], overPlan: [], over: [], maxSamplers: 0 };
  const sun = new THREE.DirectionalLight(); sun.castShadow = true;
  const camera = new THREE.PerspectiveCamera(); camera.position.z = 3;
  const geometry = new THREE.BoxGeometry(); geometry.setAttribute('uv1', geometry.attributes.uv);
  for (let i = 0; i < flags.length; i += 40) {
    const scene = new THREE.Scene(); scene.add(sun, sun.target); const batch = [];
    for (const f of flags.slice(i, i + 40)) for (const physical of [false, true]) {
      const m = physical ? new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatMap: map(), clearcoatRoughnessMap: map() }) : new THREE.MeshStandardMaterial();
      Object.assign(m, { map: map(), normalMap: map(), roughnessMap: map(), metalnessMap: map(), aoMap: map(), envMap: env });
      if (f.path === 'lightmap') m.lightMap = map();
      const plan = samplerPlan({ ...f, threeSamplers: threeSamplers(m, { envMap: !f.diffuse }) }, limit), c = compose(plan.flags);
      m.onBeforeCompile = sh => { applyComposed(sh, c); bindDeclared(sh); };
      m.customProgramCacheKey = () => c.key + (physical ? '|physical' : '');
      const mesh = new THREE.Mesh(geometry, m); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
      batch.push({ m, plan, key: flagsKey(plan.flags) + (physical ? ' physical' : '') });
    }
    await renderer.compileAsync(scene, camera);
    for (const b of batch) {
      const p = renderer.properties.get(b.m).currentProgram; report.programs++;
      if (!p || !gl.getProgramParameter(p.program, gl.LINK_STATUS)) { report.failed.push({ key: b.key, log: p ? (gl.getProgramInfoLog(p.program) || '') + (gl.getShaderInfoLog(p.fragmentShader) || '') : 'no program' }); continue; }
      let n = 0;
      for (let u = 0, count = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS); u < count; u++) { const a = gl.getActiveUniform(p.program, u); if (a && SAMPLER_TYPES.has(a.type) && !VERTEX_ONLY.test(a.name)) n += a.size; }
      report.maxSamplers = Math.max(report.maxSamplers, n);
      if (n > b.plan.count) report.overPlan.push({ key: b.key, active: n, plan: b.plan.count });
      if (n > limit) report.over.push({ key: b.key, active: n, limit });
    }
    for (const b of batch) b.m.dispose();
  }
  return report;
};
`;
const bundle = await build({ stdin: { contents: PAGE, resolveDir: WEB }, bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' });
mkdirSync(OUT, { recursive: true });
const pageFile = join(OUT, 'shader_link_page.js');
writeFileSync(pageFile, bundle.outputFiles[0].text);
if (args.includes('--build-only')) { console.log('page bundle written:', pageFile); process.exit(0); }

// ---- the browser --------------------------------------------------------------------------------------------------
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, args: gpu ? ['--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('page:', m.text()); });
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: pageFile, type: 'module' });
  await page.waitForFunction(() => typeof window.runLinkTest === 'function');
  const t0 = Date.now(), report = await page.evaluate(o => window.runLinkTest(o), { sample, units });
  report.seconds = Math.round((Date.now() - t0) / 1000);
  writeFileSync(join(OUT, 'shader_link_report.json'), JSON.stringify(report, null, 1));
  console.log(`${report.device.renderer}: ${report.programs} programs, ${report.failed.length} failed to link, ${report.overPlan.length} above their sampler plan, ${report.over.length} over ${report.device.limit} units; at most ${report.maxSamplers} fragment samplers (${report.seconds} s)`);
  for (const f of report.failed.slice(0, 5)) console.log('FAIL', f.key, '\n', f.log.slice(0, 800));
  process.exitCode = report.failed.length || report.overPlan.length ? 1 : 0;
} finally { await browser.close(); }
