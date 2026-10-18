// The composed baked shader: one generation per feature-flag set (features.js), from the chunk modules (*.glsl.js),
// replacing the stacked string patches each feature used to apply in turn. compose(flags) is pure and memoised by
// flagsKey(flags); it returns the edits that turn three's standard / physical template (after the material's own hook,
// which may only keep-include edit it) into the baked one: each edit names one site of the template, which must occur
// exactly once (applyComposed asserts it, transactionally through shaderPatch), and what replaces it. Ordering between
// features is a property of this file (the order the pieces are written below), not of call order.
//
// Sites, vertex: void main() (declarations), project_vertex (the world position, the sheer spread), begin_vertex
// (foliage, surface attributes). Fragment: void main() (declarations, in a fixed order), normal_fragment_begin (wet
// mask), roughness/metalness maps (surface), lights_physical_fragment (wet surface, puddle normal, sheen),
// lights_physical_pars_fragment / totalEmissiveRadiance / alphamap_fragment (sheer), lights_fragment_begin (PCSS, sun
// contact, foliage sun), lights_fragment_maps (baked irradiance, specular occlusion, reflections), lights_fragment_end
// (planar puddle). Last passes over the finished text: diffuse-only and TAA's LOD bias.
import { ShaderChunk } from 'three';
import { flagsKey } from './features.js';
import { shaderReplace as rep } from './patch.js';
import { WORLD_VARYING, WORLD_VERTEX } from './world.glsl.js';
import { PROBE_VOLUME, probeSHGLSL, PROBE_FETCH, PROBE_SIDE_POINT, PROBE_SIDE } from './probe.glsl.js';
import { WET_PARS, WET_MASK, WET_SURFACE } from './wet.glsl.js';
import { reflGLSL, CLEARCOAT_IBL } from './reflection.glsl.js';
import { PCSS_GLSL, PCSS_LOOKUP, PCSS_CALL } from './pcss.glsl.js';
import { contactSunGLSL, contactAOGLSL } from './contact.glsl.js';
import { SHEER_PARS, SHEER_VERTEX_PARS, SHEER_SPREAD_LINE, SHEER_DIRECT_LINE, SHEER_DIRECT, SHEER_EMISSION, SHEER_SHEEN_TAIL, SHEER_COVERAGE_LINE, sheerIrradiance } from './sheer.glsl.js';
import { FOLIAGE_PARS, foliageVertexPars, foliageVertexGLSL } from './foliage.glsl.js';
import { PLANAR_PUDDLE_GLSL, PUDDLE_NORMAL, PUDDLE_REFLECTION } from './puddle.glsl.js';
import { TAA_GLSL } from './taa.glsl.js';
import { lightmapPars, lightmapIrradiance } from './lightmap.glsl.js';

const LUM = 'vec3( 0.2126, 0.7152, 0.0722 )';
const N_GEOMETRY = 'inverseTransformDirection( geometryNormal, viewMatrix )', N_CLEARCOAT = 'inverseTransformDirection( geometryClearcoatNormal, viewMatrix )';
// three's lines the baked light replaces (lights_fragment_maps / lights_fragment_begin)
const LM_TEXEL = 'vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );', LM_IRRADIANCE = 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;', LM_ADD = 'irradiance += lightMapIrradiance;';
const IBL_IRRADIANCE = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
const IBL_RADIANCE = 'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );';
const DIRECTIONAL_INFO = 'getDirectionalLightInfo( directionalLight, directLight );';
const UP_REFLECTION = 'smoothstep( -0.05, 0.35, inverseTransformDirection( reflect( - geometryViewDir, geometryNormal ), viewMatrix ).y )';
// what reads the world position
const needsWorld = f => f.path === 'probe' || f.wet || !!f.refl || (f.contactAO && f.path === 'lightmap');

