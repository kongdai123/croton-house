// Default baked lighting: indirect light computed offline in Blender Cycles,
// drawn live as lightmaps. The sun's direct light and shadows stay real-time; everything else that the walkthrough
// fakes (window fill lights, the daylight volume, the room bounce, the hemisphere light, the lamp rectangles) is
// replaced by the bake.
//
// Data (made by the bake pipeline in bake/, see bake/README.md):
//   lightmap_uv.bin : for each static mesh ("unit"), the lightmap re-indexing: new vertex -> original vertex (xref),
//                     the new triangle list (same triangles, same order, so material groups still apply) and
//                     normalised 16-bit lightmap UVs. Units are matched to the live meshes by the stable id batch.js
//                     gives every mesh that holds still (carried into the export); sidecars without ids, and any id that
//                     misses, fall back to the original vertex count and world bounding box.
//   <slot>/sky.hdr, sunind.hdr, lamps.hdr : the three layers. Sky = sky light and its bounces; sunind = the sun's
//                     bounces only; lamps = the lamps at unit level, direct and bounced. Summed here on the GPU.
// The bakes hold Cycles' diffuse light without colour (radiance / albedo = irradiance / PI), hence the PI below.
import * as THREE from 'three';
import { warmPrograms, shaderYield } from './shader_warmup.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CONTACT, contactPatch } from './contact.js';
import { blenderAgX, loadAgXLuts } from './agx.js';
import { createBakedAutoExposure } from './auto_exposure.js';
import { createPuddles } from './puddles.js';
import { bakeFoliage, loadFoliage, shaderReplace as rep, shaderPatch, shaderKey, shaderPatchCount, assertShaderPatches } from './foliage_bake.js';
import { lightmapAssets, lightmapBitmap } from './lightmap_assets.js';
import { SLOTS, discoverSlots, initialSlot, nextSlot, validEncoding } from './lighting_slots.js';
import { createSlotRuntime } from './lightmap_slots.js';
import { createLampGroups, lampGroupGLSL, lampGroupsWanted, loadGroupProbes, validGroupEncoding } from './lamp_groups.js';
import { createSlotProgress } from './slot_progress.js';
import { TIERS } from './tier.js';
import { bakedResolution } from './baked_mode.js';
import { sheerProbePatch, emitsLight } from './materials.js';
import { auditPrograms, fitSamplers } from './sampler_budget.js';
import housePlan from '../data/house.json';

// The bake's sun (scripts/make_tasks.py, slot "sunrise"): bearing, height, strength (W/m2 = irradiance) and colour.
export { SLOTS } from './lighting_slots.js';

// After rain, outdoors (the same rules as the Blender scene, scripts setup.py): ground darker and glossy with puddles
// where a world-space noise dips, plants with a little sheen, outdoor furniture slightly darker and smoother.
function insidePlan(x, y) { const f = x < -3.5 || x > 3.97 ? -5.94 : -4.82; return x >= -8.1 && x <= 8.1 && y >= f && y <= 5.62; }
function weatherClass(box, m) {
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  if (insidePlan(cx, -cz) || box.max.x - box.min.x > 40 || box.max.z - box.min.z > 40) return null;
  if (/^garden-/.test(m.name || '') || m.alphaTest > 0) return 'plant';
  return box.max.y < 0.35 ? 'ground' : 'outdoor';
}
// per-pixel wet ground and puddles for any lit material (world position, up-facing, low, outside the house)
function wetPatch(sh, wet) {
  sh.uniforms.uWet = { value: wet };
  sh.vertexShader = 'varying vec3 vWetWorld;\n' + rep(sh.vertexShader, '#include <project_vertex>', `#include <project_vertex>
    vec4 wetPosition = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      wetPosition = batchingMatrix * wetPosition;
    #endif
    #ifdef USE_INSTANCING
      wetPosition = instanceMatrix * wetPosition;
    #endif
    vWetWorld = ( modelMatrix * wetPosition ).xyz;`, 'wet vertex');
  const normal = sh.fragmentShader.includes('#include <normal_fragment_begin>') ? '#include <normal_fragment_begin>' : 'vec3 nonPerturbedNormal = normal;';
  sh.fragmentShader = rep(sh.fragmentShader, normal, normal + '\nfloat wetMask = wetGround( inverseTransformDirection( normal, viewMatrix ) ); float wetPuddle = wetMask * puddle();', 'wet normal');
  sh.fragmentShader = PUDDLE_GLSL + rep(sh.fragmentShader, '#include <lights_physical_fragment>', 'diffuseColor.rgb *= mix( 1.0, 0.62, wetMask ) * mix( 1.0, 0.55, wetPuddle ); roughnessFactor = mix( roughnessFactor, max( 0.06, roughnessFactor * 0.3 ), wetMask ); roughnessFactor = mix( roughnessFactor, 0.03, wetPuddle );\n#include <lights_physical_fragment>', 'wet physical');
}
// contact.js is shared with the live pass. Validate its replacement sites before invoking its baked hook.
function checkedContact(sh, baked, sun = true) {
  if (sh.uniforms.uContactDepth) return;
  const check = (src, token, name) => rep(src, token, token, 'contact ' + name);
  check(sh.fragmentShader, 'getDirectionalLightInfo( directionalLight, directLight );', 'sun');
  if (baked) {
    check(sh.vertexShader, '#include <project_vertex>', 'vertex');
    check(sh.fragmentShader, 'irradiance += lightMapIrradiance;', 'irradiance');
  } else if (sh.fragmentShader.includes('irradiance += probeIrradiance( vProbeWorld,')) check(sh.fragmentShader, 'irradiance += probeIrradiance( vProbeWorld,', 'probe');
  contactPatch(sh, baked, sun);
}
// Optional features, in the order they are left out when a material would exceed the GPU's fragment texture units
// (sampler_budget.js; 16 on Apple GPUs). puddles.js marks the materials it will give a planar puddle reflection.
// The reflection probes' next-slot blend and the contact AO cost no sampler (one array, uniforms) and always stay.
const planarPuddle = (s, m) => ({ name: 'planar puddle', cost: m.userData.planarPuddle && s.fragmentShader.includes('float wetPuddle =') ? 1 : 0 });
const contactSun = s => ({ name: 'contact sun', cost: CONTACT && !s.uniforms.uContactDepth ? 2 : 0 });
function fitBaked(s, renderer, m, crossfade) {
  const drop = fitSamplers(s, renderer, m, [planarPuddle(s, m), contactSun(s), crossfade]);
  if (drop.has('planar puddle')) s.noPlanarPuddle = true;
  return drop;
}

function wetten(c, cls, wet) {
  if (!cls || !(wet > 0)) return;
  const mix = THREE.MathUtils.lerp;
  if (cls === 'ground') { c.color.multiplyScalar(mix(1, 0.62, wet)); c.roughness = mix(c.roughness, Math.max(0.06, c.roughness * 0.3), wet); }
  else if (cls === 'plant') c.roughness = mix(c.roughness, Math.max(0.12, c.roughness * 0.45), wet);
  else { c.color.multiplyScalar(mix(1, 0.85, wet)); c.roughness = mix(c.roughness, Math.max(0.08, c.roughness * 0.55), wet); }
}
const PUDDLE_GLSL = `
varying vec3 vWetWorld;
uniform float uWet;
float outsideHouse( vec2 p ) { float f = ( p.x < -3.5 || p.x > 3.97 ) ? -5.94 : -4.82; return ( p.x >= -8.1 && p.x <= 8.1 && p.y >= f && p.y <= 5.62 ) ? 0.0 : 1.0; }
float wetGround( vec3 nWorld ) { return uWet * outsideHouse( vec2( vWetWorld.x, -vWetWorld.z ) ) * smoothstep( 0.8, 0.95, nWorld.y ) * ( 1.0 - smoothstep( 0.3, 0.6, vWetWorld.y ) ); }
float wetHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wetNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wetHash( i ), wetHash( i + vec2( 1, 0 ) ), f.x ), mix( wetHash( i + vec2( 0, 1 ) ), wetHash( i + vec2( 1, 1 ) ), f.x ), f.y ); }
float puddle() { vec2 p = vWetWorld.xz * 0.35; float n = 0.55 * wetNoise( p ) + 0.3 * wetNoise( p * 2.1 + 5.2 ) + 0.15 * wetNoise( p * 4.3 + 9.1 );
  return smoothstep( 0.56, 0.6, n ); }
`;

