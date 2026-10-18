// Switchable baked lamps. The bake (bake/scripts/lamp_groups*.py) lights the house once per lamp group (a room's
// switches with the same default state), each group alone at its physical level, and stores the group's luminance in
// one channel of a tone-curved RGB atlas (three groups per WebP, K per group) plus its luminance SH at the light probes.
// Here every light switch (light_switch.js) drives its group: a switch that is ON is at the bake's full physical level,
// OFF is 0, with the switch's 0.25 s fade; all switches in a group move together to match its single baked layer. Lamp
// brightness never depends on the time of day: a slot only chooses which switches are on by default (DEFAULT_ON), and
// the lamps' colour is each group's own warm white (its mean baked chromaticity).
// Data: v2/lampgroups/encoding.json, lampgroups_<t>_0/1.webp (full, split), half|quarter/lampgroups_<t>.webp, probes.bin.
// The WebPs become the layers of ONE texture array: one sampler for every group (Apple GPUs allow 16 per shader), in
// place of the shared lamps layer's sampler.
import * as THREE from 'three';
import { lightmapBitmap } from './lightmap_assets.js';
import { glowLevel } from './lighting_roles.js';

// Default switch states per slot: the lighting manifest's (lighting_roles.js), declared with the fixtures (defaultOn: the
// slots a switch starts on; dusk, blue hour, has every lamp on; the island pendant at sunrise, someone is up; the living
// room, alcove, island and dining table through golden hour; the garage, with almost no daylight, always). A group's
// members agree (validateSwitches); a bake writes the group's slots into encoding.json, older ones take its switches'.
// The always-on group (lamp surfaces without a switch) is always on.
export const defaultOn = (slot, group) => !!group && (!!group.always || !!group.defaultOn?.includes(slot));
// Cap the array at half resolution unless ?lmgroups=full: each full-size RGBA8 layer with mips is ~177 MiB.
const capRes = res => res === 'full' && new URLSearchParams(location.search).get('lmgroups') !== 'full' ? 'half' : res;
export const lampGroupsWanted = (search = location.search) => !['0', 'off'].includes(new URLSearchParams(search).get('lmgroups'));

export function validGroupEncoding(m) {
  return m?.version === 1 && m.curve === 'sqrt(x/(x+K))' && Number.isInteger(m.textures) && m.textures > 0 && Array.isArray(m.groups) && m.groups.length > 0 &&
    m.groups.every((g, i) => g.index === i && g.tex === Math.floor(i / 3) && g.ch === i % 3 && Number.isFinite(g.K) && g.K > 0 && g.color?.length === 3 && Array.isArray(g.members));
}

// Linear-light SH (luminance, 9 coefficients) per group and probe: f32[G][N][9] after a JSON header.
export async function loadGroupProbes(url, G, N) {
  const r = await fetch(url); if (!r.ok) throw new Error(`lamp group probes ${r.status}`);
  const buf = await r.arrayBuffer(), hl = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl))), o = (4 + hl + 3) & ~3;
  if (header.groups !== G || header.count !== N || header.coefs !== 9 || buf.byteLength - o !== G * N * 9 * 4) throw new Error('Invalid lamp group probes');
  return new Float32Array(buf, o, G * N * 9);
}

// GLSL: lampGroups(uv) = sum over layers of colours * (levels * decoded luminances). Needs lightmap.js LM_SAMPLE's
// LM_FILTER define. A layer whose three groups are all off is skipped (uniform branch).
export function lampGroupGLSL(T) {
  let s = `uniform highp sampler2DArray uLampTex;
vec3 lmDecode3( vec4 t, vec3 K ) { vec3 y2 = t.rgb * t.rgb; return K * y2 / max( 1.0 - y2, vec3( 1.0 / 255.0 ) ); }
vec3 lmSample3( vec2 uv, int layer, vec3 K ) {
  ivec2 size = textureSize( uLampTex, 0 ).xy, hi = size - 1;
  vec2 tc = uv * vec2( size ), dx = dFdx( tc ), dy = dFdy( tc );
#if LM_FILTER == 2
  return lmDecode3( texture( uLampTex, vec3( uv, float( layer ) ) ), K );
#elif LM_FILTER == 0
  if ( max( dot( dx, dx ), dot( dy, dy ) ) > 1.0 ) return lmDecode3( texture( uLampTex, vec3( uv, float( layer ) ) ), K );
#endif
  vec2 p = tc - 0.5, f = fract( p ); ivec2 i = ivec2( floor( p ) );
  vec3 a = lmDecode3( texelFetch( uLampTex, ivec3( clamp( i, ivec2( 0 ), hi ), layer ), 0 ), K );
  vec3 b = lmDecode3( texelFetch( uLampTex, ivec3( clamp( i + ivec2( 1, 0 ), ivec2( 0 ), hi ), layer ), 0 ), K );
  vec3 c = lmDecode3( texelFetch( uLampTex, ivec3( clamp( i + ivec2( 0, 1 ), ivec2( 0 ), hi ), layer ), 0 ), K );
  vec3 d = lmDecode3( texelFetch( uLampTex, ivec3( clamp( i + ivec2( 1 ), ivec2( 0 ), hi ), layer ), 0 ), K );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
`;
  for (let t = 0; t < T; t++) s += `uniform vec3 uLampK${t}; uniform vec3 uLampLv${t}; uniform mat3 uLampC${t};\n`;
  s += 'vec3 lampGroups( vec2 uv ) {\n  vec3 c = vec3( 0.0 );\n';
  for (let t = 0; t < T; t++) s += `  if ( uLampLv${t}.x + uLampLv${t}.y + uLampLv${t}.z > 0.0 ) c += uLampC${t} * ( uLampLv${t} * lmSample3( uv, ${t}, uLampK${t} ) );\n`;
  return s + '  return c;\n}\n';
}