// the baked irradiance statements and the occlusion of three's reflections, for the probe path: one fetch per pixel at
// the shared world position (the sided lookup: a little way out on the side the face looks at)
function probeMaps(f) {
  const fol = f.foliageBake ? 'foliageScale( bakedProbe ) * ' : '';
  // the sided lookup point follows the normal, so a clear-coat normal looks up a point of its own
  const at = n => f.sided ? `probeFetch( probeSidePoint( vBakedWorld, ${n}, ${PROBE_SIDE} ) )` : 'bakedProbe';
  const fetch = `BakedProbe bakedProbe = ${f.sided ? `probeFetch( probeSidePoint( vBakedWorld, ${N_GEOMETRY}, ${PROBE_SIDE} ) )` : 'probeFetch( vBakedWorld )'};\n`;
  const occl = f.groundOcclusion ? ' * mix( 0.45, 1.0, smoothstep( 0.0, 1.2, vBakedWorld.y ) )' : '';
  // sheer cloth keeps its own two-sided irradiance (and, as before, no contact AO)
  const ao = f.contactAO && !f.sheer ? `contactAO( vBakedWorld, ${N_GEOMETRY} ) * ` : '';
  const irradiance = f.sheer ? sheerIrradiance('bakedProbe')
    : `irradiance += ${ao}${fol}probeEval( bakedProbe, inverseTransformDirection( geometryNormal${f.leafSide ? ' * faceDirection' : ''}, viewMatrix ) )${occl};`;
  const occlusion = (probe, n, bias) => `clamp( dot( ${fol}probeEval( ${probe}, ${n} ), ${LUM} ) / 0.95${bias}, 0.0, 1.0 )`;
  return { fetch, irradiance,
    specular: occlusion('bakedProbe', N_GEOMETRY, ''), clearcoat: occlusion(at(N_CLEARCOAT), N_CLEARCOAT, ''),
    // the reflection probes' occlusion: a floor of 0.25 (the foliage bake already holds its own light level)
    reflection: f.mirror ? '1.0' : occlusion('bakedProbe', 'nW', f.foliageBake ? '' : ' + 0.25'),
    reflectionClearcoat: f.mirror ? '1.0' : occlusion(at('nW'), 'nW', f.foliageBake ? '' : ' + 0.25') };
}

// the lightmapped path: the decoded atlas (contact AO under the moving casters), its luminance the occlusion
function lightmapMaps(f) {
  const lum = bias => `clamp( dot( lightMapIrradiance, ${LUM} ) / 0.95${bias}, 0.0, 1.0 )`;
  return { fetch: '', irradiance: '', specular: lum(''), clearcoat: lum(''), reflection: f.mirror ? '1.0' : lum(' + 0.25'), reflectionClearcoat: f.mirror ? '1.0' : lum(' + 0.25'),
    lightmap: m => {
      // even the unused encoded bilinear lookup goes: every read is in decoded linear light
      m = rep(m, LM_TEXEL, '', 'lightmap texel');
      m = rep(m, LM_IRRADIANCE, lightmapIrradiance({ lampGroups: f.lampGroups, multi: f.multi, fade: f.slotFade }), 'lightmap decode');
      if (f.contactAO) m = rep(m, LM_ADD, `lightMapIrradiance *= contactAO( vBakedWorld, ${N_GEOMETRY} );\n ${LM_ADD}`, 'lightmap contact');
      return m;
    } };
}