// ---- Soft sun shadows (PCSS), as Blender's sun has a size: the penumbra grows with the distance to whatever blocks the
// light, so leaves 20 m away cast wide soft dapples while a window frame stays crisp. three's shadow map only answers
// "lit or not", so the sun's depth is rendered once more into a readable texture (alpha cut-outs kept) and filtered here.
const SUN_RADIUS = THREE.MathUtils.degToRad(0.265);   // the real sun's angular radius (0.53 degrees across): crisp penumbrae like real sunlight
const spiral = n => Array.from({ length: n }, (_, j) => { const r = Math.sqrt((j + 0.5) / n), a = j * 2.399963229728653; return `vec2(${(Math.cos(a) * r).toFixed(6)}, ${(Math.sin(a) * r).toFixed(6)})`; }).join(', ');
// Taps per quality tier, [blocker search, filter]: hq keeps the full set; laptop and mobile trade a little more grain in
// the penumbrae for fewer depth reads (PCSS was ~3.8 ms of a GPU-bound 4x-1440p living frame on the A6000 at 16/24).
// The tier is a uniform, so J switches without recompiling. No early-out when every search tap finds a blocker: in
// dappled light the sparse search misses the gaps the filter finds, and the pixel turned black.
export const PCSS_TAPS = { hq: [16, 24], laptop: [12, 16], mobile: [8, 12] };
const PCSS_TIER = { hq: 0, laptop: 1, mobile: 2 };
const pcssTaps = (k, [s, f]) => `
const vec2 SUN_SEARCH${k}[${s}] = vec2[${s}](${spiral(s)});
const vec2 SUN_FILTER${k}[${f}] = vec2[${f}](${spiral(f)});
float sunPCSS${k}(vec3 c, mat2 R, float search) {
  float sum = 0.0, n = 0.0;
  for (int i = 0; i < ${s}; i++) { float d = texture2D(uSunDepth, c.xy + R * SUN_SEARCH${k}[i] * search).r; if (d < c.z) { sum += d; n += 1.0; } }
  if (n < 0.5) return 1.0;
  float pen = max((c.z - sum / n) * uSunDepthRange * uSunTan / uSunWidth, 1.5 * uSunTexel);
  float lit = 0.0;
  for (int i = 0; i < ${f}; i++) lit += step(c.z, texture2D(uSunDepth, c.xy + R * SUN_FILTER${k}[i] * pen).r);
  return lit / ${f}.0;
}`;
const PCSS_GLSL = `
uniform sampler2D uSunDepth; uniform float uSunTexel; uniform float uSunDepthRange; uniform float uSunWidth; uniform float uSunTan; uniform float uSunFrame; uniform int uSunTaps;
${pcssTaps(0, PCSS_TAPS.hq)}${pcssTaps(1, PCSS_TAPS.laptop)}${pcssTaps(2, PCSS_TAPS.mobile)}
float sunPCSS(vec4 sc, float bias) {
  vec3 c = sc.xyz / sc.w; c.z += bias;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  // uSunFrame stays 0 unless TAA drives it (main.js): then the rotations change every frame and the noise integrates.
  float a = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy + 5.588238 * uSunFrame, vec2(0.06711056, 0.00583715))));
  mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  float search = max(30.0 * uSunTan / uSunWidth, 2.0 * uSunTexel);
  if (uSunTaps == 2) return sunPCSS2(c, R, search);
  if (uSunTaps == 1) return sunPCSS1(c, R, search);
  return sunPCSS0(c, R, search);
}
`;
// Two depth targets: `base` holds every caster that holds still, `rt` (sampled) is base's depth plus the "hot" casters,
// the ones moving now: a door in its swing, the garage door, a toggle, a carried chair (hot from its first change until
// 2 s after its last), the pets and the visitor (always hot). A refresh while they move is a depth copy and a few
// draws; base is redrawn only when a caster turns hot (once per interaction: it must leave base), on load/tier changes,
// and after the slow scan finds an untracked caster moving. Cooled casters return to base at its next redraw.
// Shader-only motion (garden wind in custom depth materials) stays a snapshot, and so does anything that never stops
// moving on its own (ambient, below).
const DYN_LAYER = 29;
function createSunPCSS(renderer, scene, sun, size = 4096) {
  const target = n => { const t = new THREE.WebGLRenderTarget(n, n, { depthBuffer: true, format: THREE.RedFormat, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); t.depthTexture = new THREE.DepthTexture(n, n, THREE.FloatType); return t; };
  const rt = target(size), base = target(size);
  const uniforms = { uSunDepth: { value: rt.depthTexture }, uSunTexel: { value: 1 / size }, uSunDepthRange: { value: 1 }, uSunWidth: { value: 1 }, uSunTan: { value: Math.tan(SUN_RADIUS) }, uSunFrame: { value: 0 }, uSunTaps: { value: 0 } };
  const cache = new Map(), entries = new Map(), swaps = [], roots = new Set(), always = new Set(), promoted = new Set();
  let dynamic = [], statics = [], cursor = 0;
  let version = 0, clock = 1, now = 0, wasMoving = false, dirty = true, staticDirty = true, classifyDirty = true, staticDue = 0;
  const stats = { casters: 0, tracked: 0, hot: 0, ambient: 0, staticRenders: 0, refreshes: 0, staticMs: 0, refreshMs: 0 };
  const depthOf = m => {
    if (!m) return m;
    let d = cache.get(m);
    if (!d) {
      d = new THREE.MeshDepthMaterial(); cache.set(m, d);
      // Keep vertex/alpha deformation, with raster GI removed before the depth hook is captured.
      const hook = m.bakedHooks?.compile ?? m.onBeforeCompile, key = m.bakedHooks?.key ?? shaderKey(m);
      d.onBeforeCompile = function(sh, r) { shaderPatch(sh, 'sun depth ' + key, s => {
        if (hook !== THREE.Material.prototype.onBeforeCompile) {
          // A deformation hook can use skinned normals, and leaf hooks emit normals during GTAO. Supply those chunks
          // in the depth variant too; retain its depth output and alpha/discard code (including fur coverage).
          s.vertexShader = 'varying vec2 vHighPrecisionZW;\n' + rep(THREE.ShaderLib.standard.vertexShader, '#include <clipping_planes_vertex>', '#include <clipping_planes_vertex>\n vHighPrecisionZW = gl_Position.zw;', 'depth clip');
          s.fragmentShader = 'varying vec3 vViewPosition;\n#include <normal_pars_fragment>\n#include <color_pars_fragment>\n' + s.fragmentShader;
          s.fragmentShader = rep(s.fragmentShader, 'vec4 diffuseColor = vec4( 1.0 );', 'vec4 diffuseColor = vec4( 1.0 );\n#include <normal_fragment_begin>', 'depth normal');
          s.fragmentShader = rep(s.fragmentShader, '#include <map_fragment>', '#include <map_fragment>\n#include <color_fragment>', 'depth alpha');
          hook.call(m, s, r);
        }
      }); };
      d.customProgramCacheKey = () => key + '|sun-depth-v2';
      d.onBeforeRender = m.onBeforeRender;
    }
    if (d.userData.sourceVersion !== m.version || !!d.map !== !!m.map || !!d.alphaMap !== !!m.alphaMap || d.side !== (m.shadowSide ?? THREE.DoubleSide)) d.needsUpdate = true;
    d.userData.sourceVersion = m.version;
    for (const k of ['map', 'alphaMap', 'alphaTest', 'displacementMap', 'displacementScale', 'displacementBias', 'clipShadows', 'clippingPlanes']) d[k] = m[k];
    d.defines = m.defines; d.vertexColors = m.vertexColors; d.flatShading = m.flatShading;
    d.side = m.shadowSide ?? THREE.DoubleSide; d.visible = m.visible; d.wireframe = m.wireframe;
    return d;
  };
  const swapIn = (o, e) => {
    const depth = o.customDepthMaterial;
    if (Array.isArray(o.material)) { const a = e.depths ??= []; a.length = o.material.length; for (let i = 0; i < a.length; i++) a[i] = depth ?? depthOf(o.material[i]); o.material = a; }
    else o.material = depth ?? depthOf(o.material);
  };
  // tracked casters (checked every frame): under a tracked root, skinned, or promoted by the slow scan. The hot ones
  // carry a scene layer, which the moving-caster pass draws alone.
  const rootOf = o => { for (let p = o; p; p = p.parent) if (roots.has(p)) return p; return null; };
  const isPlantRoot = o => { for (let p = o; p; p = p.parent) if (/^(plants|garden|flowers)-/.test(p.userData.id || '')) return true; return false; };
  const heat = (o, e, hot) => { e.hot = hot; e.cold = false; if (hot) o.layers.enable(DYN_LAYER); else o.layers.disable(DYN_LAYER); };
  const classify = () => {
    classifyDirty = false; dynamic = []; statics = [];
    for (const r of roots) if (r.parent) r.updateWorldMatrix(true, true);   // snapshots of current, not stale, poses
    scene.traverse(o => {
      if (!o.isMesh) return;
      if (!o.castShadow) { o.layers.disable(DYN_LAYER); return; }
      let e = entries.get(o); if (!e) { e = {}; entries.set(o, e); changed(o, e); e.plant = [].concat(o.material).some(m => m?.alphaTest > 0 || /^(garden-|plant)/.test(m?.name || '')) || isPlantRoot(o); }
      const root = rootOf(o);
      e.always = o.isSkinnedMesh || always.has(root);
      if (root || e.always || promoted.has(o)) { dynamic.push(o); heat(o, e, e.always || (!!e.hot && !e.ambient)); } else { statics.push(o); heat(o, e, false); }
    });
    const live = new Set([...dynamic, ...statics]); for (const o of entries.keys()) if (!live.has(o)) entries.delete(o);
    stats.casters = live.size; stats.tracked = dynamic.length; cursor = 0;
  };
  const sync = () => {
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false); sun.shadow.updateMatrices(sun);
    const cam = sun.shadow.camera; uniforms.uSunDepthRange.value = cam.far - cam.near; uniforms.uSunWidth.value = cam.right - cam.left;
    return cam;
  };
  const draw = (into, cam, statics) => {
    const bg = scene.background, override = scene.overrideMaterial, auto = renderer.autoClear, shadow = renderer.shadowMap?.enabled, mask = cam.layers.mask;
    let n = 0;
    try {
      if (statics) {
        // every renderable: non-casters and hot casters hidden, still casters drawn with depth materials; casters that
        // cooled down (or turned ambient) since the last redraw return here
        for (const o of dynamic) { const e = entries.get(o); if (e.hot && (e.cold || e.ambient)) heat(o, e, false); }
        scene.traverse(o => {
          if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
          const e = swaps[n] ??= {}; n++; e.o = o; e.material = o.material; e.visible = o.visible;
          if (!o.isMesh || !o.castShadow || o.layers.isEnabled(DYN_LAYER)) { o.visible = false; return; }
          swapIn(o, e);
        });
      } else {
        for (const o of dynamic) { if (!o.layers.isEnabled(DYN_LAYER)) continue; const e = swaps[n] ??= {}; n++; e.o = o; e.material = o.material; e.visible = o.visible; if (o.castShadow) swapIn(o, e); else o.visible = false; }
        cam.layers.set(DYN_LAYER);
      }
      scene.background = scene.overrideMaterial = null; renderer.autoClear = statics;
      if (renderer.shadowMap) renderer.shadowMap.enabled = false;
      renderer.setRenderTarget(into); renderer.render(scene, cam);
    } finally {
      cam.layers.mask = mask; renderer.autoClear = auto; scene.background = bg; scene.overrideMaterial = override;
      if (renderer.shadowMap) renderer.shadowMap.enabled = shadow;
      for (let i = 0; i < n; i++) { const e = swaps[i]; e.o.material = e.material; e.o.visible = e.visible; }
    }
  };
  const copyBase = () => {
    // both framebuffers exist once three has bound them; then a depth blit, and three's state cache is reset
    renderer.setRenderTarget(base); renderer.setRenderTarget(rt);
    const gl = renderer.getContext?.(), P = renderer.properties, n = rt.width;
    if (!gl?.blitFramebuffer || !P) return;   // test doubles
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, P.get(base).__webglFramebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, P.get(rt).__webglFramebuffer);
    gl.disable(gl.SCISSOR_TEST); gl.depthMask(true);
    gl.blitFramebuffer(0, 0, n, n, 0, 0, n, n, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    renderer.resetState();
  };
  const refresh = (full = false) => {
    if (classifyDirty) classify();
    const prev = renderer.getRenderTarget(), face = renderer.getActiveCubeFace?.(), mip = renderer.getActiveMipmapLevel?.(), t0 = performance.now();
    try {
      const cam = sync();
      if (full || staticDirty) { draw(base, cam, true); staticDirty = false; stats.staticRenders++; stats.staticMs = +(performance.now() - t0).toFixed(1); }
      copyBase();
      stats.hot = dynamic.reduce((n, o) => n + o.layers.isEnabled(DYN_LAYER), 0);
      if (stats.hot) draw(rt, cam, false);
      version++; dirty = false; clock = 0; stats.refreshes++; stats.refreshMs = +(performance.now() - t0).toFixed(1);
      for (const e of entries.values()) e.pending = false;
    } finally { renderer.setRenderTarget(prev, face, mip); }
  };
  // Visibility (LOD levels are three's to switch: not a change), world matrices (doors, toggles, carried objects and
  // parent transforms), skin, morph and instance data, geometry and material changes. Snapshots are reused.
  const changedArray = (e, key, a) => {
    let old = e[key], changed = !old || old.length !== a.length;
    if (changed) old = e[key] = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) { if (old[i] !== a[i]) changed = true; old[i] = a[i]; }
    return changed;
  };
  const changed = (o, e) => {
    let visible = true, top = o, changed = false;
    for (let p = o; p; p = p.parent) { if (!p.visible && !p.parent?.isLOD) visible = false; top = p; }
    if (top !== scene) { classifyDirty = true; return true; }   // removed from the scene
    if (visible !== e.visible) { e.visible = visible; changed = true; }
    if (!visible) return changed;
    changed = changedArray(e, 'matrix', o.matrixWorld.elements) || changed;
    if (o.skeleton) { e.bones ??= []; for (let i = 0; i < o.skeleton.bones.length; i++) changed = changedArray(e.bones, i, o.skeleton.bones[i].matrixWorld.elements) || changed; }
    if (o.morphTargetInfluences) changed = changedArray(e, 'morph', o.morphTargetInfluences) || changed;
    if (e.instance !== o.instanceMatrix?.version || e.count !== o.count || e.position !== o.geometry.attributes.position?.version || e.geometry !== o.geometry || e.depth !== o.customDepthMaterial || e.castShadow !== o.castShadow) {
      if (e.castShadow !== undefined && e.castShadow !== o.castShadow) classifyDirty = true;
      e.instance = o.instanceMatrix?.version; e.count = o.count; e.position = o.geometry.attributes.position?.version; e.geometry = o.geometry; e.depth = o.customDepthMaterial; e.castShadow = o.castShadow; changed = true;
    }
    const multi = Array.isArray(o.material), n = multi ? o.material.length : 1, ms = e.materials ??= [];
    if (ms.length !== n) { ms.length = n; changed = true; }
    for (let i = 0; i < n; i++) {
      const m = multi ? o.material[i] : o.material, a = ms[i] ??= {};
      // what the depth pass reads (not the version: environment maps and the like recompile without changing depth)
      if (a.m !== m || a.alpha !== m?.alphaTest || a.visible !== m?.visible || a.map !== m?.map || a.alphaMap !== m?.alphaMap || a.side !== (m?.shadowSide ?? m?.side)) {
        a.m = m; a.alpha = m?.alphaTest; a.visible = m?.visible; a.map = m?.map; a.alphaMap = m?.alphaMap; a.side = m?.shadowSide ?? m?.side; changed = true;
      }
    }
    return changed;
  };
  // main.js calls this after every animation/interaction update of the frame. Moving set: every frame; still set: a
  // slice per frame (all of it about every four seconds), and a still caster found changed joins the moving set.
  const update = (dt = 0) => {
    if (classifyDirty) classify();
    let moving = false, settled = false; now += dt;
    for (const r of roots) if (r.parent) r.updateWorldMatrix(true, true);
    for (const o of promoted) o.updateWorldMatrix(true, false);
    for (const o of dynamic) {
      const e = entries.get(o), c = changed(o, e);
      if (e.ambient) continue;
      // a motion streak: changes no more than 0.5 s apart (some animations skip frames)
      if (c) { if (!(now - e.last <= 0.5)) e.first = now; e.last = now; }
      // something that never stops on its own clock (a promoted plant swaying: 2 s; a tracked part: 20 s) becomes
      // ambient: back into base as a snapshot and no longer a reason to refresh, so the soft shadows and the light
      // shafts' history can settle. Pets and the visitor never do.
      if (!e.always && now - e.last <= 0.5 && now - e.first > (promoted.has(o) ? 2 : 20)) { e.ambient = true; stats.ambient++; staticDue = 0.5; continue; }
      if (c && !e.hot) { heat(o, e, true); if (promoted.has(o)) staticDue = 0.5; else staticDirty = true; }   // must leave base now
      // cooled down 2 s after its last change: folded back into base by one redraw a second later (keeps refreshes cheap)
      if (c) e.cold = false; else if (e.hot && !e.always && !e.cold && now - e.last > 2) { e.cold = true; staticDue = Math.max(staticDue, 1); }
      settled ||= !!(e.moving && !c && e.pending); e.moving = c; e.pending ||= c; moving ||= c;
    }
    const k = Math.min(statics.length, Math.ceil(statics.length / 120));
    for (let i = 0; i < k; i++) {
      const o = statics[cursor++ % statics.length], e = entries.get(o);
      // tracked and hot from now on; base is redrawn without it once promotions pause for half a second. Plants sway
      // on their own clock: a snapshot, as before (their near/far copies swap too), never promoted.
      if (changed(o, e) && !e.plant) { promoted.add(o); e.hot = true; classifyDirty = true; staticDue = 0.5; moving = true; e.moving = e.pending = true; }
    }
    if (staticDue > 0 && (staticDue -= dt) <= 0) { staticDirty = true; moving = true; }
    dirty ||= moving; clock += dt;
    if (dirty && (clock >= 0.05 || settled || (!moving && wasMoving))) refresh();
    wasMoving = moving;
  };
  const lookup = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';
  const patch = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = rep(sh.fragmentShader, 'void main() {', PCSS_GLSL + '\nvoid main() {', 'PCSS main');
    if (sh.fragmentShader.includes('#include <lights_fragment_begin>')) sh.fragmentShader = rep(sh.fragmentShader, '#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin, 'PCSS lights');
    sh.fragmentShader = rep(sh.fragmentShader, lookup, 'sunPCSS( vDirectionalShadowCoord[ i ], directionalLightShadow.shadowBias )', 'PCSS lookup');
  };
  const invalidate = () => { classifyDirty = staticDirty = dirty = true; clock = 1; };
  // subtrees whose casters move (doors, toggles, movables, pets, the visitor): checked every frame
  const track = (objects, hot = false) => { for (const o of [].concat(objects)) if (o) { roots.add(o); if (hot) always.add(o); } invalidate(); };
  const setSize = n => { if (rt.width === n) return; rt.setSize(n, n); base.setSize(n, n); uniforms.uSunTexel.value = 1 / n; invalidate(); };
  const setTier = name => { uniforms.uSunTaps.value = PCSS_TIER[name] ?? 0; };
  const depthEntries = () => {
    const jobs = []; scene.traverse(o => { if (o.isMesh && o.castShadow) for (const m of [].concat(o.material)) jobs.push({ object: o, material: o.customDepthMaterial ?? depthOf(m) }); }); return jobs;
  };
  return { uniforms, depthEntries, warm: () => warmPrograms(renderer, scene, sync(), base, depthEntries(), false), render: () => refresh(true), patch, update, invalidate, track, setSize, setTier, stats, matrix: sun.shadow.matrix, get version() { return version; },
    dispose() { rt.dispose(); base.dispose(); for (const d of cache.values()) d.dispose(); cache.clear(); entries.clear(); swaps.length = 0; for (const o of dynamic) o.layers.disable(DYN_LAYER); roots.clear(); always.clear(); promoted.clear(); } };
}