// Runtime: the texture array (one tier, reloaded on quality changes), switch levels, uniforms, probe-volume terms.
//   meta: encoding.json; switches: lighting.lightSwitches; probeSH: loadGroupProbes() result (set before the volumes)
export function createLampGroups({ meta, switches, probeSH = null, renderer, dir, asset }) {
  const G = meta.groups.length, T = meta.textures, groups = meta.groups;
  const uniforms = { uLampTex: { value: null } };
  for (let t = 0; t < T; t++) {
    const K = [0, 1, 2].map(c => groups[t * 3 + c]?.K ?? 1), C = new THREE.Matrix3();
    // columns: the colours of the texture's three groups
    const col = c => groups[t * 3 + c]?.color ?? [0, 0, 0];
    C.set(col(0)[0], col(1)[0], col(2)[0], col(0)[1], col(1)[1], col(2)[1], col(0)[2], col(1)[2], col(2)[2]);
    Object.assign(uniforms, { [`uLampK${t}`]: { value: new THREE.Vector3(...K) }, [`uLampLv${t}`]: { value: new THREE.Vector3() }, [`uLampC${t}`]: { value: C } });
  }
  // switches -> group members, by fixture id and position (bake/export/switch_groups.mjs)
  const plan = v => [v.x, -v.z, v.y], records = [];
  let matched = 0;
  for (const { root, toggle } of switches ?? []) {
    let fixture = root; while (fixture && !fixture.userData.placement) fixture = fixture.parent;
    const id = fixture?.userData.id || root.userData.id || root.name, p = plan(root.getWorldPosition(new THREE.Vector3()));
    let best = null, bestD = 0.05;
    for (const g of groups) for (const m of g.members) {
      if (m.id !== id) continue;
      const d = Math.hypot(m.root[0] - p[0], m.root[1] - p[1], m.root[2] - p[2]);
      if (d < bestD) { best = { g, m }; bestD = d; }
    }
    if (best) matched++;
    records.push({ toggle, group: best?.g ?? null, level: 0, from: 0, t: 1, on: toggle.on, manual: toggle.manual });
  }
  // each group's default slots: the bake's, else its switches' (lighting manifest)
  const defaults = new Map(groups.map(g => [g, g.defaultOn ? g : null]));
  for (const r of records) if (r.group && !defaults.get(r.group) && r.toggle.lighting) defaults.set(r.group, { always: r.group.always, defaultOn: r.toggle.lighting.defaultOn });
  const isOn = (slot, g) => g.always || defaultOn(slot, defaults.get(g));
  const levels = new Float32Array(G);   // per group, 0..gain
  let array = null, res = null, pending = null, disposed = false;
  const volumes = new Set();
  // probe-volume weights: per group and channel, level x colour
  const probeWeights = new Float32Array(G * 3);
  const state = { slotA: null, slotB: null, blend: 0 };
  const defaultLevel = (group, a, b, blend) => {
    const x = isOn(a, group) ? 1 : 0, y = isOn(b ?? a, group) ? 1 : 0;
    return x + (y - x) * blend;
  };
  const smooth = t => t * t * (3 - 2 * t);
  let changed = true;
  const api = {
    uniforms, levels, matched, switches: records.length, records, get texture() { return array; }, get resolution() { return res; },
    volumes, probeSH, probeWeights, groups,
    // The slot's default switch states (startup, and when a slot change completes): manual choices end.
    reset(slot) {
      state.slotA = slot; state.slotB = slot; state.blend = 0;
      for (const r of records) {
        const on = r.group ? isOn(slot, r.group) : r.toggle.on;
        Object.assign(r.toggle, { manual: false, on, value: +on, moving: false });
        r.level = r.from = +on; r.t = 1; r.on = on; r.manual = false;
      }
      changed = true;
    },
    // Each frame after the switches tick: slotA/slotB/blend describe a slot fade (blend 0 when none).
    update(dt, slotA, slotB = slotA, blend = 0) {
      if (disposed) return false;
      state.slotA = slotA; state.slotB = slotB; state.blend = blend;
      // One baked pool per group: a press changes every member before their fades tick.
      for (const r of records) if (r.group && !r.group.always && r.toggle.manual && (!r.manual || r.toggle.on !== r.on)) {
        const on = r.toggle.on;
        for (const member of records) if (member.group === r.group) {
          if (member !== r) member.toggle.set(on);
          member.from = member.level; member.t = 0; member.manual = true; member.on = on;
        }
      }
      for (const r of records) {
        const tg = r.toggle;
        if (tg.manual && (!r.manual || tg.on !== r.on)) { r.from = r.level; r.t = 0; }   // a switch was pressed
        r.manual = tg.manual; r.on = tg.on;
        let level;
        if (tg.manual) { r.t = Math.min(1, r.t + Math.max(0, dt) / 0.25); level = r.from + (+tg.on - r.from) * smooth(r.t); }
        else level = r.group ? defaultLevel(r.group, slotA, slotB, blend) : +tg.on;
        if (Math.abs(level - r.level) > 1e-5) changed = true;
        r.level = level;
        if (r.group && !r.group.always && tg.manual) { tg.value = level; tg.moving = r.t < 1; }
      }
      if (!changed) return false;
      changed = false;
      levels.fill(0);
      for (const g of groups) if (g.always) levels[g.index] = (g.gain ?? 1) * defaultLevel(g, slotA, slotB, blend);
      for (const r of records) if (r.group && !r.group.always) levels[r.group.index] = (r.group.gain ?? 1) * r.level;
      for (let t = 0; t < T; t++) uniforms[`uLampLv${t}`].value.set(levels[t * 3] ?? 0, levels[t * 3 + 1] ?? 0, levels[t * 3 + 2] ?? 0);
      for (let g = 0; g < G; g++) for (let c = 0; c < 3; c++) probeWeights[g * 3 + c] = levels[g] * groups[g].color[c];
      for (const refill of volumes) refill();
      return true;
    },
    // lamp-surface glow per switch: its level (full glow when on, as at dusk before)
    applyGlow() {
      for (const r of records) for (const g of r.toggle.glows) g.material[g.wash ? 'opacity' : 'emissiveIntensity'] = glowLevel(g, { baked: true, level: r.level });
    },
    async setResolution(wanted) {
      wanted = capRes(wanted);
      if (wanted === res && !pending) return true;
      const run = async () => {
        while (!disposed && wanted !== res) {
          const next = wanted, path = `${dir}/lampgroups${next === 'full' ? '' : '/' + next}`;
          const loaded = await Promise.allSettled(Array.from({ length: T }, (_, t) => next === 'full'
            ? lightmapBitmap(meta.rows.map((_, i) => asset(`${path}/lampgroups_${t}_${i}.webp`)), meta.rows)
            : lightmapBitmap(asset(`${path}/lampgroups_${t}.webp`), null)));
          const ok = loaded.filter(r => r.status === 'fulfilled').map(r => r.value), close = () => ok.forEach(b => b.parts ? b.parts.forEach(p => p.bitmap.close()) : b.close());
          if (ok.length !== T || disposed || next !== wanted) { close(); if (ok.length !== T) throw loaded.find(r => r.status === 'rejected').reason; continue; }
          let tex;
          try { tex = uploadArray(renderer, ok, Ks); } catch (err) { close(); throw err; }
          const old = array; array = tex; res = next; uniforms.uLampTex.value = tex;
          if (old) disposeArray(old);
        }
        return !disposed;
      };
      pending = (pending ?? Promise.resolve()).then(run, run).finally(() => { pending = null; });
      return pending;
    },
    restore() { array?.userData.restore(); },
    dispose() { disposed = true; if (array) disposeArray(array); array = null; volumes.clear(); },
  };
  const Ks = Array.from({ length: T }, (_, t) => [0, 1, 2].map(c => groups[t * 3 + c]?.K ?? 1));
  return api;
}
const disposeArray = t => { t.dispose(); t.userData.release?.(); };