// three's lights_fragment_maps with the baked light in place of the sky's
function maps(f) {
  const p = f.path === 'probe' ? probeMaps(f) : lightmapMaps(f);
  let m = ShaderChunk.lights_fragment_maps;
  if (p.lightmap) m = p.lightmap(m);
  m = rep(m, IBL_IRRADIANCE, p.irradiance, 'baked irradiance');
  if (f.refl) {
    m = rep(m, IBL_RADIANCE, `{ vec3 nW = ${N_GEOMETRY}, rW = inverseTransformDirection( reflect( - geometryViewDir, geometryNormal ), viewMatrix );
       rW = normalize( mix( rW, nW, material.roughness * material.roughness ) );
       radiance += reflProbe( vBakedWorld, rW, material.roughness ) * ${p.reflection}; }`, 'baked reflection');
    // the clearcoat layer (quartz counters, tiles, ceramics) reflects the same room, not the open sky environment
    m = rep(m, CLEARCOAT_IBL, `{ vec3 nW = ${N_CLEARCOAT}, rW = inverseTransformDirection( reflect( - geometryViewDir, geometryClearcoatNormal ), viewMatrix );
       rW = normalize( mix( rW, nW, material.clearcoatRoughness * material.clearcoatRoughness ) );
       clearcoatRadiance += reflProbe( vBakedWorld, rW, material.clearcoatRoughness ) * ${p.reflectionClearcoat}; }`, 'baked reflection clearcoat');
  } else {
    // reflections dimmed by the baked light reaching the spot (specular occlusion), and below the horizon
    m = rep(m, IBL_RADIANCE, IBL_RADIANCE.slice(0, -1) + ` * ${p.specular} * ${UP_REFLECTION};`, 'baked specular');
    m = rep(m, CLEARCOAT_IBL, CLEARCOAT_IBL.slice(0, -1) + ` * ${p.clearcoat};`, 'baked clearcoat');
  }
  return p.fetch + m;
}

// three's lights_fragment_begin with the soft sun (PCSS), its foliage cap and the moving casters' sun contact
function lightsBegin(f) {
  let b = rep(ShaderChunk.lights_fragment_begin, PCSS_LOOKUP, f.foliageBake ? `min( ${PCSS_CALL}, vFoliage.z )` : PCSS_CALL, 'PCSS lookup');
  if (f.contactSun) b = rep(b, DIRECTIONAL_INFO, DIRECTIONAL_INFO + '\n if ( dot( directionalLight.direction, uContactDirection ) > 0.999 ) directLight.color *= contactSun( geometryPosition, geometryNormal );', 'contact sun');
  return b;
}

// Edits [{ site, alt?, text }]: `text` replaces the one occurrence of `site` (or, when the site is absent, of `alt`;
// '$&' in text stands for the site found). Fragment declarations come in the order below: later pieces use earlier ones.
export function compose(f) {
  const key = flagsKey(f);
  const memo = MEMO.get(key); if (memo) return memo;
  const world = needsWorld(f), probe = f.path === 'probe';
  const vpars = [world && WORLD_VARYING, f.foliageBake && foliageVertexPars(f.multi), f.sheer && SHEER_VERTEX_PARS].filter(Boolean).join('');
  const vertex = [{ site: 'void main() {', text: vpars + '$&' }];
  const project = (f.sheer ? SHEER_SPREAD_LINE : '') + (world ? WORLD_VERTEX : '');
  if (project) vertex.push({ site: '#include <project_vertex>', text: '$&' + project });
  if (f.foliageBake) vertex.push({ site: '#include <begin_vertex>', text: '$&' + foliageVertexGLSL(f.multi) });

  const aoUsed = f.contactAO && !(probe && f.sheer);
  const fpars = [world && WORLD_VARYING,
    !probe && lightmapPars({ encoding: f.lmEncoding, filter: f.lmFilter, lampGroups: f.lampGroups, multi: f.multi, fade: f.slotFade }),
    probe && PROBE_VOLUME + probeSHGLSL(f.slotFade) + PROBE_FETCH + (f.sided ? PROBE_SIDE_POINT : ''),
    f.wet && WET_PARS,
    f.refl && reflGLSL(f.refl.count, f.refl.slots, f.mirror, f.refl.lamps),
    PCSS_GLSL,
    f.contactSun && contactSunGLSL(f.contactSteps), aoUsed && contactAOGLSL(f.contactMax),
    f.foliageBake && FOLIAGE_PARS,
    f.planarPuddle && PLANAR_PUDDLE_GLSL,
  ].filter(Boolean).join('');
  const fragment = [{ site: 'void main() {', text: fpars + '$&' }];
  if (f.wet) fragment.push({ site: '#include <normal_fragment_begin>', alt: 'vec3 nonPerturbedNormal = normal;', text: '$&' + WET_MASK });
  if (f.wet || f.sheer) fragment.push({ site: '#include <lights_physical_fragment>', text: (f.wet ? WET_SURFACE : '') + (f.planarPuddle ? PUDDLE_NORMAL : '') + '$&' + (f.sheer ? SHEER_SHEEN_TAIL : '') });
  if (f.sheer) fragment.push(
    // declared ahead of the physical BRDF's direct term, which reads it
    { site: '#include <lights_physical_pars_fragment>', text: SHEER_PARS + rep(ShaderChunk.lights_physical_pars_fragment, SHEER_DIRECT_LINE, SHEER_DIRECT, 'sheer direct') },
    { site: 'vec3 totalEmissiveRadiance = emissive;', text: SHEER_EMISSION },
    { site: '#include <alphamap_fragment>', text: '$&' + SHEER_COVERAGE_LINE });
  fragment.push({ site: '#include <lights_fragment_begin>', text: lightsBegin(f) }, { site: '#include <lights_fragment_maps>', text: maps(f) });
  if (f.planarPuddle) fragment.push({ site: '#include <lights_fragment_end>', text: '$&' + PUDDLE_REFLECTION });
  const c = Object.freeze({ key, flags: f, vertex, fragment });
  MEMO.set(key, c);
  return c;
}
const MEMO = new Map();