async function loadUnits(url) {
  const response = await fetch(url); if (!response.ok) throw new Error(`lightmap ${response.status}: ${url}`);
  let buf = await response.arrayBuffer();
  // format 2 is gzipped (unless the server already unpacked it), with 16-bit vertex maps and indices where they fit
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] === 0x1f && b[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const hl = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  const base = 4 + hl;
  // the chunks are written back to back without padding, so copy rather than view (alignment)
  const take = (o, n, wide) => wide ? new Uint32Array(buf.slice(o, o + n * 4)) : Uint32Array.from(new Uint16Array(buf.slice(o, o + n * 2)));
  for (const u of header.units) {
    let o = base + u.off; const x32 = !u.x16, i32 = !u.i16;   // format 1 has neither flag: all 32-bit
    u.xref = take(o, u.nv, x32); o += u.nv * (x32 ? 4 : 2);
    u.index = take(o, u.ni, i32); o += u.ni * (i32 ? 4 : 2);
    u.uv = new Uint16Array(buf.slice(o, o + u.nv * 4));
    if (u.xref.length !== u.nv || u.index.length !== u.ni || u.uv.length !== u.nv * 2 || u.xref.some(i => i >= u.vc) || u.index.some(i => i >= u.nv)) throw new Error('Invalid lightmap UV unit');
  }
  return header;
}

