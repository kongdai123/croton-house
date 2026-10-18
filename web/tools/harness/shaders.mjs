// Shader characterisation of the baked lighting on the real house (harness/baked.mjs): every material the walk can draw
// (the scene, the mirrors' reflected scenes, the puddle reflection, the sun-depth casters) compiled through its
// onBeforeCompile with representative program parameters (its maps, an environment map, one shadowed sun), as three
// would call it. Per material class: its cache key, the generated vertex / fragment text (after every hook, includes
// left as three hands them over), the text resolved against three's ShaderChunk, and the fragment samplers it uses.
//
//   const cap = await captureShaders();   // { classes, programs, texts, variants }
import { createHash } from 'node:crypto';
import { buildBakedScene } from './baked.mjs';

const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const MAPS = ['map', 'matcap', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'emissiveMap', 'metalnessMap', 'roughnessMap', 'anisotropyMap', 'clearcoatMap',
  'clearcoatNormalMap', 'clearcoatRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularMap',
  'specularColorMap', 'specularIntensityMap', 'transmissionMap', 'thicknessMap', 'gradientMap', 'lightMap', 'displacementMap'];

// three's include resolution (WebGLProgram resolveIncludes), recursive; an unknown chunk is left in place and reported.
export function resolveIncludes(T, src, missing = new Set()) {
  return src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (line, name) => {
    const chunk = T.ShaderChunk[name];
    if (chunk === undefined) { missing.add(name); return line; }
    return resolveIncludes(T, chunk, missing);
  });
}

// Names used before they are declared (GLSL needs the declaration first): every uniform, varying, attribute, #define,
// struct and function the text declares that three's stock text does not, against its first use (comments stripped).
export function usedBeforeDeclared(src, stock = new Set()) {
  const s = src.replace(/\/\/[^\n]*/g, ''), out = [], seen = new Set();
  const decl = /(?:^|[;{}\n])\s*(?:(?:uniform|varying|attribute)\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)|#define\s+(\w+)|struct\s+(\w+)|(?:const\s+)?\w+\s+(\w+)\s*\([^;{}()]*(?:\([^()]*\)[^;{}()]*)*\)\s*\{)/g;
  for (const m of s.matchAll(decl)) {
    const name = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!name || seen.has(name) || stock.has(name) || ['main', 'if', 'for', 'while', 'return', 'else'].includes(name)) continue;
    seen.add(name);
    // the first use outside preprocessor lines (a macro is tested or expands to a name before either is defined)
    const re = new RegExp(`\\b${name}\\b`, 'g'); let first = -1;
    for (const u of s.matchAll(re)) if (u.index >= m.index || !/^\s*#/.test(s.slice(s.lastIndexOf('\n', u.index) + 1, u.index))) { first = u.index; break; }
    if (first >= 0 && first < m.index) out.push(name);
  }
  return out;
}
// what three's own templates declare (resolved), per stage
const STOCK = new Map();
export function stockNames(T, stage) {
  if (!STOCK.has(stage)) {
    const names = new Set();
    for (const lib of ['standard', 'physical', 'depth']) {
      const src = resolveIncludes(T, T.ShaderLib[lib][stage + 'Shader']).replace(/\/\/[^\n]*/g, '');
      for (const m of src.matchAll(/\b(\w+)\b/g)) names.add(m[1]);
    }
    STOCK.set(stage, names);
  }
  return STOCK.get(stage);
}

// The parameters three hands onBeforeCompile for this material (the parts the hooks and the sampler budget read).
export function programParams(T, m, { envMap = true } = {}) {
  const lib = m.isMeshDepthMaterial ? T.ShaderLib.depth : m.isMeshPhysicalMaterial ? T.ShaderLib.physical : T.ShaderLib.standard;
  const p = { uniforms: T.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader,
    shaderID: m.isMeshDepthMaterial ? 'depth' : 'physical', shadowMapEnabled: true, numDirLightShadows: 1 };
  for (const k of MAPS) p[k] = !!m[k];
  if (!m.isMeshDepthMaterial) { p.envMap = envMap; p.transmission = m.transmission > 0; }
  return p;
}

// The class a material belongs to, from what it is (its records and where it is drawn), not from its shader text, so a
// class keeps its name while the shader that draws it changes.
function classOf(w, m, mesh, container, compiled) {
  const L = w.roles.lightingOf(m), R = mesh ? w.roles.meshLighting(mesh) : null;
  const path = m.isMeshDepthMaterial ? 'depth' : m.lightMap ? 'lightmap' : m.userData.probeLit ? 'probe' : 'stock';
  const tags = [];
  if (m.isMeshPhysicalMaterial) tags.push('physical');
  if (m.clearcoat > 0) tags.push('clearcoat');
  if (m.transmission > 0) tags.push('transmission');
  if (m.foliageBake) tags.push('foliageBake');
  if (L?.twoSided) tags.push('leafSide');
  if (L?.wet === 'auto') tags.push('wet');
  if (L?.reflection === 'mirror') tags.push('mirror');
  if (L?.sheer) tags.push('sheer');
  if (R?.probeSide === 'face' && path === 'probe' && !m.transparent && !(m.transmission > 0)) tags.push('face');
  if (m.userData.planarPuddle || w.materialOptions?.(m).planarPuddle) tags.push('planarPuddle');
  if (compiled.uniforms.uContactCaster?.value === 1) tags.push('caster');
  if (R?.weather) tags.push('weather-' + R.weather);
  return [container, path, R?.role ?? '-', L?.surface ?? '-', ...tags].join('/');
}