// Apply a composition to three's onBeforeCompile parameters (after the material's own hook). Throws, leaving `sh` as it
// was only when called through shaderPatch, if a site is missing or repeated.
export function applyComposed(sh, c) {
  const edit = (src, list, stage) => {
    for (const e of list) {
      const site = e.alt && !src.includes(e.site) ? e.alt : e.site;
      src = rep(src, site, e.text.replaceAll('$&', site), `${stage} ${site}`);
    }
    return src;
  };
  sh.vertexShader = edit(sh.vertexShader, c.vertex, 'vertex');
  sh.fragmentShader = edit(sh.fragmentShader, c.fragment, 'fragment');
  if (c.flags.diffuse) sh.fragmentShader = diffuseOnly(sh.fragmentShader);
  if (c.flags.taa) sh.fragmentShader = taaBias(sh.fragmentShader);
  return sh;
}

// Diffuse only (the planar puddle reflection's copies): every specular statement goes (not `irradiance +=`, the baked
// light), and the SSR tag (reflections.js writes it into the alpha) with them.
export const diffuseOnly = src => src.replace(/(?<!\w)radiance \+= [^;]+;/g, '').replace(/gl_FragColor\.a = 0\.[0-9]+;/g, '');

// TAA's LOD bias: every included chunk that samples a surface map is expanded and reads through taaSample (shadow and
// depth maps, reflections and post buffers keep their own level of detail).
const TAA_MAPS = ['map', 'alphaMap', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'lightMap', 'specularMap', 'specularIntensityMap', 'specularColorMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap'];
const TAA_SAMPLES = new RegExp('texture2D\\s*\\(\\s*(' + TAA_MAPS.join('|') + ')\\s*,', 'g');
export function taaBias(src) {
  if (src.includes('uniform float uTaaLodBias;')) return src;
  return TAA_GLSL + src.replace(/#include <(\w+)>/g, (include, name) => {
    TAA_SAMPLES.lastIndex = 0; const chunk = ShaderChunk[name]; return chunk && TAA_SAMPLES.test(chunk) ? chunk : include;
  }).replace(TAA_SAMPLES, 'taaSample( $1,');
}
export { TAA_MAPS };