// A copy of the geometry with seams split for the lightmap, and the lightmap UVs in uv1.
function relayout(geometry, unit) {
  const g = new THREE.BufferGeometry(), x = unit.xref;
  for (const [name, a] of Object.entries(geometry.attributes)) {
    const n = a.itemSize, out = new a.array.constructor(x.length * n);
    for (let i = 0; i < x.length; i++) for (let k = 0; k < n; k++) out[i * n + k] = a.array[x[i] * n + k];
    g.setAttribute(name, new THREE.BufferAttribute(out, n, a.normalized));
  }
  const uv = new Float32Array(x.length * 2);
  // the HDR file is read with flipY, so the lightmap's v is mirrored (checked visually: ?lmflip=0 scrambles every chart)
  const flip = new URLSearchParams(location.search).get('lmflip') !== '0';
  for (let i = 0; i < x.length; i++) { uv[i * 2] = unit.uv[i * 2] / 65535; uv[i * 2 + 1] = flip ? 1 - unit.uv[i * 2 + 1] / 65535 : unit.uv[i * 2 + 1] / 65535; }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(unit.index, 1));
  for (const grp of geometry.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// An RGBM lightmap PNG as an 8-bit texture: no premultiplied alpha, no colour management, rows flipped like the HDR
// files were, so the same lightmap UVs apply. A split layer (15 MB file cap) is uploaded part by part into one texture.
// Tone-curved atlases get a full mip chain (three allocates it and fills it with an encoded box filter, which
// linearMips then replaces); RGBM (no encoding.json, legacy) stays single-level.
async function loadRGBM(url, rows, renderer, mips = true, track) {
  const image = await lightmapBitmap(url, rows, track), opts = { flipY: false, premultiplyAlpha: false, colorSpace: THREE.NoColorSpace, channel: 1, generateMipmaps: mips, minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, anisotropy: mips ? 4 : 1 };
  if (Math.max(image.width, image.height) > renderer.capabilities.maxTextureSize) { if (image.parts) image.parts.forEach(p => p.bitmap.close()); else image.close(); throw new Error('lightmap atlas exceeds maxTextureSize'); }
  if (!image.parts) { const t = Object.assign(new THREE.Texture(image), opts); t.needsUpdate = true; t.userData.restore = () => renderer.initTexture?.(t); return t; }
  const t = Object.assign(new THREE.DataTexture(null, image.width, image.height), opts);
  const parts = image.parts.map(p => ({ ...p, texture: new THREE.Texture(p.bitmap), offset: new THREE.Vector3(0, p.y, 0) }));
  const upload = () => {
    // allocate every level, then copy the parts without a generateMipmap per part (linearMips fills the levels)
    t.generateMipmaps = mips; t.source.dataReady = false; t.needsUpdate = true; renderer.initTexture(t);
    t.generateMipmaps = false;
    try { for (const p of parts) renderer.copyTextureToTexture(p.texture, t, null, p.offset); } finally { t.generateMipmaps = mips; }
  };
  t.userData.restore = upload;
  t.userData.release = () => { for (const p of parts) { p.texture.dispose(); p.bitmap.close(); } };
  try {
    if (Math.max(image.width, image.height) > renderer.capabilities.maxTextureSize) throw new Error('lightmap atlas exceeds maxTextureSize');
    upload(); return t;
  } catch (err) { t.dispose(); t.userData.release(); throw err; }
}
// Magnified (a texel spans more than a pixel): decode each of the four nearest level-0 texels BEFORE bilinear mixing,
// so sharp baked shadow edges interpolate in linear light. Minified: hardware trilinear/anisotropic filtering over the
// linear-light mip chain (linearMips), decoded after; the blend between neighbouring texels then covers less than a
// pixel. ?lmfilter=decode (always level 0, decoded first) / hw (always hardware) for A/B checks.
const LM_FILTER = { decode: 1, hw: 2 }[new URLSearchParams(location.search).get('lmfilter')] ?? 0;
const RGBM_DECODE = 'vec3 lmDecode( vec4 t, float K ) { vec3 c = t.rgb * t.a; return c * c * 8.0; }';
const TONE_DECODE = `vec3 lmDecode( vec4 t, float K ) { vec3 y2 = t.rgb * t.rgb; return K * y2 / max( 1.0 - y2, vec3( 1.0 / 255.0 ) ); }`;
const LM_SAMPLE = `
#define LM_FILTER ${LM_FILTER}
uniform vec2 uLmK;
vec3 lmSample( sampler2D tex, vec2 uv, float K ) {
  ivec2 size = textureSize( tex, 0 ), hi = size - 1;
  vec2 tc = uv * vec2( size ), dx = dFdx( tc ), dy = dFdy( tc );
#if LM_FILTER == 2
  return lmDecode( texture( tex, uv ), K );
#elif LM_FILTER == 0
  if ( max( dot( dx, dx ), dot( dy, dy ) ) > 1.0 ) return lmDecode( texture( tex, uv ), K );
#endif
  vec2 p = tc - 0.5, f = fract( p ); ivec2 i = ivec2( floor( p ) );
  vec3 a = lmDecode( texelFetch( tex, clamp( i, ivec2( 0 ), hi ), 0 ), K );
  vec3 b = lmDecode( texelFetch( tex, clamp( i + ivec2( 1, 0 ), ivec2( 0 ), hi ), 0 ), K );
  vec3 c = lmDecode( texelFetch( tex, clamp( i + ivec2( 0, 1 ), ivec2( 0 ), hi ), 0 ), K );
  vec3 d = lmDecode( texelFetch( tex, clamp( i + ivec2( 1 ), ivec2( 0 ), hi ), 0 ), K );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
`;

// Mip levels in linear light for a tone-curved pair [slot, lamps] (GPU, once per upload): each level-k texel decodes
// its 2x2 block of level k-1, averages it weighted by coverage (texels the bake wrote: level 0 has a non-black slot
// texel, chart padding included; deeper levels carry the covered fraction in alpha), re-encodes with the layer's K,
// and an empty texel next to a covered one takes their average (fresh padding, alpha 0, never averaged further), so
// distant chart edges neither darken into the black gaps nor mix with unrelated charts beyond one texel. The lamps layer
// uses the slot layer's coverage (lamp light is legitimately black in much of the covered atlas). Like
// bake/scripts/downscale_atlas.py, but per level and with the bake's padding standing in for its coverage mask.
// ?lmmips=gl keeps three's encoded box filter instead.
const MIP_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uSrc; uniform sampler2D uCov; uniform int uFirst; uniform float uK; uniform ivec2 uDst;
out vec4 outColor;
vec3 dec( vec3 y ) { vec3 y2 = y * y; return uK * y2 / max( 1.0 - y2, vec3( 1.0 / 255.0 ) ); }
vec3 enc( vec3 x ) { return sqrt( x / ( x + uK ) ); }
vec4 block( ivec2 d ) {
  ivec2 hi = textureSize( uSrc, 0 ) - 1; vec4 s = vec4( 0.0 );
  for ( int j = 0; j < 2; j ++ ) for ( int i = 0; i < 2; i ++ ) {
    ivec2 q = min( d * 2 + ivec2( i, j ), hi ); vec4 t = texelFetch( uSrc, q, 0 );
    float c = uFirst == 1 ? ( any( greaterThan( texelFetch( uCov, q, 0 ).rgb, vec3( 0.0 ) ) ) ? 1.0 : 0.0 ) : t.a;
    s += vec4( dec( t.rgb ) * c, c );
  }
  return s;
}
void main() {
  ivec2 d = ivec2( gl_FragCoord.xy ); vec4 s = block( d );
  if ( s.a > 0.0 ) { outColor = vec4( enc( s.rgb / s.a ), max( s.a * 0.25, 1.0 / 255.0 ) ); return; }
  vec4 n = vec4( 0.0 );
  for ( int j = -1; j <= 1; j ++ ) for ( int i = -1; i <= 1; i ++ ) {
    ivec2 e = d + ivec2( i, j );
    if ( ( i != 0 || j != 0 ) && all( greaterThanEqual( e, ivec2( 0 ) ) ) && all( lessThan( e, uDst ) ) ) n += block( e );
  }
  outColor = vec4( n.a > 0.0 ? enc( n.rgb / n.a ) : vec3( 0.0 ), 0.0 );
}`;
function linearMips(renderer, [slot, lamps], K) {
  if (new URLSearchParams(location.search).get('lmmips') === 'gl') return null;
  const gl = renderer.getContext?.(), t0 = performance.now();
  if (!gl?.createShader || !renderer.properties) return null;   // test doubles
  for (const t of [slot, lamps]) renderer.initTexture(t);
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const vs = shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main() { vec2 p = vec2( float( ( gl_VertexID << 1 ) & 2 ), float( gl_VertexID & 2 ) ); gl_Position = vec4( p * 2.0 - 1.0, 0.0, 1.0 ); }');
  const fs = shader(gl.FRAGMENT_SHADER, MIP_FS), prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  const vao = gl.createVertexArray(), fb = gl.createFramebuffer(); let levels = 0;
  try {
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('lightmap mips: ' + (gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(prog)));
    gl.useProgram(prog); gl.bindVertexArray(vao); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.RASTERIZER_DISCARD]) gl.disable(cap);
    gl.colorMask(true, true, true, true);
    const u = n => gl.getUniformLocation(prog, n);
    gl.uniform1i(u('uSrc'), 0); gl.uniform1i(u('uCov'), 1);
    const slotGL = renderer.properties.get(slot).__webglTexture;
    for (const [t, k] of [[slot, K[0]], [lamps, K[1]]]) {
      const tex = renderer.properties.get(t).__webglTexture, w = t.image.width, h = t.image.height, n = Math.floor(Math.log2(Math.max(w, h))) + 1;
      gl.uniform1f(u('uK'), k);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, slotGL);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      try {
        for (let level = 1; level < n; level++) {
          const lw = Math.max(1, w >> level), lh = Math.max(1, h >> level);
          // sample only the level below (no feedback loop with the level being written)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, level - 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, level - 1);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, level);
          if (level === 1 && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('lightmap mips: framebuffer incomplete');
          gl.uniform1i(u('uFirst'), level === 1 ? 1 : 0); gl.uniform2i(u('uDst'), lw, lh);
          gl.viewport(0, 0, lw, lh); gl.drawArrays(gl.TRIANGLES, 0, 3); levels++;
        }
      } finally {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 1000);
      }
    }
    return { levels, ms: +(performance.now() - t0).toFixed(1) };
  } catch (err) {
    console.warn('lightmap mips: keeping the encoded mip chain', err); return null;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.bindVertexArray(null); gl.deleteVertexArray(vao);
    gl.useProgram(null); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
    renderer.resetState();
  }
}

const lmResolution = bakedResolution;
const disposeAtlas = t => { t.dispose(); t.userData.release?.(); t.image.close?.(); };
const atlasMiB = (w, h) => w * h * 8 / 1048576;

export async function applyLightmaps({ scene, renderer, lighting, movables = [], dynamic = [], base = 'assets/lightmaps', slot = 'sunrise', lamps = 0.25, tier = 'laptop', onProgress = () => {} }) {
  const t0 = performance.now(), patchStart = shaderPatchCount(); let disposed = false;
  const legacyTune = { ...lighting.tune }, legacyGrade = Object.fromEntries(Object.entries(lighting.grade ?? {}).map(([k, u]) => [k, u.value]));
  const legacyTone = renderer.toneMapping, legacyExposure = renderer.toneMappingExposure, legacyAO = lighting.gtao?.blendIntensity;
  const legacySunCamera = lighting.sun.shadow.camera.clone();
  const originalBackground = scene.background, originalMeshes = new Map(), shadowCasters = new Map(), lightVisibility = new Map();
  // The shipped v2 tone-curved bake replaces the retired ?lmv=1 experiment.
  const v2 = true, dir = `${base}/v2`;
  let completed = 0;
  const progress = () => onProgress(++completed / 9);
  const asset = await lightmapAssets(base); progress();
  const availableSlots = await discoverSlots(base, asset.manifest);
  slot = initialSlot(slot, availableSlots);
  const multi = availableSlots.length > 1;
  if (multi) lamps = SLOTS[slot].lamps;
  let slots = null;
  // the compact formats when present: gzipped 16-bit UV data, tone-curved lossless WebP layers
  let enc = v2 ? await fetch(asset(`${dir}/${slot}/encoding.json`)).then(r => r.ok ? r.json() : null).catch(() => null) : null;
  if (!v2 || !enc || !SLOTS[slot] || !['slot', 'lamps'].every(k => Number.isFinite(enc.K?.[k]) && enc.K[k] > 0)) throw new Error('Invalid baked encoding or slot');
  progress();
  // Switchable lamps (lamp_groups.js): one baked layer per group of light switches, each at its physical level when on.
  // Without them (missing, invalid, failed to load, ?lmgroups=0) the shared lamps layer at the slot's level.
  let groupMeta = lampGroupsWanted() ? await fetch(asset(`${dir}/lampgroups/encoding.json`)).then(r => r.ok ? r.json() : null).catch(() => null) : null;
  if (groupMeta && !validGroupEncoding(groupMeta)) { console.warn('lamp groups: invalid encoding, using the shared lamps layer'); groupMeta = null; }
  let groups = groupMeta ? createLampGroups({ meta: groupMeta, switches: lighting.lightSwitches, dir, asset, renderer }) : null;
  let resolution = v2 && enc ? lmResolution(tier) : 'full', shadowSize = Math.min(TIERS[tier].shadowMap, renderer.capabilities.maxTextureSize);
  // A missing tier is a failed bake, never a reason to allocate the full atlas on a small device.
  const loadAtlases = async (res, name = slot, meta = enc, track = work => work()) => {
    const divisor = { full: 1, half: 2, quarter: 4 }[res];
    if (header.atlas.some(n => Math.ceil(n / divisor) > renderer.capabilities.maxTextureSize)) throw new Error('lightmap atlas exceeds maxTextureSize');
    const path = `${dir}/${name}${res === 'full' ? '' : '/' + res}`;
    const readLayer = (layer, folder, encoding) => {
      const rows = res === 'full' ? encoding?.rows?.[layer] : null;
      return loadRGBM(rows ? rows.map((_, i) => asset(`${folder}/${layer}_${i}.webp`)) : asset(`${folder}/${layer}.webp`), rows, renderer, true, track);
    };
    const lampsAtlas = async () => {
      if (groups) { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; t.userData.unused = true; return t; }   // lamp groups instead
      if (name === 'sunrise') return readLayer('lamps', path, meta);
      const ownK = meta.K.lamps;
      const own = () => { meta.K.lamps = ownK; return readLayer('lamps', path, meta); };
      const shared = async () => {
        const encoding = await track(() => fetch(asset(`${dir}/sunrise/encoding.json`)).then(r => r.ok ? r.json() : null));
        if (!validEncoding(encoding)) throw Error('Invalid shared lamp encoding');
        const t = await readLayer('lamps', `${dir}/sunrise${res === 'full' ? '' : '/' + res}`, encoding);
        meta.K.lamps = encoding.K.lamps; return t;
      };
      if (meta.lampsSlot === 'sunrise') { try { return await shared(); } catch { return own(); } }
      try { return await own(); } catch { return shared(); }
    };
    const result = await Promise.allSettled([readLayer('slot', path, meta), lampsAtlas()]);
    if (result.some(r => r.status === 'rejected')) {
      for (const r of result) if (r.status === 'fulfilled') disposeAtlas(r.value);
      const reason = result.find(r => r.status === 'rejected').reason;
      throw reason;
    }
    const pair = Object.assign(result.map(r => r.value), { res });
    if (pair.some(t => !t.userData.unused && (t.image.width !== Math.ceil(header.atlas[0] / divisor) || t.image.height !== Math.ceil(header.atlas[1] / divisor)))) { pair.forEach(disposeAtlas); throw new Error('lightmap atlas dimensions disagree with UV data'); }
    if (enc) { pair.mips = linearMips(renderer, pair, [meta.K.slot, meta.K.lamps]); for (const t of pair) t.userData.mips = pair.mips; }
    return pair;
  };
  // UVs carry the authoritative full atlas size. Reject an oversized tier before decoding/uploading any atlas.
  const units = asset(`${dir}/lightmap_uv2.bin.gz`);
  const header = await Promise.resolve(units).then(loadUnits); progress();
  const scale = { full: 1, half: 2, quarter: 4 }[resolution];
  const expected = header.atlas.map(n => Math.ceil(n / scale));
  if (expected.some(n => !Number.isInteger(n) || n <= 0 || n > renderer.capabilities.maxTextureSize)) throw new Error('lightmap atlas exceeds maxTextureSize');
  const tasks = [
    loadProbes(asset(`${base}/${slot}/probes.bin`)),
    new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(asset(`${base}/${slot}/sky_bg.hdr`)),
    loadReflections(`${base}/${slot}/refl`, asset),
    v2 ? loadAtlases(resolution) : Promise.all(['sky', 'sunind', 'lamps'].map(l => new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(asset(`${base}/${slot}/${l}.hdr`)))),
    loadFoliage(asset(`${dir}/${slot}/foliage.bin.gz`)),
    lighting.outputPass && new URLSearchParams(location.search).get('agx') !== 'three' ? loadAgXLuts() : Promise.resolve(null),
  ];
  const groupTask = groups ? Promise.all([groups.setResolution(resolution), groupMeta.probes ? loadGroupProbes(asset(`${dir}/lampgroups/probes.bin`), groupMeta.groups.length, groupMeta.probes.count) : null,
    groupMeta.refl && lampReflSet(tier) ? loadLampReflections(dir, asset, groupMeta, lampReflSet(tier)).catch(err => { console.warn('lamp reflections failed: daylight reflections only', err); return null; }) : null])
    .catch(err => { console.warn('lamp groups failed, using the shared lamps layer', err); return false; }) : Promise.resolve(null);
  const staged = await Promise.allSettled(tasks.map(p => p.then(value => { progress(); return value; })));
  const release = (i, fn) => { if (staged[i].status === 'fulfilled' && staged[i].value) fn(staged[i].value); };
  const releaseStage = () => {
    release(1, t => t.dispose()); release(2, r => r.uniforms.uReflTex.value.dispose());
    release(3, ts => ts.forEach(disposeAtlas)); release(5, ts => ts.forEach(t => t.dispose()));
  };
  if (staged.some(r => r.status === 'rejected')) { releaseStage(); groupTask.then(() => groups?.dispose()); throw staged.find(r => r.status === 'rejected').reason; }
  let [probes, skyBg, refl, layers, foliageData, agxLuts] = staged.map(r => r.value);
  const groupData = await groupTask;
  if (groups && (groupData === false || (groupData[1] && probes.N !== groupMeta.probes.count))) {
    // fall back to the shared lamps layer: the pair was loaded without it
    groups.dispose(); groups = null; groupMeta = null; layers.forEach(disposeAtlas);
    try { layers = await loadAtlases(resolution); } catch (err) { releaseStage(); throw err; }
  } else if (groups) { groups.probeSH = groupData[1]; if (groupData[2]) attachLampReflections(refl, groupData[2], groups, multi); }
  // main.js loads this plan for Layout/hq.js; bundle its pieces here and reuse the boxes across slots.
  const walls = probeWalls(housePlan.pieces), volume = buildProbeVolume(probes, groups, walls);
  volume.wet = SLOTS[slot].wet ?? 0; volume.refl = refl; volume.multi = multi; refl.slots = multi;
  // Every fetch/decode/validation has completed. Nothing above changes scene objects or legacy lighting.
  await new Promise(resolve => setTimeout(resolve, 0));
  if (v2) resolution = layers.res;
  const lmUniforms = { uLmK: { value: new THREE.Vector2(enc?.K.slot ?? 1, enc?.K.lamps ?? 1) }, uLmLamps: { value: v2 ? layers[1] : null }, uLampLevel: { value: lamps } };
  // one combined atlas: sky + sun bounce + lamps x level
  // multiplier from the bake's units to three's irradiance (?lmi= overrides it for calibration)
  const lmi = Number(new URLSearchParams(location.search).get('lmi')), lightMapIntensity = Number.isFinite(lmi) && lmi > 0 ? lmi : Math.PI;
  const target = { texture: layers[0] };
  let lampLevel = lamps, volumeRef = null;
  const combine = level => {
    if (disposed) return;
    lampLevel = level; lmUniforms.uLampLevel.value = level; if (slots) slots.combine(level); else volumeRef?.fill(level);
  };
  combine(lamps);

  // match units to live meshes: by id, then the leftovers by vertex count and tight world bounds (as the export measured
  // them; a transformed local box is too wide when rotated), never onto originals a merged mesh replaced or carried pieces
  const byId = new Map(), byCount = new Map();
  for (const u of header.units) { if (u.id) byId.set(u.id, u); if (!byCount.has(u.vc)) byCount.set(u.vc, []); byCount.get(u.vc).push(u); }
  const weather = new Map(), emissionCopies = new Map();
  const syncEmissionCopies = level => { for (const [m, e] of emissionCopies) m.emissiveIntensity = e.source.userData.lightGlow ? e.source.emissiveIntensity : e.base * level; };
  const box = new THREE.Box3(), tmp = new THREE.Vector3(), mats = new Map(); let matched = 0, byBox = 0, triangles = 0;
  const pcss = createSunPCSS(renderer, scene, lighting.sun, shadowSize), legacyShadow = lighting.sun.userData.bakedShadow;
  pcss.track([...movables, ...dynamic]);   // doors, toggles and movable furniture: their sun shadows follow them
  pcss.setTier(tier);
  lighting.sun.userData.bakedShadow = true;
  const restoreEmission = lighting.physicalEmission?.();   // as in the bake: only real light sources glow (materials.js emitsLight)
  scene.updateMatrixWorld(true);
  const meshes = []; scene.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.geometry?.attributes.position) meshes.push(o); });
  const tight = o => { box.makeEmpty(); const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i++) box.expandByPoint(tmp.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)); return box; };
  const pairs = new Map();
  for (const o of meshes) { const u = byId.get(o.userData.lmId); if (u && !u.used && u.vc === o.geometry.attributes.position.count) { u.used = true; pairs.set(o, u); } }
  for (const o of meshes) {
    if (pairs.has(o) || o.userData.lmSkip || o.userData.batched) continue;
    const list = byCount.get(o.geometry.attributes.position.count); if (!list?.some(u => !u.used)) continue;
    tight(o); const u = list.find(u => !u.used && Math.abs(box.min.x - u.min[0]) + Math.abs(box.min.y - u.min[1]) + Math.abs(box.min.z - u.min[2]) + Math.abs(box.max.x - u.max[0]) + Math.abs(box.max.y - u.max[1]) + Math.abs(box.max.z - u.max[2]) < 0.006);
    if (u) { u.used = true; pairs.set(o, u); byBox++; }
  }
  // Hinged and bifold door leaves take the probe volume in every pose, lit from the side each face looks at (probeLit,
  // sided). The bake fits only the pose they were exported in (a swung leaf carried the closet's dark into the room),
  // and their thin raised panels and louvre slats bake with dark rims at lightmap resolution that Cycles does not show;
  // the probes match the Cycles renders of these doors closer, open and closed. The glazed garden doors (french,
  // sliders) keep the bake: their frames stand in open sunlight the coarse outdoor probes underestimate.
  const doorParts = new Set(), sharedUV = new Set();
  for (const root of dynamic) {
    const d = root.userData.door; if (!d || d.kind === 'french' || d.kind === 'slider') continue;
    root.traverse(o => { if (o.isMesh && o.parent !== root) doorParts.add(o); });
  }
  for (const o of doorParts) if (pairs.has(o)) { pairs.get(o).used = false; pairs.delete(o); }
  // The exporter writes one glTF mesh for meshes that share geometry and material, and an unwrap that kept the
  // lightmap UVs on that shared primitive left Blender only the last unit's layout: all of them baked into one chart,
  // the others' charts stayed empty (the louvered bifold leaves, black and speckled). Such meshes take the probe volume
  // until a bake whose sidecar says every unit had its own primitive (unwrap.py, "ownPrimitives").
  if (!header.ownPrimitives) {
    const byMesh = new Map();
    for (const o of pairs.keys()) { const k = o.geometry.uuid + ':' + [].concat(o.material).map(m => m?.uuid).join(':'); if (!byMesh.has(k)) byMesh.set(k, []); byMesh.get(k).push(o); }
    for (const list of byMesh.values()) if (list.length > 1) for (const o of list) { pairs.get(o).used = false; pairs.delete(o); sharedUV.add(o); }
  }
  for (const [o, u] of pairs) {
    originalMeshes.set(o, { geometry: o.geometry, material: o.material, castShadow: o.castShadow });
    matched++; triangles += u.ni / 3; tight(o);
    // the walkthrough kept the house shell out of the sun's shadow map (its fake daylight lit rooms instead); with
    // baked light only the live sun's direct light remains, and the shell must stop it at the walls and roof
    o.castShadow = true;
    o.geometry = relayout(o.geometry, u);
    const cls = weatherClass(box, [].concat(o.material)[0] ?? {});
    const lm = m => {
      if (!m?.isMeshStandardMaterial) return m;
      const key = m.uuid + (cls ?? '');
      if (mats.has(key)) return mats.get(key);
      // a clean copy: none of the walkthrough's fake-GI shader patches, the bake's light instead of the sky's diffuse
      const c = m.clone(); c.onBeforeRender = m.onBeforeRender;
      if (emitsLight(m)) emissionCopies.set(c, { source: m, base: m.emissiveIntensity });   // copies must follow their switch even with one slot
      if (multi) weather.set(c, { cls: cls === 'ground' ? null : cls, color: c.color.clone(), roughness: c.roughness });
      wetten(c, cls === 'ground' ? null : cls, SLOTS[slot].wet);   // ground wetness is per pixel
      if (!emitsLight(m)) c.emissiveIntensity = 0;   // a raster glow stand-in: the bake has the real light
      const puddles = (multi || SLOTS[slot].wet > 0) && cls !== 'plant';   // the mask is per pixel: outdoors, facing up, near the ground
      c.lightMap = target.texture; c.lightMapIntensity = lightMapIntensity;
      // reflections dimmed by the baked light reaching the spot (specular occlusion): a dim room reflects little of the
      // bright sky environment, a sunlit terrace keeps it all. OPEN_SKY is the irradiance of open ground in the bake.
      const prev = m.bakedHooks?.compile ?? m.onBeforeCompile, prevKey = m.bakedHooks?.key ?? shaderKey(m), mirror = isMirror(m);
      c.bakedHooks = { compile: prev, key: prevKey };
      c.onBeforeCompile = (sh, renderer) => shaderPatch(sh, 'lightmap ' + prevKey, s => {
        prev.call(c, s, renderer);
        let maps = THREE.ShaderChunk.lights_fragment_maps;
        if (v2) {
          Object.assign(s.uniforms, lmUniforms, slots?.uniforms);
          if (groups) Object.assign(s.uniforms, groups.uniforms);
          s.fragmentShader = (multi ? 'uniform sampler2D uSlotNext; uniform sampler2D uSlotNextLamps; uniform vec2 uSlotNextK; uniform float uSlotBlend; uniform float uSlotLampA; uniform float uSlotLampB;\n' : '') + 'uniform sampler2D uLmLamps; uniform float uLampLevel;\n' + (enc ? TONE_DECODE : RGBM_DECODE) + LM_SAMPLE + (groups ? lampGroupGLSL(groupMeta.textures) : '') + s.fragmentShader;
          // Remove even the unused encoded bilinear lookup, keeping all reads in decoded linear space.
          maps = rep(maps, 'vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );', '', 'lightmap texel');
          maps = rep(maps, 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;',
            groups ? (multi ? 'vec3 lightMapIrradiance = ( mix( lmSample( lightMap, vLightMapUv, uLmK.x ), lmSample( uSlotNext, vLightMapUv, uSlotNextK.x ), uSlotBlend ) + lampGroups( vLightMapUv ) ) * lightMapIntensity;'
              : 'vec3 lightMapIrradiance = ( lmSample( lightMap, vLightMapUv, uLmK.x ) + lampGroups( vLightMapUv ) ) * lightMapIntensity;') :
            (multi ? 'vec3 lightMapIrradiance = mix( lmSample( lightMap, vLightMapUv, uLmK.x ) + uSlotLampA * lmSample( uLmLamps, vLightMapUv, uLmK.y ), lmSample( uSlotNext, vLightMapUv, uSlotNextK.x ) + uSlotLampB * lmSample( uSlotNextLamps, vLightMapUv, uSlotNextK.y ), uSlotBlend ) * lightMapIntensity;' : 'vec3 lightMapIrradiance = ( lmSample( lightMap, vLightMapUv, uLmK.x ) + uLampLevel * lmSample( uLmLamps, vLightMapUv, uLmK.y ) ) * lightMapIntensity;'), 'lightmap decode');
        }
        maps = rep(maps, 'iblIrradiance += getIBLIrradiance( geometryNormal );', '', 'lightmap sky');
        maps = rep(maps, 'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
          'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * clamp( dot( lightMapIrradiance, vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.95, 0.0, 1.0 ) * smoothstep( -0.05, 0.35, inverseTransformDirection( reflect( - geometryViewDir, geometryNormal ), viewMatrix ).y );', 'lightmap specular');
        maps = rep(maps, CLEARCOAT_IBL, CLEARCOAT_IBL.slice(0, -1) + ' * clamp( dot( lightMapIrradiance, vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.95, 0.0, 1.0 );', 'lightmap clearcoat');
        s.fragmentShader = rep(s.fragmentShader, '#include <lights_fragment_maps>', maps, 'lightmap maps');
        if (puddles) { wetPatch(s, SLOTS[slot].wet); if (slots) s.uniforms.uWet = slots.wet; }
        if (refl) reflPatch(s, refl, mirror ? '1.0' : 'clamp( dot( lightMapIrradiance, vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.95 + 0.25, 0.0, 1.0 )', mirror);
        pcss.patch(s);
        // last resort, the next slot's atlases (its fade then jumps at the end): the samplers that dropping them frees
        const next = ['lmSample( uSlotNext, vLightMapUv, uSlotNextK.x )', 'lmSample( uSlotNextLamps, vLightMapUv, uSlotNextK.y )'];
        const drop = fitBaked(s, renderer, c, { name: 'slot crossfade', cost: next.filter(t => s.fragmentShader.includes(t)).length, pending: false });
        if (drop.has('slot crossfade')) s.fragmentShader = s.fragmentShader.replace(next[0], 'lmSample( lightMap, vLightMapUv, uLmK.x )').replace(next[1], 'lmSample( uLmLamps, vLightMapUv, uLmK.y )');
        if (CONTACT) checkedContact(s, true, !drop.has('contact sun'));
      });
      c.customProgramCacheKey = () => prevKey + '|baked-v3:' + [v2, !!enc, puddles, refl?.key ?? refl?.count ?? 0, CONTACT, LM_FILTER, multi, mirror, groups ? 'lg' + groupMeta.textures : '', c.userData.samplerCut ?? 0].join(':');
      mats.set(key, c); return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(lm) : lm(o.material);
  }
  // glass must not block the sun (in the bake shadow rays pass through it, as through real glass)
  scene.traverse(o => { if (!o.isMesh) return; const m = [].concat(o.material)[0]; if (m && (m.transmission > 0 || m.userData?.daylightOpacity !== undefined || (m.transparent && m.opacity < 0.6))) { shadowCasters.set(o, o.castShadow); o.castShadow = false; } });
  lighting.sun.shadow.needsUpdate = true;
  // the live lights the bake now carries
  for (const l of [...lighting.windowLights, ...lighting.fixtures.children]) if (l.isLight) { lightVisibility.set(l, l.visible); l.visible = false; }
  scene.traverse(o => { if (o.isHemisphereLight) { lightVisibility.set(o, o.visible); o.visible = false; } });
  // every lit surface that did not get a lightmap takes the probe volume (and the soft sun)
  let probeLitCount = 0, foliage = null, envTarget = null, windows = null, stats = null;
  const hooks = new Map(), envs = new Map(), sided = new Set();
  // doors and toggles (blinds, curtains, the garage door) sit in walls and windows: lit from the side each face looks at
  // (not their glass: its reflection keeps the occlusion of the cell it sits in, as every other pane)
  for (const root of dynamic) root.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && !m.lightMap && !m.transparent && !(m.transmission > 0)) sided.add(m); });
  const register = object => {
    if (!object || disposed) return;
    object.traverse(o => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!m?.isMeshStandardMaterial || m.lightMap || m.isFogVolumeMaterial || !volume) continue;
        if (!hooks.has(m) && !m.userData.probeLit) {
          hooks.set(m, { compile: m.onBeforeCompile, key: m.customProgramCacheKey, emission: m.emissiveIntensity, bakedHooks: m.bakedHooks });
          if (!emitsLight(m)) m.emissiveIntensity = 0;
          probeLit(m, volume, pcss, sided.has(m)); probeLitCount++;
        }
        if (envTarget) setEnv(m);
      }
    });
    if (stats) stats.probeLit = probeLitCount;
    if (object === scene) pcss.invalidate(); else pcss.track(object, true);   // pets, the visitor: always-hot casters
  };
  const setEnv = m => {
    if (!envs.has(m)) envs.set(m, { map: m.envMap, intensity: m.envMapIntensity, rotation: m.envMapRotation?.clone() });
    if (m.envMap !== envTarget.texture) m.needsUpdate = true;
    m.envMap = envTarget.texture; m.envMapIntensity = 1; m.envMapRotation?.set(0, 0, 0);
  };
  if (volume) {
    foliage = await bakeFoliage(scene, asset(`${dir}/${slot}/foliage.bin.gz`), volume, foliageData ?? undefined);
    volume.fill(lampLevel); register(scene);
  }
  volumeRef = volume;
  // every visible lit mesh left without a lightmap, by why: plant, glass, movable, dynamic (animated or toggled: no id),
  // skipped by unwrap.py (ground, far), unmatched (an id the sidecar does not know: the bake is older than the scene)
  const unlit = {}, skipped = header.skipped ?? {}, shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  for (const o of meshes) {
    const ms = [].concat(o.material); if (!shown(o) || !ms.some(m => m?.isMeshStandardMaterial && !m.lightMap)) continue;
    const m = ms[0] ?? {}, id = o.userData.lmId;
    const why = m.transmission > 0 || m.transparent ? 'glass' : m.alphaTest > 0 || /^(garden-|plant)/.test(m.name || '') ? 'plant'
      : doorParts.has(o) ? 'door' : sharedUV.has(o) ? 'sharedUV' : o.userData.lmSkip ?? (!id ? 'dynamic' : skipped[id] ?? (header.units.some(u => u.id) ? 'unmatched' : 'nobake'));
    unlit[why] = (unlit[why] ?? 0) + 1;
  }
  // main calls after layout.animate, garden wind and all interaction/parent transform updates.
  // switch levels follow the switches (and the slot's default switch set, blended through a slot fade)
  const updateGroups = dt => { if (!groups) return; const fade = slots?.uniforms.uSlotBlend.value ?? 0; groups.update(dt, slots?.name ?? slot, fade > 0 ? slots.desired : undefined, fade); groups.applyGlow(); syncEmissionCopies(slots?.params.lamps ?? lamps); };
  // Fragment sampler audit (sampler_budget.js), once a second over the programs linked since: stats.samplers holds the
  // most samplers any baked program uses. A baked program that still failed to link over the texture units (the
  // estimate missed) has its materials compile again with a lower limit, so the next fit leaves more out.
  let auditClock = 1;
  const audit = () => {
    const a = auditPrograms(renderer);
    for (const f of a.failed) {
      if (f.handled) continue; f.handled = true;
      if (!/texture image units|samplers?/i.test(f.log)) { console.warn(`baked shader "${f.name}" failed to link:`, f.log); continue; }
      for (const m of [...mats.values(), ...hooks.keys()]) {
        if (renderer.properties.get(m).currentProgram !== f.program || (m.userData.samplerCut ?? 0) >= 8) continue;
        m.userData.samplerCut = (m.userData.samplerCut ?? 0) + 2; m.needsUpdate = true;
        console.warn(`baked shader "${m.name || m.type}": over the GPU's fragment texture units after linking; recompiling with ${m.userData.samplerCut} fewer`);
      }
    }
    if (stats) stats.samplers = { max: a.max, limit: a.limit, worst: a.worst, programs: a.programs, failed: a.failed.map(f => f.name) };
  };
  const checkPatches = () => assertShaderPatches(patchStart);
  // After startup a late failure (a pet, the visitor, a mirror compiled on first sight) leaves that one material stock:
  // shaderPatch already warned once, and dropping the whole walk to legacy mid-visit is the worse outcome.
  const updateMovables = dt => { if (!disposed) { slots?.update(dt); autoExposure?.update(dt); pcss.update(dt); if (slots) setFixtureGlow(slots.params.lamps); updateGroups(dt); if ((auditClock += dt) >= 1 && renderer.info?.programs && renderer.getContext) { auditClock = 0; audit(); } } };
  stats = { units: header.units.length, matched, byId: matched - byBox, byBox, unusedUnits: header.units.length - matched, unlit, triangles, materials: mats.size, movables: movables.length, probes: probes ? probes.N : 0, probeLit: probeLitCount, foliage, ms: Math.round(performance.now() - t0) };
  const atlasStats = () => { if (v2) Object.assign(stats, { resolution, atlas: [target.texture.image.width, target.texture.image.height], atlasMiB: atlasMiB(target.texture.image.width, target.texture.image.height) * (enc ? 4 / 3 : 1), mips: target.texture.userData.mips ?? null }); stats.shadowSize = shadowSize; };
  atlasStats();
  if (skyBg) skyBg.mapping = THREE.EquirectangularReflectionMapping;
  // after the walkthrough sets its time of day: the bake's sun, its sky as the background, and a Blender-like grade
  let groupsReset = false;
  const afterTime = () => {
    if (disposed) return;
    if (groups && !groupsReset) { groupsReset = true; groups.reset(slots?.name ?? slot); updateGroups(0); }
    const mood = slots?.params ?? SLOTS[slot];
    const raw = new URLSearchParams(location.search).has('rawtone'), e = raw ? 1 : Math.pow(2, mood.ev);
    Object.assign(lighting.tune, { dayOutdoor: e, dayIndoor: e });
    applyBakedSun(lighting, renderer, mood, shadowSize);
    pcss.render();
    if (skyBg) {
      scene.background = skyBg; scene.backgroundIntensity = 1; scene.backgroundRotation.set(0, 0, 0);
      // reflections of the bake's sunrise sky (dimmed per pixel by the baked light that reaches it), not the midday map
      if (!envTarget) { const pmrem = new THREE.PMREMGenerator(renderer); try { envTarget = pmrem.fromEquirectangular(skyBg); slots?.setEnvironment(envTarget); } finally { pmrem.dispose(); } }
      scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial && (m.lightMap || m.userData.probeLit)) setEnv(m); });
    }
    if (skyBg && !windows) { windows = addWindowReflections(scene, skyBg, refl); stats.windowPanes = windows.count; stats.reflectionProbes = refl?.count ?? 0; }
    // the bake already holds the ambient occlusion; the live pass stays only for contact shadows
    if (lighting.gtao) lighting.gtao.blendIntensity = 0.35;
    // no lifted blacks; with three's AgX (?agx=three) more contrast and a little saturation stand in for Blender's
    // "Medium High Contrast" look, which Blender's own AgX (agx.js) already applies
    const threeAgX = new URLSearchParams(location.search).get('agx') === 'three';
    lighting.grade.lift.value = 0; lighting.grade.contrast.value = threeAgX ? 1.16 : 1; lighting.grade.saturation.value = threeAgX ? 1.08 : 1;
    lighting.update(0, true);   // snap the exposure instead of easing toward it
    if (new URLSearchParams(location.search).has('sunoff')) lighting.sun.intensity = 0;   // debugging: lightmaps and probes only
    // ?rawtone: plain sRGB of the linear frame, for calibrating against Blender's "Standard" view
    if (new URLSearchParams(location.search).has('rawtone')) {
      renderer.toneMapping = THREE.NoToneMapping; Object.assign(lighting.tune, { dayOutdoor: 1, dayIndoor: 1 }); lighting.update(0, true);
      Object.assign(lighting.grade, {}); lighting.grade.contrast.value = 1; lighting.grade.saturation.value = 1; lighting.grade.grain.value = 0;
    }
  };
  // Serialise atlas swaps: rapid J toggles keep only one pair in flight. Release GPU storage and decoded bitmaps.
  let wanted = resolution, pending = null;
  const setQuality = name => {
    if (disposed) return Promise.resolve();
    shadowSize = Math.min(TIERS[name].shadowMap, renderer.capabilities.maxTextureSize);
    const shadow = lighting.sun.shadow;
    if (shadow.mapSize.x !== shadowSize) { shadow.map?.dispose(); shadow.map = null; shadow.mapSize.set(shadowSize, shadowSize); shadow.needsUpdate = true; }
    pcss.setSize(shadowSize); pcss.setTier(name); stats.shadowSize = shadowSize;
    wanted = v2 && enc ? lmResolution(name) : 'full';
    groups?.setResolution(wanted).catch(err => console.warn('lamp groups: tier change failed', err));
    if (slots) return slots.setQuality(wanted);
    pending ??= (async () => {
      while (wanted !== resolution) {
        const next = wanted, pair = await loadAtlases(next);
        if (disposed || pair.res !== wanted || pair.res === resolution) { pair.forEach(disposeAtlas); if (disposed) break; continue; }   // superseded
        const old = layers.slice(); layers.splice(0, 2, ...pair); target.texture = pair[0]; lmUniforms.uLmLamps.value = pair[1];
        for (const m of mats.values()) m.lightMap = pair[0];
        old.forEach(disposeAtlas); resolution = pair.res; atlasStats();
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  let puddleRefl = null;
  const setFeatures = name => {
    tier = name;
    if (TIERS[name].puddles && !puddleRefl) { puddleRefl = createPuddles({ scene, renderer, wet: multi ? 1 : SLOTS[slot].wet, furniture: [...movables, ...dynamic] }); api.puddleRefl = puddleRefl; }
    puddleRefl?.setEnabled(TIERS[name].puddles && (!multi || slots.params.wet > 0));
  };
  if (agxLuts) await blenderAgX(lighting.outputPass, undefined, agxLuts);
  const autoExposure = createBakedAutoExposure({ renderer, lighting, getSlot: () => slots?.params ?? SLOTS[slot], getTier: () => tier });
  const restore = () => {
    if (disposed) return;
    if (slots) slots.restore();
    else for (const t of layers) t.userData.restore?.();
    if (!slots && v2 && enc) { const m = linearMips(renderer, layers, [enc.K.slot, enc.K.lamps]); for (const t of layers) t.userData.mips = m; }
    groups?.restore();
    pcss.invalidate(); lighting.sun.shadow.needsUpdate = true;
    if (!slots) { envTarget?.dispose(); envTarget = null; }
    afterTime(); };
  renderer.domElement?.addEventListener('webglcontextrestored', restore);
  const dispose = () => {
    if (disposed) return; disposed = true;
    renderer.domElement?.removeEventListener('webglcontextrestored', restore);
    autoExposure?.dispose();
    scene.userData.contact?.dispose(); restoreEmission?.();
    Object.assign(lighting.tune ?? {}, legacyTune);
    for (const [k, v] of Object.entries(legacyGrade)) lighting.grade[k].value = v;
    renderer.toneMapping = legacyTone; renderer.toneMappingExposure = legacyExposure;
    if (lighting.gtao) lighting.gtao.blendIntensity = legacyAO;
    lighting.sun.shadow.camera.copy(legacySunCamera); lighting.sun.shadow.needsUpdate = true;
    if (api.shafts) { (lighting.taa?.internal ?? lighting.composer)?.removePass(api.shafts); api.shafts.dispose(); }
    if (legacyShadow === undefined) delete lighting.sun.userData.bakedShadow; else lighting.sun.userData.bakedShadow = legacyShadow;
    groups?.dispose(); puddleRefl?.dispose(); windows?.dispose(); pcss.dispose(); if (!slots) envTarget?.dispose();
    if (multi || scene.background === skyBg) scene.background = originalBackground;
    if (slots) slots.dispose();
    else { skyBg?.dispose(); refl?.uniforms.uReflTex.value.dispose();
      for (const u of Object.values(volume?.uniforms ?? {})) if (u.value?.isTexture) u.value.dispose(); }
    for (const [m, e] of envs) { m.envMap = e.map; m.envMapIntensity = e.intensity; if (e.rotation) m.envMapRotation.copy(e.rotation); m.needsUpdate = true; }
    for (const [m, h] of hooks) { m.onBeforeCompile = h.compile; m.customProgramCacheKey = h.key; m.emissiveIntensity = h.emission; delete m.userData.probeLit; if (h.bakedHooks) m.bakedHooks = h.bakedHooks; else delete m.bakedHooks; m.needsUpdate = true; }
    foliage?.dispose();
    for (const [o, s] of originalMeshes) { o.geometry.dispose(); o.geometry = s.geometry; o.material = s.material; o.castShadow = s.castShadow; }
    for (const [o, v] of shadowCasters) if (!originalMeshes.has(o)) o.castShadow = v;
    for (const [l, v] of lightVisibility) l.visible = v;
    for (const m of mats.values()) m.dispose();
    if (!slots) layers.forEach(disposeAtlas);
  };
  if (groups) stats.lampGroups = { groups: groupMeta.groups.length, textures: groupMeta.textures, switches: groups.switches, matched: groups.matched, resolution: groups.resolution, probes: !!groups.probeSH, mips: groups.texture?.userData.mips ?? null };
  const api = { checkPatches, warmDepth: async () => { await pcss.warm(); checkPatches(); }, lampGroups: groups, stats, auditSamplers: () => { audit(); return stats.samplers; }, combine, target, slot: SLOTS[slot], slotName: slot, availableSlots, sunShadow: pcss, updateMovables, afterTime, setQuality, register, dispose, puddleRefl, setFeatures };
  // Fixture switches update before this hook each frame. Apply the preset's physical lamp glow last.
  // With lamp groups each switch drives its own fixtures' glow (groups.applyGlow); the preset level only applies to the
  // single shared lamps layer. Either way the lightmapped copies (what actually renders) follow their sources afterwards.
  const setFixtureGlow = level => {
    if (!groups) for (const { toggle } of lighting.lightSwitches ?? []) for (const g of toggle.glows) {
      const property = g.wash ? 'opacity' : 'emissiveIntensity';
      g.material[property] = (g.wash ? g.base : g.base * 1.8) * level * (toggle.manual ? toggle.value : 1);
    }
    syncEmissionCopies(level);
  };
  if (multi) {
    const stageSlot = async (name, res, onProgress) => {
      const progress = createSlotProgress(onProgress), track = work => progress.track(work);
      const meta = await track(() => fetch(asset(`${dir}/${name}/encoding.json`)).then(r => r.ok ? r.json() : null));
      if (!validEncoding(meta)) throw Error('Invalid destination encoding');
      const results = await Promise.allSettled([
        loadAtlases(res, name, meta, track), loadProbes(asset(`${base}/${name}/probes.bin`), track),
        track(() => new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(asset(`${base}/${name}/sky_bg.hdr`))),
        loadReflections(`${base}/${name}/refl`, asset, track), loadFoliage(asset(`${dir}/${name}/foliage.bin.gz`), track),
      ]);
      const cleanup = () => { if (results[0].status === 'fulfilled') results[0].value.forEach(disposeAtlas); if (results[2].status === 'fulfilled') results[2].value.dispose(); if (results[3].status === 'fulfilled') results[3].value.uniforms.uReflTex.value.dispose(); };
      if (results.some(r => r.status === 'rejected')) { cleanup(); throw results.find(r => r.status === 'rejected').reason; }
      const [pair, P, sky, reflections, fol] = results.map(r => r.value);
      sky.mapping = THREE.EquirectangularReflectionMapping;
      let nextVolume, env;
      try {
        nextVolume = buildProbeVolume(P, groups, walls); nextVolume.fill(SLOTS[name].lamps);
        const pmrem = new THREE.PMREMGenerator(renderer); try { env = pmrem.fromEquirectangular(sky); } finally { pmrem.dispose(); }
        progress.finish();
        return { name, enc: meta, layers: pair, volume: nextVolume, sky, refl: reflections, foliage: fol, env, resolution: pair.res,
          remip: () => linearMips(renderer, pair, [meta.K.slot, meta.K.lamps]) };
      } catch (err) { cleanup(); env?.dispose(); for (const u of Object.values(nextVolume?.uniforms ?? {})) if (u.value?.isTexture) u.value.dispose(); throw err; }
    };
    const initialLayers = layers.slice(), initialK = [enc.K.slot, enc.K.lamps];
    slots = createSlotRuntime({ scene, renderer, available: availableSlots, load: stageSlot, disposeAtlas, foliage,
      initial: { name: slot, enc, layers, volume, sky: skyBg, refl, foliage: foliageData, resolution,
        remip: () => linearMips(renderer, initialLayers, initialK) },
      setParams(mood) {
        const raw = new URLSearchParams(location.search).has('rawtone');
        applyBakedSun(lighting, renderer, raw ? { ...mood, ev: 0 } : mood, shadowSize); pcss.invalidate();
        if (raw) renderer.toneMapping = THREE.NoToneMapping;
        if (new URLSearchParams(location.search).has('sunoff')) lighting.sun.intensity = 0;
        const exposure = raw ? 1 : 2 ** mood.ev; Object.assign(lighting.tune, { dayOutdoor: exposure, dayIndoor: exposure });
        for (const [m, w] of weather) { m.color.copy(w.color); m.roughness = w.roughness; wetten(m, w.cls, mood.wet); }
        puddleRefl?.setEnabled(TIERS[tier].puddles && mood.wet > 0);
        lighting.update(0, true);
        setFixtureGlow(mood.lamps);
      },
      commit(data) {
        const changedSlot = slot !== data.name;   // quality reloads and context restores keep manual switches
        slot = data.name; enc = data.enc; skyBg = data.sky; resolution = data.resolution;
        layers.splice(0, 2, ...data.layers); target.texture = data.layers[0];
        lmUniforms.uLmK.value.set(enc.K.slot, enc.K.lamps); lmUniforms.uLmLamps.value = data.layers[1];
        for (const m of mats.values()) m.lightMap = target.texture;
        envTarget = data.env ?? envTarget;
        scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial && (m.lightMap || m.userData.probeLit)) setEnv(m); });
        api.slot = SLOTS[slot]; api.slotName = slot; atlasStats();
        if (groups) { if (changedSlot) groups.reset(slot); updateGroups(0); }   // only a new slot restores defaults
      },
    });
    volume.slots = slots; Object.assign(lmUniforms, slots.uniforms);
  }
  // Optional callback: (fraction, { name, loaded, total, phase }); transition marks the start of the fade.
  api.setSlot = (name, onProgress) => slots ? slots.request(name, onProgress) : Promise.resolve(name === slot);
  api.nextSlot = () => nextSlot(slots?.desired ?? slot, availableSlots);
  try {
    const materials = new Set([...mats.values(), ...hooks.keys(), ...pcss.depthEntries().map(e => e.material)]);
    for (const m of materials) {
      const lib = m.isMeshDepthMaterial ? THREE.ShaderLib.depth : m.isMeshPhysicalMaterial ? THREE.ShaderLib.physical : THREE.ShaderLib.standard;
      m.onBeforeCompile({ uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader }, renderer);
      checkPatches(); await shaderYield();
    }
  } catch (err) { dispose(); throw err; }
  return api;
}