// variants: the shipped bake (lamp groups, four slots), the shared lamps layer, one slot; `tight` recompiles the shipped
// scene's materials for a GPU with fewer texture units, so the sampler budget's drops are characterised too.
export const VARIANTS = [{ name: 'groups-slots', groups: true, slots: true }, { name: 'shared-slots', groups: false, slots: true },
  { name: 'groups-single', groups: true, slots: false }, { name: 'tight11', groups: true, slots: true, maxTextures: 11 }];
export async function captureShaders({ variants = VARIANTS } = {}) {
  const classes = {}, keyOf = {}, texts = {}, summary = {};
  for (const v of variants) {
    const b = await buildBakedScene(v), { world: w, baked } = b, T = w.T;
    const renderer = v.maxTextures ? { ...b.renderer, capabilities: { ...b.renderer.capabilities, maxTextures: v.maxTextures } } : b.renderer;
    const seen = new Map();   // material -> first mesh drawing it, and where
    const add = (m, mesh, container) => { if (m && !seen.has(m)) seen.set(m, { mesh, container }); };
    w.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) add(m, o, 'scene'); });
    for (const r of b.mirrors) r.userData.reflection?.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) add(m, o, 'mirror'); });
    for (const e of baked.puddleRefl?.sources ?? []) for (const m of [].concat(e.proxy.material)) add(m, e.source, 'puddle');
    for (const e of baked.sunShadow.depthEntries()) add(e.material, e.object, 'depth');
    const warn = console.warn, warnings = []; console.warn = (...a) => warnings.push(a.map(String).join(' '));
    let compiled = 0, dropped = 0;
    try {
      for (const [m, { mesh, container }] of seen) {
        if (!m.isMeshStandardMaterial && !(m.isMeshDepthMaterial && container === 'depth')) continue;
        const sh = programParams(T, m);
        m.onBeforeCompile(sh, renderer); compiled++;
        const key = m.customProgramCacheKey(), cls = classOf(w, m, mesh, container, sh);
        const missing = new Set(), resolved = resolveIncludes(T, sh.vertexShader, missing) + '\n//--\n' + resolveIncludes(T, sh.fragmentShader, missing);
        const vh = sha(sh.vertexShader), fh = sha(sh.fragmentShader);
        texts[vh] ??= sh.vertexShader; texts[fh] ??= sh.fragmentShader;
        const name = `${v.name}:${cls}`, samplers = m.isMeshDepthMaterial ? 0 : w.samplerBudget.fragmentSamplers(sh);
        const c = classes[name] ??= { vertex: vh, fragment: fh, resolved: sha(resolved), samplers, materials: 0 };
        c.materials++; c.samplers = Math.max(c.samplers, samplers);
        if (c.vertex !== vh || c.fragment !== fh) (c.variants ??= []).includes(fh) || c.variants.push(fh);   // one class, several texts (own hooks)
        if (missing.size) c.missing = [...missing].sort();
        // the sampler plan (counted from the flags before generating) must never count fewer than the generated text uses
        // (more is conservative: the puddle reflection's diffuse copies lose their environment map)
        if (sh.composed && sh.samplerCount < samplers) c.planMiss = [sh.samplerCount, samplers];
        // what the sampler plan left out (the generated text shows it too)
        if (sh.samplerDropped?.length) { dropped++; c.dropped = [...new Set([...(c.dropped ?? []), ...sh.samplerDropped])].sort(); }
        const [rv, rf] = resolved.split('\n//--\n');
        const early = usedBeforeDeclared(rf, stockNames(T, 'fragment')).concat(usedBeforeDeclared(rv, stockNames(T, 'vertex')));
        if (early.length) c.usedBeforeDeclared = early.sort();
        (keyOf[name] ??= new Set()).add(`${v.name}:${key}`);
        // one key (with the parameters three adds to it) must never stand for two texts
        const program = v.name + key + MAPS.map(k => +!!sh[k]).join('') + sh.shaderID + !!sh.transmission;
        if (!(program in keyText)) keyText[program] = vh + fh; else if (keyText[program] !== vh + fh) c.unstableKey = true;
      }
    } finally { console.warn = warn; }
    summary[v.name] = { materials: compiled, dropped };
  }
  // programs: classes sharing a cache key share a program, named after the first such class (in class order), so the
  // golden records which classes three would draw with one program, whatever the keys look like
  const programs = new Map();
  for (const name of Object.keys(classes).sort()) {
    const ids = [...keyOf[name]].map(k => programs.get(k)).filter(x => x !== undefined).sort();
    const id = ids[0] ?? name;
    for (const k of keyOf[name]) programs.set(k, id);
    classes[name].program = id === name ? '=' : id;
  }
  return { classes: Object.fromEntries(Object.keys(classes).sort().map(k => [k, classes[k]])), texts, summary };
}
const keyText = {};