// The layers (decoded bitmaps, split ones as row parts) into one RGBA8 texture array with a full mip chain, then linear
// mips as lightmap.js linearMips makes them, per layer with the layer's K per channel; coverage is the texture itself
// (lamp_groups_pack.py stores at least 1/255 in every chart texel and its padding, 0 only in empty atlas).
function uploadArray(renderer, bitmaps, Ks) {
  const w = bitmaps[0].width, h = bitmaps[0].height;
  if (bitmaps.some(b => b.width !== w || b.height !== h)) throw new Error('lamp group layers differ in size');
  if (Math.max(w, h) > renderer.capabilities.maxTextureSize) throw new Error('lamp group atlas exceeds maxTextureSize');
  const t = new THREE.DataArrayTexture(null, w, h, bitmaps.length);
  Object.assign(t, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, flipY: false, premultiplyAlpha: false, colorSpace: THREE.NoColorSpace,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: 4, unpackAlignment: 1 });
  const parts = bitmaps.flatMap((b, layer) => (b.parts ?? [{ bitmap: b, y: 0 }]).map(p => ({ texture: new THREE.Texture(p.bitmap), offset: new THREE.Vector3(0, p.y, layer), bitmap: p.bitmap })));
  const upload = () => {
    t.generateMipmaps = true; t.source.dataReady = false; t.needsUpdate = true; renderer.initTexture(t);
    t.generateMipmaps = false;
    try { for (const p of parts) renderer.copyTextureToTexture(p.texture, t, null, p.offset); } finally { t.generateMipmaps = true; }
    t.userData.mips = arrayMips(renderer, t, Ks);
  };
  t.userData.restore = upload;
  t.userData.release = () => { for (const p of parts) { p.texture.dispose(); p.bitmap.close(); } };
  try { upload(); return t; } catch (err) { t.dispose(); t.userData.release(); throw err; }
}
const ARRAY_MIP_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DArray;
uniform sampler2DArray uSrc; uniform int uFirst; uniform int uLayer; uniform vec3 uK; uniform ivec2 uDst;
out vec4 outColor;
vec3 dec( vec3 y ) { vec3 y2 = y * y; return uK * y2 / max( 1.0 - y2, vec3( 1.0 / 255.0 ) ); }
vec3 enc( vec3 x ) { return sqrt( x / ( x + uK ) ); }
vec4 block( ivec2 d ) {
  ivec2 hi = textureSize( uSrc, 0 ).xy - 1; vec4 s = vec4( 0.0 );
  for ( int j = 0; j < 2; j ++ ) for ( int i = 0; i < 2; i ++ ) {
    vec4 t = texelFetch( uSrc, ivec3( min( d * 2 + ivec2( i, j ), hi ), uLayer ), 0 );
    float c = uFirst == 1 ? ( any( greaterThan( t.rgb, vec3( 0.0 ) ) ) ? 1.0 : 0.0 ) : t.a;
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
function arrayMips(renderer, t, Ks) {
  if (new URLSearchParams(location.search).get('lmmips') === 'gl') return null;
  const gl = renderer.getContext?.(), t0 = performance.now();
  if (!gl?.createShader || !renderer.properties) return null;
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const vs = shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main() { vec2 p = vec2( float( ( gl_VertexID << 1 ) & 2 ), float( gl_VertexID & 2 ) ); gl_Position = vec4( p * 2.0 - 1.0, 0.0, 1.0 ); }');
  const fs = shader(gl.FRAGMENT_SHADER, ARRAY_MIP_FS), prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  const vao = gl.createVertexArray(), fb = gl.createFramebuffer(), tex = renderer.properties.get(t).__webglTexture;
  const w = t.image.width, h = t.image.height, n = Math.floor(Math.log2(Math.max(w, h))) + 1; let levels = 0;
  try {
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('lamp group mips: ' + (gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(prog)));
    gl.useProgram(prog); gl.bindVertexArray(vao); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.RASTERIZER_DISCARD]) gl.disable(cap);
    gl.colorMask(true, true, true, true);
    const u = k => gl.getUniformLocation(prog, k);
    gl.uniform1i(u('uSrc'), 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    try {
      for (let layer = 0; layer < t.image.depth; layer++) {
        gl.uniform1i(u('uLayer'), layer); gl.uniform3fv(u('uK'), Ks[layer]);
        for (let level = 1; level < n; level++) {
          const lw = Math.max(1, w >> level), lh = Math.max(1, h >> level);
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, level - 1); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, level - 1);
          gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, level, layer);
          if (level === 1 && layer === 0 && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('lamp group mips: framebuffer incomplete');
          gl.uniform1i(u('uFirst'), level === 1 ? 1 : 0); gl.uniform2i(u('uDst'), lw, lh);
          gl.viewport(0, 0, lw, lh); gl.drawArrays(gl.TRIANGLES, 0, 3); levels++;
        }
      }
    } finally {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 1000);
    }
    return { levels, ms: +(performance.now() - t0).toFixed(1) };
  } catch (err) {
    console.warn('lamp group mips: keeping the encoded mip chain', err); return null;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.bindVertexArray(null); gl.deleteVertexArray(vao);
    gl.useProgram(null); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
    renderer.resetState();
  }
}