// Probe grid for movable objects: per point, order-2 SH of incoming radiance (three's basis and frame) per layer.
async function loadProbes(url, track = work => work()) {
  const buf = await track(async () => {
    const response = await fetch(url); if (!response.ok) throw new Error(`probes ${response.status}: ${url}`);
    return response.arrayBuffer();
  });
  const hl = new DataView(buf).getUint32(0, true), header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  const N = header.count; let o = 4 + hl;
  const valid = new Uint8Array(buf.slice(o, o + N)); o += N; o = (o + 3) & ~3;
  const layers = {}; for (const l of header.layers) { layers[l] = new Float32Array(buf.slice(o, o + N * 27 * 4)); o += N * 27 * 4; }
  if (!Number.isInteger(N) || N < 4 || o !== buf.byteLength || valid.length !== N || valid.filter(Boolean).length < 4 || !['sky', 'sunind', 'lamps'].every(l => layers[l]?.length === N * 27) || !header.points || header.points.length !== N) throw new Error('Invalid baked probes');
  const points = new Float32Array(header.points.flat());
  return { N, valid, layers, points };
}

// ---- Reflection probes: full-lighting panoramas baked in Blender at points through the house and garden, each with a
// box from raycasts to its surroundings. Per pixel: the probe whose box holds the point (else the nearest), the
// reflected ray intersected with that box and looked up from the probe's centre (parallax correction), sampled at a
// blur level set by roughness. The patio then reflects the house and chairs, floors their own room, windows the garden.
async function loadReflections(dir, asset, track = work => work()) {
  const meta = (await track(async () => {
    const response = await fetch(asset(`${dir}/meta.json`)); if (!response.ok) throw new Error(`reflections ${response.status}`);
    return response.json();
  })).sort((a, b) => a.i - b.i);
  if (!meta.length || meta.some(m => !['p', 'min', 'max'].every(k => m[k]?.length === 3 && m[k].every(Number.isFinite)))) throw new Error('Invalid reflection metadata');
  const { w, h, n, data } = await loadPanoramas(meta.map(m => asset(`${dir}/probe_${String(m.i).padStart(2, '0')}.hdr`)), track);
  const tex = new THREE.DataArrayTexture(data, w, h, n);
  Object.assign(tex, { format: THREE.RGBAFormat, type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
  tex.needsUpdate = true;
  // Flat Float32Arrays, not Vector3 arrays: three re-uploads a material's uniforms on every material switch, and an
  // array of vectors is first copied element by element into a scratch buffer each time (3 x 26 vectors, ~650 switches
  // in the garden view: ~10 ms of its frame). A typed array goes to WebGL as it is.
  const v3 = k => Float32Array.from(meta.flatMap(m => m[k]));
  return { count: n, key: String(n), uniforms: { uReflTex: { value: tex }, uReflPos: { value: v3('p') }, uReflMin: { value: v3('min') }, uReflMax: { value: v3('max') }, uReflMips: { value: Math.floor(Math.log2(Math.max(w, h))) } } };
}
// Equirect HDR panoramas -> one half-float RGBA buffer of layers, rows bottom-up (v = 0 first), as an array texture is
// uploaded without flipY.
async function loadPanoramas(urls, track) {
  const results = await Promise.allSettled(urls.map(url => track(() => new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(url))));
  if (results.some(r => r.status === 'rejected')) { for (const r of results) if (r.status === 'fulfilled') r.value.dispose(); throw results.find(r => r.status === 'rejected').reason; }
  const maps = results.map(r => r.value);
  const w = maps[0].image.width, h = maps[0].image.height, n = maps.length;
  if (maps.some(t => t.image.width !== w || t.image.height !== h || t.image.data.length !== w * h * 4)) { maps.forEach(t => t.dispose()); throw new Error('Invalid reflection image dimensions'); }
  const data = new Uint16Array(w * h * 4 * n);
  maps.forEach((t, k) => {
    const src = t.image.data, ch = src.length / (w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = ((h - 1 - y) * w + x) * ch, di = ((k * h + y) * w + x) * 4;
      data[di] = src[si]; data[di + 1] = src[si + 1]; data[di + 2] = src[si + 2]; data[di + 3] = 0x3c00;
    }
    t.dispose();
  });
  return { w, h, n, data };
}
// Lamp reflections (reflprobe.py --lamps, lamp_groups_pack.py refl): per reflection probe, panoramas of its brightest
// lamp groups alone and one of its other visible groups, at the bake's physical level (no sky, no sun). The daylight
// probes hold no lamp light; each lamp layer adds its light weighed by its groups' live levels (switches, slot defaults,
// fades), so a mirror shows only the lamps that are on. Layers are matched to groups by name: the group count may change.
// Which set: every layer (hq), or one panorama per probe with all its lamps (laptop, mobile: a third of the memory, its
// weight the light-weighted level of its groups); ?refllamps=all|merged|0 overrides.
const lampReflSet = tier => {
  const q = new URLSearchParams(location.search).get('refllamps');
  if (['0', 'off'].includes(q)) return null;
  return q === 'all' || q === 'merged' ? q : tier === 'hq' ? 'all' : 'merged';
};
async function loadLampReflections(dir, asset, groupMeta, set = 'all', track = work => work()) {
  const full = await track(async () => {
    const r = await fetch(asset(`${dir}/lampgroups/${groupMeta.refl.meta}`)); if (!r.ok) throw new Error(`lamp reflections ${r.status}`);
    return r.json();
  });
  const meta = set === 'merged' && Array.isArray(full?.merged) ? { ...full, layers: full.merged } : full;
  const index = new Map(groupMeta.groups.map(g => [g.name, g.index]));
  if (meta?.version !== 1 || !Number.isInteger(meta.probes) || !Array.isArray(meta.layers) || !meta.layers.length ||
      meta.layers.some((l, i) => !Number.isInteger(l.probe) || l.probe < 0 || l.probe >= meta.probes || (i && l.probe < meta.layers[i - 1].probe) || typeof l.file !== 'string' || !l.groups || !Object.keys(l.groups).length))
    throw new Error('Invalid lamp reflection metadata');
  const range = new Float32Array(2 * meta.probes); let max = 0;
  meta.layers.forEach((l, i) => { if (!range[2 * l.probe + 1]) range[2 * l.probe] = i; max = Math.max(max, ++range[2 * l.probe + 1]); });
  const mix = meta.layers.map(l => Object.entries(l.groups).filter(([name, f]) => index.has(name) && f > 0).map(([name, f]) => [index.get(name), f]));
  const unknown = new Set(meta.layers.flatMap(l => Object.keys(l.groups)).filter(n => !index.has(n)));
  if (unknown.size) console.warn('lamp reflections: unknown lamp groups', [...unknown]);
  const { w, h, n, data } = await loadPanoramas(meta.layers.map(l => asset(`${dir}/lampgroups/refl/${l.file}`)), track);
  return { count: n, max, probes: meta.probes, w, h, data, range, mix };
}
// The lamp layers join the probes' array texture after the daylight layers (one sampler for both); in a multi-slot
// site after both slot halves (lightmap_slots.js reflArray). Weights per layer follow the lamp groups' levels.
function attachLampReflections(refl, lamps, groups, multi) {
  const day = refl.uniforms.uReflTex.value;
  if (lamps.probes !== refl.count || lamps.w !== day.image.width || lamps.h !== day.image.height) { console.warn('lamp reflections do not match the reflection probes: daylight reflections only'); return; }
  const weights = new Float32Array(4 * Math.ceil(lamps.count / 4));
  const update = () => { lamps.mix.forEach((m, l) => { let w = 0; for (const [g, f] of m) w += groups.levels[g] * f; weights[l] = w; }); };
  Object.assign(refl.uniforms, { uReflLamp: { value: lamps.range }, uReflLampW: { value: weights }, uReflLampBase: { value: (multi ? 2 : 1) * refl.count } });
  refl.lamps = { count: lamps.count, max: lamps.max, data: lamps.data };
  refl.key = `${refl.count}:${lamps.count}:${lamps.max}`;
  update(); groups.volumes.add(update);
  if (!multi) {
    const layer = day.image.width * day.image.height * 4, data = new Uint16Array(layer * (refl.count + lamps.count));
    data.set(day.image.data); data.set(lamps.data, layer * refl.count);
    const t = new THREE.DataArrayTexture(data, day.image.width, day.image.height, refl.count + lamps.count);
    for (const k of ['format', 'type', 'generateMipmaps', 'minFilter', 'magFilter', 'wrapS', 'wrapT']) t[k] = day[k];
    t.needsUpdate = true; day.dispose(); refl.uniforms.uReflTex.value = t;
  }
}
// With slots, the current and the next slot are two halves of one array (lightmap_slots.js): one sampler, the layer
// offsets uReflBase / uReflNext pick the halves, and the second read happens only during a fade.
// Mirrors need a small edge allowance without reaching through a bedroom partition.
const reflGLSL = (n, slots = false, mirror = false, lamps = null) => `
#define REFL_COUNT ${n}
${slots ? 'uniform float uReflBlend; uniform float uReflBase; uniform float uReflNext;' : ''}
${lamps ? `uniform vec2 uReflLamp[ REFL_COUNT ]; uniform vec4 uReflLampW[ ${Math.ceil(lamps.count / 4)} ]; uniform float uReflLampBase;` : ''}
uniform highp sampler2DArray uReflTex; uniform vec3 uReflPos[ REFL_COUNT ]; uniform vec3 uReflMin[ REFL_COUNT ]; uniform vec3 uReflMax[ REFL_COUNT ]; uniform float uReflMips;
vec3 reflProbe( vec3 P, vec3 R, float rough ) {
  // the probe whose box holds the point (a small allowance for surfaces on its faces), then one whose box holds it with
  // a wider margin, then the nearest: a margin alone let a probe reach through a partition into the next room
  int best = 0; float bestScore = 1e9;
  for ( int i = 0; i < REFL_COUNT; i ++ ) {
    vec3 size = uReflMax[ i ] - uReflMin[ i ];
    if ( min( size.x, size.z ) < 0.3 ) continue;   // wall slivers contain mostly black reflections
    bool inBox = all( greaterThanEqual( P, uReflMin[ i ] - 0.03 ) ) && all( lessThanEqual( P, uReflMax[ i ] + 0.03 ) );
    bool nearBox = all( greaterThanEqual( P, uReflMin[ i ] - ${mirror ? '0.03' : '0.25'} ) ) && all( lessThanEqual( P, uReflMax[ i ] + ${mirror ? '0.03' : '0.25'} ) );
    float score = distance( P, uReflPos[ i ] ) + ( inBox ? 0.0 : nearBox ? 100.0 : 1000.0 );
    if ( score < bestScore ) { bestScore = score; best = i; }
  }
  vec3 dir = R;
  if ( bestScore < 1000.0 ) {
    float nearT = -1e20, farT = 1e20; bool hit = true;
    for ( int axis = 0; axis < 3; axis ++ ) {
      float lo = uReflMin[ best ][ axis ], hi = uReflMax[ best ][ axis ];
      if ( abs( R[ axis ] ) < 1e-7 ) {
        if ( P[ axis ] < lo || P[ axis ] > hi ) hit = false;
      } else {
        float a = ( lo - P[ axis ] ) / R[ axis ], b = ( hi - P[ axis ] ) / R[ axis ];
        nearT = max( nearT, min( a, b ) ); farT = min( farT, max( a, b ) );
      }
    }
    if ( hit && farT >= max( nearT, 0.0 ) ) {
      vec3 projected = P + R * farT - uReflPos[ best ];
      if ( dot( projected, projected ) > 1e-12 ) dir = normalize( projected );
    }
  }
  vec2 uv = vec2( atan( dir.z, dir.x ) * 0.15915494 + 0.5, asin( clamp( dir.y, -1.0, 1.0 ) ) * 0.31830989 + 0.5 );
  float reflLod = clamp( rough, 0.0, 1.0 ) * uReflMips;
  ${slots ? `vec3 refl = textureLod( uReflTex, vec3( uv, float( best ) + uReflBase ), reflLod ).rgb;
  if ( uReflBlend > 0.0 ) refl = mix( refl, textureLod( uReflTex, vec3( uv, float( best ) + uReflNext ), reflLod ).rgb, uReflBlend );` : 'vec3 refl = textureLod( uReflTex, vec3( uv, float( best ) ), reflLod ).rgb;'}
  ${lamps ? `// the probe's lamp layers, each at its groups' switch levels (skipped while they are off)
  vec2 lampRange = uReflLamp[ best ];
  for ( int k = 0; k < ${lamps.max}; k ++ ) {
    if ( float( k ) >= lampRange.y ) break;
    int l = int( lampRange.x ) + k; float w = uReflLampW[ l >> 2 ][ l & 3 ];
    if ( w > 0.0 ) refl += w * textureLod( uReflTex, vec3( uv, uReflLampBase + float( l ) ), reflLod ).rgb;
  }` : ''}
  return refl;
}
`;
// the reflection term for a patched material: world position varying + the lookup in place of three's sky map
// three's clearcoat image-based light (lights_fragment_maps): unpatched, it adds the open sunrise sky to every clearcoated
// surface indoors (the quartz counters read 0.57 linear with the lamps off, Cycles 0.009)
const CLEARCOAT_IBL = 'clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );';
// A mirror shows the room's probe at full strength: the probe already holds the room's light and occlusion, and the
// specular-occlusion guess (baked irradiance at the glass) would darken it to near black in a dim bathroom.
const isMirror = m => m?.name === 'mirror';
function reflPatch(sh, refl, occlusion, mirror = false) {
  Object.assign(sh.uniforms, refl.uniforms);
  if (!sh.vertexShader.includes('varying vec3 vReflWorld')) sh.vertexShader = 'varying vec3 vReflWorld;\n' + rep(sh.vertexShader, '#include <project_vertex>', `#include <project_vertex>
    vec4 reflPosition = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      reflPosition = batchingMatrix * reflPosition;
    #endif
    #ifdef USE_INSTANCING
      reflPosition = instanceMatrix * reflPosition;
    #endif
    vReflWorld = ( modelMatrix * reflPosition ).xyz;`, 'reflection vertex');
  sh.fragmentShader = 'varying vec3 vReflWorld;\n' + reflGLSL(refl.count, !!refl.slots, mirror, refl.lamps) + rep(sh.fragmentShader, /radiance \+= getIBLRadiance\( geometryViewDir, geometryNormal, material\.roughness \)[^;]*;/,
    `{ vec3 nW = inverseTransformDirection( geometryNormal, viewMatrix ), rW = inverseTransformDirection( reflect( - geometryViewDir, geometryNormal ), viewMatrix );
       rW = normalize( mix( rW, nW, material.roughness * material.roughness ) );
       radiance += reflProbe( vReflWorld, rW, material.roughness ) * ${occlusion}; }`, 'reflection radiance');
  // the clearcoat layer (quartz counters, tiles, ceramics) reflects the same room, not the open sky environment
  if (sh.fragmentShader.includes(CLEARCOAT_IBL.slice(0, -1))) sh.fragmentShader = rep(sh.fragmentShader, /clearcoatRadiance \+= getIBLRadiance\( geometryViewDir, geometryClearcoatNormal, material\.clearcoatRoughness \)[^;]*;/,
    `{ vec3 nW = inverseTransformDirection( geometryClearcoatNormal, viewMatrix ), rW = inverseTransformDirection( reflect( - geometryViewDir, geometryClearcoatNormal ), viewMatrix );
       rW = normalize( mix( rW, nW, material.clearcoatRoughness * material.clearcoatRoughness ) );
       clearcoatRadiance += reflProbe( vReflWorld, rW, material.clearcoatRoughness ) * ${occlusion}; }`, 'reflection clearcoat');
}

// ---- Probe volume: the probe grid resampled onto a regular 0.5 m 3D texture over the lot (three heights), first-order
// spherical harmonics per colour. Every lit surface without a lightmap (plants, the few unmatched meshes, movable
// furniture, pets) samples it per pixel by world position, so a carried chair or a cat takes the baked light of
// wherever it is, and foliage is lit by the same sunrise sky as the bake instead of the walkthrough's midday sky map.
const VOL = { x0: -12.5, x1: 12.5, y0: -11.5, y1: 15.5, step: 0.5, heights: [0.35, 0.95, 1.55] };
// Plan pieces already exclude openings (solid sides, sills and lintels). Inset 1 cm to allow face contact.
const probeWalls = pieces => pieces.map(p => [p.x0 + 0.01, p.x1 - 0.01, p.z0 + 0.01, p.z1 - 0.01, -p.y1 + 0.01, -p.y0 - 0.01]).filter(b => b[0] < b[1] && b[2] < b[3] && b[4] < b[5]);
function probeBlocked(px, py, pz, qx, qy, qz, walls) {
  const x0 = Math.min(px, qx), x1 = Math.max(px, qx), y0 = Math.min(py, qy), y1 = Math.max(py, qy), z0 = Math.min(pz, qz), z1 = Math.max(pz, qz);
  const dx = qx - px, dy = qy - py, dz = qz - pz;
  for (const b of walls) {
    if (x1 < b[0] || x0 > b[1] || y1 < b[2] || y0 > b[3] || z1 < b[4] || z0 > b[5]) continue;
    let lo = 0, hi = 1;
    for (let a = 0; a < 3; a++) {
      const p = a === 0 ? px : a === 1 ? py : pz, d = a === 0 ? dx : a === 1 ? dy : dz;
      if (d === 0) { if (p < b[a * 2] || p > b[a * 2 + 1]) { hi = -1; break; } }
      else { const t0 = (b[a * 2] - p) / d, t1 = (b[a * 2 + 1] - p) / d; lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); }
      if (lo > hi) break;
    }
    if (lo <= hi) return true;
  }
  return false;
}
function buildProbeVolume(P, groups = null, walls = []) {
  const NX = Math.round((VOL.x1 - VOL.x0) / VOL.step) + 1, NZ = Math.round((VOL.y1 - VOL.y0) / VOL.step) + 1, NY = VOL.heights.length;
  const valid = []; for (let i = 0; i < P.N; i++) if (P.valid[i]) valid.push(i);
  // Walk outwards in x: once dx alone exceeds the 16th distance, all remaining probes are farther away.
  valid.sort((a, b) => P.points[a * 3] - P.points[b * 3] || a - b);
  const starts = new Int32Array(NX); let start = 0;
  for (let x = 0; x < NX; x++) { while (start < valid.length && P.points[valid[start] * 3] < VOL.x0 + x * VOL.step) start++; starts[x] = start; }
  // Test only the nearest 16, stopping at 4 visible probes; reuse scratch storage across cells.
  const K = Math.min(16, valid.length), ids = new Int32Array(K), ds = new Float64Array(K), picks = new Int32Array(4);
  // per cell, the 4 nearest visible probes and their weights (fixed); the lamp level only changes the sum
  const near = new Int32Array(NX * NZ * NY * 4), wts = new Float32Array(NX * NZ * NY * 4);
  for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const px = VOL.x0 + x * VOL.step, py = VOL.heights[y], pz = -(VOL.y0 + z * VOL.step);
    ds.fill(Infinity);
    let left = starts[x] - 1, right = starts[x];
    while (left >= 0 || right < valid.length) {
      const dl = left >= 0 ? px - P.points[valid[left] * 3] : Infinity, dr = right < valid.length ? P.points[valid[right] * 3] - px : Infinity;
      if (Math.min(dl * dl, dr * dr) > ds[K - 1]) break;
      const i = dl <= dr ? valid[left--] : valid[right++];
      const dx = P.points[i * 3] - px, dy = (P.points[i * 3 + 1] - py) * 2, dz = P.points[i * 3 + 2] - pz, d = dx * dx + dy * dy + dz * dz;
      if (d > ds[K - 1] || (d === ds[K - 1] && i >= ids[K - 1])) continue;
      let k = K - 1;
      while (k > 0 && (d < ds[k - 1] || (d === ds[k - 1] && i < ids[k - 1]))) { ds[k] = ds[k - 1]; ids[k] = ids[k - 1]; k--; }
      ds[k] = d; ids[k] = i;
    }
    let count = 0;
    for (let k = 0; k < K && count < 4; k++) {
      const i = ids[k] * 3;
      if (!probeBlocked(px, py, pz, P.points[i], P.points[i + 1], P.points[i + 2], walls)) picks[count++] = k;
    }
    // Inside walls (or outside the probe coverage), retain distance-only light if every candidate is blocked.
    if (!count) { count = 4; for (let k = 0; k < 4; k++) picks[k] = k; }
    const c = ((y * NZ + z) * NX + x) * 4; let sum = 0;
    for (let k = 0; k < 4; k++) { const j = picks[k % count]; near[c + k] = ids[j]; wts[c + k] = k < count ? 1 / (ds[j] + 0.02) : 0; sum += wts[c + k]; }
    for (let k = 0; k < 4; k++) wts[c + k] /= sum;
  }
  // One texture for the three colours: R, G and B stacked along its depth (3 x NY slices), one sampler per slot instead
  // of three (Apple GPUs allow 16 per fragment shader). PROBE_GLSL clamps the depth inside each colour's slices.
  // Half floats: linearly filtered in every WebGL2 (iOS has no OES_texture_float_linear), ample range for irradiance SH.
  const tex = new THREE.Data3DTexture(new Uint16Array(NX * NZ * NY * 3 * 4), NX, NZ, NY * 3);
  Object.assign(tex, { format: THREE.RGBAFormat, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, wrapR: THREE.ClampToEdgeWrapping, unpackAlignment: 1 });
  // lamp groups (lamp_groups.js): per group, its luminance SH resampled to the cells once; a fill weighs them by the
  // groups' levels and colours, so a switch refills the volume (lamp_groups.js volumes) in a few milliseconds
  const cells = NX * NZ * NY, sh = groups?.probeSH, G = sh ? groups.groups.length : 0, cellG = sh ? new Float32Array(G * cells * 4) : null;
  if (sh) for (let g = 0; g < G; g++) for (let c = 0; c < cells; c++) for (let k = 0; k < 4; k++) {
    let v = 0; for (let j = 0; j < 4; j++) v += wts[c * 4 + j] * sh[(g * P.N + near[c * 4 + j]) * 9 + k];
    cellG[(g * cells + c) * 4 + k] = v;
  }
  let last = 0;
  const fill = (lamps = last) => {
    last = lamps; const gw = sh ? groups.probeWeights : null;
    for (let c = 0; c < cells; c++) for (let ch = 0; ch < 3; ch++) for (let k = 0; k < 4; k++) {
      let v = 0;
      for (let j = 0; j < 4; j++) { const i = near[c * 4 + j], o = i * 27 + k * 3 + ch; v += wts[c * 4 + j] * (P.layers.sky[o] + P.layers.sunind[o] + (gw ? 0 : lamps * P.layers.lamps[o])); }
      if (gw) for (let g = 0; g < G; g++) { const w = gw[g * 3 + ch]; if (w) v += w * cellG[(g * cells + c) * 4 + k]; }
      tex.image.data[(ch * cells + c) * 4 + k] = toHalf(v);
    }
    tex.needsUpdate = true;
  };
  if (sh) { const refill = () => fill(); groups.volumes.add(refill); tex.addEventListener('dispose', () => groups.volumes.delete(refill)); }
  // texture coordinates: cell centres sit at the texel centres
  const uniforms = { uProbeSH: { value: tex },
    uProbeOrigin: { value: new THREE.Vector3(VOL.x0, VOL.heights[0], -VOL.y0) }, uProbeScale: { value: new THREE.Vector3(1 / VOL.step, 1 / (VOL.heights[1] - VOL.heights[0]), -1 / VOL.step) },
    uProbeDims: { value: new THREE.Vector3(NX, NY, NZ) } };
  return { fill, uniforms };
}
const toHalf = THREE.DataUtils.toHalfFloat;
const PROBE_GLSL = `
uniform highp sampler3D uProbeSH;
uniform vec3 uProbeOrigin; uniform vec3 uProbeScale; uniform vec3 uProbeDims;
varying vec3 vProbeWorld;
// x and north as texture coordinates, height in slices clamped to the first and last slice centres (as clamp-to-edge
// did for the separate textures), kept a hair inside so filtering never reaches the next colour's slices
vec3 probeUVW( vec3 p ) {
  vec3 g = ( p - uProbeOrigin ) * uProbeScale;              // grid units: x, height, z (north)
  return vec3( ( g.x + 0.5 ) / uProbeDims.x, ( g.z + 0.5 ) / uProbeDims.z, clamp( g.y, 0.01, uProbeDims.y - 1.01 ) );
}
vec4 probeTex( highp sampler3D t, vec3 uvw, float ch ) { return texture( t, vec3( uvw.xy, ( uvw.z + ch * uProbeDims.y + 0.5 ) / ( 3.0 * uProbeDims.y ) ) ); }
// colour ch (0 R, 1 G, 2 B) of the L1 SH; the slot runtime blends the next slot's volume in here
vec4 probeSH( vec3 uvw, float ch ) { return probeTex( uProbeSH, uvw, ch ); }
vec3 probeIrradiance( vec3 p, vec3 n ) {
  vec3 uvw = probeUVW( p );
  vec4 r = probeSH( uvw, 0.0 ), gg = probeSH( uvw, 1.0 ), b = probeSH( uvw, 2.0 );
  vec4 basis = vec4( 0.886227, 1.023328 * n.y, 1.023328 * n.z, 1.023328 * n.x );
  return max( vec3( dot( r, basis ), dot( gg, basis ), dot( b, basis ) ), 0.0 );
}
// The volume's cells are 0.5 m: one at a door, blind or curtain mixes the rooms (closet, garden) on both sides of it.
// A face that moves there is lit from a little way out (side, m) on the side it looks at, half way towards the viewer:
// a panel's bevels and a leaf's edges face along the doorway, and only the viewer says which room they are seen from.
vec3 probeIrradiance( vec3 p, vec3 n, float side ) { return probeIrradiance( p + normalize( n + normalize( cameraPosition - p ) + 1e-4 ) * side, n ); }
`;
// the side argument of the lookup above, for probeLit's sided materials: a full cell (0.5 m) out, so both cells the
// lookup blends lie on the face's side of the doorway (at 0.3 m a bath door took 14% from the sunlit bedroom behind it)
const PROBE_SIDE = ', 0.5';
function probeLit(material, volume, pcss, sided = false) {
  if (material.userData.probeLit) return;
  material.userData.probeLit = true;
  const leafSide = /^garden-/.test(material.name || '') ? ' * faceDirection' : '';
  const foliage = material.alphaTest > 0 || /^(garden-|plant)/.test(material.name || '');
  const occl = foliage && !material.foliageBake ? ' * mix( 0.45, 1.0, smoothstep( 0.0, 1.2, vProbeWorld.y ) )' : '';
  const wet = (volume.multi || volume.wet > 0) && !/^garden-/.test(material.name || '') && !(material.alphaTest > 0);
  const refl = volume.refl, sheer = !!material.userData.sheer, fol = material.foliageBake, mirror = isMirror(material);
  const side = sided && !sheer && !fol && !leafSide ? PROBE_SIDE : '';   // doors and toggles: lit from the side they face
  const prev = material.bakedHooks?.compile ?? material.onBeforeCompile, prevKey = material.bakedHooks?.key ?? shaderKey(material);
  material.bakedHooks = { compile: prev, key: prevKey };
  material.onBeforeCompile = function (sh, renderer) { shaderPatch(sh, 'probe ' + prevKey, s => {
    prev?.call(this, s, renderer);
    Object.assign(s.uniforms, volume.uniforms);
    s.vertexShader = 'varying vec3 vProbeWorld;\n' + rep(s.vertexShader, '#include <project_vertex>', `#include <project_vertex>
      vec4 probePosition = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        probePosition = batchingMatrix * probePosition;
      #endif
      #ifdef USE_INSTANCING
        probePosition = instanceMatrix * probePosition;
      #endif
      vProbeWorld = ( modelMatrix * probePosition ).xyz;`, 'probe vertex');
    let maps = rep(THREE.ShaderChunk.lights_fragment_maps, 'iblIrradiance += getIBLIrradiance( geometryNormal );',
      `irradiance += probeIrradiance( vProbeWorld, inverseTransformDirection( geometryNormal${leafSide}, viewMatrix )${side} )${occl};`, 'probe irradiance');
    maps = rep(maps, 'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
      `radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * clamp( dot( probeIrradiance( vProbeWorld, inverseTransformDirection( geometryNormal, viewMatrix )${side} ), vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.95, 0.0, 1.0 ) * smoothstep( -0.05, 0.35, inverseTransformDirection( reflect( - geometryViewDir, geometryNormal ), viewMatrix ).y );`, 'probe specular');
    maps = rep(maps, CLEARCOAT_IBL, CLEARCOAT_IBL.slice(0, -1) + ` * clamp( dot( probeIrradiance( vProbeWorld, inverseTransformDirection( geometryClearcoatNormal, viewMatrix )${side} ), vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.95, 0.0, 1.0 );`, 'probe clearcoat');
    s.fragmentShader = PROBE_GLSL + rep(s.fragmentShader, '#include <lights_fragment_maps>', maps, 'probe maps');
    if (wet) { wetPatch(s, volume.wet); if (volume.slots) s.uniforms.uWet = volume.slots.wet; }
    if (refl) reflPatch(s, refl, mirror ? '1.0' : `clamp( dot( probeIrradiance( vProbeWorld, nW${side} ), vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.95 + 0.25, 0.0, 1.0 )`, mirror);
    pcss.patch(s);
    if (sheer) sheerProbePatch(s, material);
    // last resort, the next slot's probe volume (its fade then jumps at the end)
    const drop = fitBaked(s, renderer, this ?? material, { name: 'slot crossfade', cost: volume.slots ? 1 : 0 });
    if (CONTACT) checkedContact(s, false, !drop.has('contact sun'));
    fol?.patch(s, !!refl);
    if (volume.slots) { if (fol) volume.slots.patchFoliage(s); if (!drop.has('slot crossfade')) volume.slots.patchProbe(s); }
  }); };
  material.customProgramCacheKey = function () { return prevKey + '|probe-v3:' + [leafSide, occl, wet, refl?.key ?? refl?.count ?? 0, CONTACT, sheer, !!fol, !!volume.multi, mirror, side, (this ?? material).userData.samplerCut ?? 0].join(':'); };
  material.needsUpdate = true;
}

// Window reflections. The walkthrough's glass is nearly transparent, and three scales a transparent surface's
// reflection by its opacity, so the panes reflected almost nothing. Real glass reflects about 4% head-on and far more
// at grazing angles regardless of what it lets through, so each pane gets an additive overlay: Schlick Fresnel times
// the bake's sky, with directions at or below the horizon taking the dark green of the garden instead.
function addWindowReflections(scene, sky, refl) {
  const material = new THREE.ShaderMaterial({
    uniforms: { tSky: { value: sky }, uGround: { value: new THREE.Color(0.035, 0.045, 0.03) }, ...(refl ? refl.uniforms : {}) },
    vertexShader: `varying vec3 vWorld; varying vec3 vNormalW;
      void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vWorld = w.xyz; vNormalW = normalize( mat3( modelMatrix ) * normal ); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `#include <common>
      ${refl ? reflGLSL(refl.count, !!refl.slots, false, refl.lamps) : ''}
      uniform sampler2D tSky; uniform vec3 uGround; varying vec3 vWorld; varying vec3 vNormalW;
      void main() {
        vec3 v = normalize( vWorld - cameraPosition ), n = normalize( vNormalW ) * ( gl_FrontFacing ? 1.0 : -1.0 );
        if ( dot( n, v ) > 0.0 ) n = -n;
        vec3 r = reflect( v, n );
        float c = clamp( dot( -v, n ), 0.0, 1.0 ), F = 0.04 + 0.96 * pow( 1.0 - c, 5.0 );
        vec2 uv = vec2( atan( r.z, r.x ) * RECIPROCAL_PI2 + 0.5, asin( clamp( r.y, -1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5 );
        vec3 refl = ${refl ? 'reflProbe( vWorld, r, 0.0 )' : 'mix( uGround, texture2D( tSky, uv ).rgb, smoothstep( -0.02, 0.25, r.y ) )'};
        gl_FragColor = vec4( F * refl, 1.0 );
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const panes = [], add = [];
  scene.traverse(o => { if (o.isMesh && !o.userData.reflection && [].concat(o.material).some(m => m?.userData?.daylightOpacity !== undefined || m?.transmission > 0)) add.push(o); });
  // a pane in a static subtree never recomposes its children's matrices (batch.js), so the overlay takes its world
  // matrix once here; left at identity it would float at the world origin (the pale rectangle on the kitchen island)
  for (const o of add) { const r = new THREE.Mesh(o.geometry, material); r.userData.reflection = true; r.renderOrder = (o.renderOrder || 0) + 1; r.raycast = () => {}; o.add(r); r.updateMatrixWorld(true); panes.push(r); }
  return { count: panes.length, dispose() { for (const r of panes) r.removeFromParent(); material.dispose(); } };
}

// Put the live sun where the bake had it (direct light only; its bounce is in the lightmap).
export function applyBakedSun(lighting, renderer, s, shadowSize = lighting.sun.shadow.mapSize.x) {
  const a = THREE.MathUtils.degToRad(s.az), e = THREE.MathUtils.degToRad(s.el), sun = lighting.sun;
  sun.position.copy(sun.target.position).add(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).multiplyScalar(60));
  sun.color.setRGB(...s.color); sun.intensity = s.strength;
  // a low sun throws long shadows from trees well outside the lot: cover +-40 m (2 cm per texel at 4096)
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
  sun.position.copy(sun.target.position).add(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).multiplyScalar(90));
  sun.shadow.camera.updateProjectionMatrix();
  if (sun.shadow.mapSize.x !== shadowSize) { sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  sun.shadow.needsUpdate = true;
  // Blender's AgX + "Medium High Contrast" look, as in the Cycles references (agx.js); ?agx=three for three's AgX
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = Math.pow(2, s.ev);
  // The output transform was staged and installed by applyLightmaps before startup can finish.
}
