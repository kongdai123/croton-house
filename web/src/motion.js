// Per-object motion vectors for TAA (taa.js). The resolve reprojects every pixel through the depth buffer and the
// camera's motion, which is right for whatever holds still and wrong for what moves on its own: the pets, a door in its
// swing, a carried chair, the garden's wind near the camera. Those draw once more after the scene, into a target of their
// own, with their screen-space velocity: (uv now - uv in the previous frame, view depth in the previous frame, 1); the
// resolve takes it where it is set.
// How: a proxy per moving mesh (its geometry, skeleton and instance data shared) in a scene of its own, drawn with a
// velocity material: the mesh's vertex shader run twice, as this frame and as the previous one, the second with the
// previous world matrix, bone matrices, camera and, for a material that animates in its vertex shader (userData.motion:
// the grass wind, the dog's fur lag), the previous values of the uniforms it lists. A fragment counts only where its
// depth matches the scene's, so alpha cut-outs, fur strands and whatever stands in front need no special case.
// What moves: skinned meshes, meshes whose world matrix moved more than MIN_PIXELS on screen since the previous frame
// (plant sway stays well under it, ~0.1 px), and meshes of a userData.motion material whose fastest vertex (the mesh's
// userData.motionSpeed or motion.speed, m/s) covers more than MIN_PIXELS in a frame at the mesh's distance (none: always).
// Previous state is what the mesh had when it was last drawn, if that was the previous frame; anything else (it was
// hidden, merged into a rest cluster, off screen) draws as still for one frame.
import * as THREE from 'three';

// below these a mesh is left to the depth reprojection: a rigid mover's error, and the vertex animation's (the grass
// wind: thin blades a pixel or less out of place are what the clip box absorbs; drawing every tile in reach of the
// quarter pixel cost ~1 ms of CPU and 35 draws in a garden view)
export const MIN_PIXELS = 0.25, MIN_SHADER_PIXELS = 1;
const PREV = { modelViewMatrix: 'mvPrevModelView', modelMatrix: 'mvPrevModel', viewMatrix: 'mvPrevView', projectionMatrix: 'mvPrevProjection', cameraPosition: 'mvPrevCamera', getBoneMatrix: 'mvPrevBone', gl_Position: 'mvPrevClip' };
const DECLARATIONS = `
uniform mat4 mvPrevModelView, mvPrevModel, mvPrevView, mvPrevProjection; uniform vec3 mvPrevCamera; uniform vec2 uMotionJitter;
varying vec4 vMotionNow, vMotionPrev;
#ifdef USE_SKINNING
uniform highp sampler2D mvPrevBones;
mat4 mvPrevBone(const in float i) {
  int size = textureSize(mvPrevBones, 0).x, j = int(i) * 4, x = j % size, y = j / size;
  return mat4(texelFetch(mvPrevBones, ivec2(x, y), 0), texelFetch(mvPrevBones, ivec2(x + 1, y), 0), texelFetch(mvPrevBones, ivec2(x + 2, y), 0), texelFetch(mvPrevBones, ivec2(x + 3, y), 0));
}
#endif`;
const FRAGMENT = `
uniform highp sampler2D tMotionDepth; uniform float uMotionNear, uMotionFar;
varying vec4 vMotionNow, vMotionPrev;
float motionDepth(float d) { return uMotionNear * uMotionFar / (uMotionFar - (uMotionFar - uMotionNear) * d); }
void main() {
  // the scene's own surface at this pixel only (a few mm of slack: the scene's shaders transform in their own order)
  float scene = motionDepth(texelFetch(tMotionDepth, ivec2(gl_FragCoord.xy), 0).r), here = motionDepth(gl_FragCoord.z);
  if (abs(here - scene) > 0.002 + 0.004 * scene) discard;
  gl_FragColor = vec4((vMotionNow.xy / vMotionNow.w - vMotionPrev.xy / vMotionPrev.w) * 0.5, vMotionPrev.w, 1.0);
}`;

export const resolveIncludes = s => s.replace(/^[ \t]*#include +<([\w./]+)>/gm, (_, name) => {
  const chunk = THREE.ShaderChunk[name]; if (chunk === undefined) throw new Error(`motion: no shader chunk ${name}`);
  return resolveIncludes(chunk);
});
// A vertex shader that runs its main() twice: first as the previous frame (the names in PREV, and the material's own
// uniforms in `previous` ({ name: glsl type }), renamed to their previous-frame copies; gl_Position to a local), then as
// itself; vMotionNow is this frame's clip position without the TAA jitter, vMotionPrev the previous frame's.
export function doubleVertex(vertexShader, previous = {}) {
  const m = /void\s+main\s*\(\s*(?:void\s*)?\)\s*\{/.exec(vertexShader);
  if (!m) throw new Error('motion: no main() in the vertex shader');
  const head = vertexShader.slice(0, m.index), close = vertexShader.lastIndexOf('}'), body = vertexShader.slice(m.index + m[0].length, close);
  const names = { ...PREV }; for (const k of Object.keys(previous)) names[k] = `${k}_mvPrev`;
  const re = new RegExp(`\\b(?:${Object.keys(names).join('|')})\\b`, 'g');
  const before = resolveIncludes(body).replace(re, k => names[k]);
  const own = Object.entries(previous).map(([k, type]) => `uniform ${type} ${k}_mvPrev;`).join('\n');
  return `${head}${DECLARATIONS}\n${own}\nvoid main() {\n  vec4 mvPrevClip = vec4(0.0);\n  {\n${before}\n  }\n  {\n${body}\n  }\n` +
    '  vMotionNow = vec4(gl_Position.xy - uMotionJitter * gl_Position.w, gl_Position.zw);\n  vMotionPrev = mvPrevClip;\n}\n';
}

// the vertex shader a material's own hook expects to edit
const LIB = { MeshStandardMaterial: 'standard', MeshPhysicalMaterial: 'physical', MeshBasicMaterial: 'basic', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong', MeshToonMaterial: 'toon', MeshMatcapMaterial: 'matcap', MeshDepthMaterial: 'depth', MeshNormalMaterial: 'normal' };

// The distance from the eye to a mesh's bounding sphere (world matrix m, column-major elements), at least 5 cm.
function sphereDistance(sphere, m, eye) {
  const c = sphere.center, r = sphere.radius;
  const x = m[0] * c.x + m[4] * c.y + m[8] * c.z + m[12] - eye.x, y = m[1] * c.x + m[5] * c.y + m[9] * c.z + m[13] - eye.y, z = m[2] * c.x + m[6] * c.y + m[10] * c.z + m[14] - eye.z;
  const s = Math.sqrt(Math.max(m[0] * m[0] + m[1] * m[1] + m[2] * m[2], m[4] * m[4] + m[5] * m[5] + m[6] * m[6], m[8] * m[8] + m[9] * m[9] + m[10] * m[10]));
  return Math.max(0.05, Math.sqrt(x * x + y * y + z * z) - r * s);
}
// How far a world matrix change (now, before: elements) moves a mesh on screen, in pixels, at most: for D = now - before,
// a point c + r u of its bounding sphere moves |D (c + r u)| <= |D c| + r |D|_F; over the distance to the sphere.
// pixelsPerRadian: the target's height / (2 tan(fov / 2)). Plain arithmetic: it runs for every drawn mesh that moved.
export function screenMotion(sphere, now, before, eye, pixelsPerRadian) {
  const c = sphere.center;
  const d0 = now[0] - before[0], d1 = now[1] - before[1], d2 = now[2] - before[2], d4 = now[4] - before[4], d5 = now[5] - before[5], d6 = now[6] - before[6];
  const d8 = now[8] - before[8], d9 = now[9] - before[9], d10 = now[10] - before[10];
  const x = d0 * c.x + d4 * c.y + d8 * c.z + now[12] - before[12], y = d1 * c.x + d5 * c.y + d9 * c.z + now[13] - before[13], z = d2 * c.x + d6 * c.y + d10 * c.z + now[14] - before[14];
  const f = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2 + d4 * d4 + d5 * d5 + d6 * d6 + d8 * d8 + d9 * d9 + d10 * d10);
  return (Math.sqrt(x * x + y * y + z * z) + sphere.radius * f) / sphereDistance(sphere, now, eye) * pixelsPerRadian;
}
// the same for shader animation: a vertex at most `speed` m/s, over one frame of dt
export function shaderMotion(sphere, matrix, speed, dt, eye, pixelsPerRadian) {
  return speed * dt / sphereDistance(sphere, matrix, eye) * pixelsPerRadian;
}
const equal = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const snapshot = v => (v?.clone ? v.clone() : v);
const assign = (u, v) => { if (u.value?.copy && v?.copy) u.value.copy(v); else u.value = snapshot(v); };

export function createMotion({ minPixels = MIN_PIXELS, minShaderPixels = MIN_SHADER_PIXELS } = {}) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  target.texture.name = 'TAA motion';
  const scene = new THREE.Scene(); scene.name = 'TAA motion'; scene.matrixWorldAutoUpdate = false;
  // per frame, shared by every velocity material
  const shared = { mvPrevView: { value: new THREE.Matrix4() }, mvPrevProjection: { value: new THREE.Matrix4() }, mvPrevCamera: { value: new THREE.Vector3() },
    uMotionJitter: { value: new THREE.Vector2() }, tMotionDepth: { value: null }, uMotionNear: { value: 0.1 }, uMotionFar: { value: 100 } };
  const records = new WeakMap(), skeletons = new WeakMap(), variants = new WeakMap(), proxies = new Map();
  let frame = 0, drawn = [], generic = null;
  const clearColor = new THREE.Color();
  const stats = { candidates: 0, movers: 0, skinned: 0, shader: 0, rigid: 0, variants: 0 };
  const own = () => ({ mvPrevModel: { value: new THREE.Matrix4() }, mvPrevModelView: { value: new THREE.Matrix4() }, mvPrevBones: { value: null } });
  const material = (vertexShader, uniforms, defines) => {
    const m = new THREE.ShaderMaterial({ vertexShader, fragmentShader: FRAGMENT, uniforms: { ...uniforms, ...shared, ...own() }, defines: { ...defines }, side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false });
    m.name = 'TAA motion'; stats.variants++; return m;
  };
  // a material's velocity material: its own vertex animation (userData.motion) or the plain one
  const variantOf = source => {
    const spec = source?.userData?.motion;
    if (!spec) return (generic ??= { material: material(doubleVertex(THREE.ShaderLib.depth.vertexShader), {}, {}), spec: null });
    let v = variants.get(source);
    if (!v) {
      const lib = THREE.ShaderLib[LIB[source.type]] ?? THREE.ShaderLib.standard;
      const sh = { vertexShader: source.isShaderMaterial ? source.vertexShader : lib.vertexShader, fragmentShader: source.isShaderMaterial ? source.fragmentShader : lib.fragmentShader, uniforms: source.isShaderMaterial ? { ...source.uniforms } : {}, defines: { ...source.defines } };
      source.onBeforeCompile?.call(source, sh);
      const previous = spec.uniforms ?? {};
      const m = material(doubleVertex(sh.vertexShader, previous), sh.uniforms, sh.defines);
      for (const [k] of Object.entries(previous)) m.uniforms[`${k}_mvPrev`] = { value: snapshot(sh.uniforms[k]?.value) };
      v = { material: m, spec, uniforms: sh.uniforms, last: null, lastFrame: -2, frame: -1 };
      variants.set(source, v);
    }
    return v;
  };
  // the renderer's draws of the scene for the main camera (taa.js): each drawn mesh once per frame. A mesh drawn in the
  // previous frame too, at the same world matrix, neither skinned nor shader-animated, is still: nothing more to do for
  // it (its record already holds this matrix). The rest are this frame's candidates.
  const seen = o => {
    if (!o.isMesh) return;
    let r = records.get(o);
    if (!r) records.set(o, r = { last: new Float32Array(16), lastFrame: -2, frame: -1, known: false, material: null, spec: false });
    if (r.frame === frame) return;
    r.frame = frame; r.known = r.lastFrame === frame - 1; r.lastFrame = frame;
    if (r.material !== o.material) { r.material = o.material; r.spec = Array.isArray(o.material) ? o.material.some(m => m?.userData?.motion) : !!o.material?.userData?.motion; }
    if (r.known && !r.spec && !o.isSkinnedMesh && equal(r.last, o.matrixWorld.elements)) return;
    drawn.push(o);
  };
  const proxyOf = src => {
    let p = proxies.get(src);
    if (!p) {
      p = src.isSkinnedMesh ? new THREE.SkinnedMesh(src.geometry) : src.isInstancedMesh ? new THREE.InstancedMesh(src.geometry, undefined, 0) : new THREE.Mesh(src.geometry);
      p.matrixAutoUpdate = false; p.matrixWorldAutoUpdate = false; p.frustumCulled = false; p.name = 'TAA motion proxy';
      p.onBeforeRender = proxyUniforms; p.userData.source = src; scene.add(p); proxies.set(src, p);
    }
    return p;
  };
  // per draw: the proxy's previous world matrix and bones into the (shared) material, uploaded for this draw
  function proxyUniforms(renderer, s, camera, geometry, m) {
    const u = m.uniforms, d = this.userData;
    u.mvPrevModel.value.copy(d.prevModel); u.mvPrevModelView.value.multiplyMatrices(shared.mvPrevView.value, d.prevModel); u.mvPrevBones.value = d.prevBones ?? null;
    m.uniformsNeedUpdate = true;
  }
  const bonesOf = (skeleton, now) => {
    let b = skeletons.get(skeleton);
    if (!b) {
      if (!skeleton.boneTexture) skeleton.computeBoneTexture();
      const n = skeleton.boneTexture.image.width, tex = new THREE.DataTexture(new Float32Array(n * n * 4), n, n, THREE.RGBAFormat, THREE.FloatType);
      skeletons.set(skeleton, b = { last: new Float32Array(skeleton.boneMatrices.length), lastFrame: -2, tex, frame: -1 });
    }
    if (b.frame !== now) { b.frame = now; b.tex.image.data.set(b.lastFrame === now - 1 ? b.last : skeleton.boneMatrices); b.tex.needsUpdate = true; }
    return b;
  };
  const materials = o => (Array.isArray(o.material) ? o.material : [o.material]);
  // the fastest a mesh's own vertex animation moves it on screen this frame (0: none; Infinity: no figure given)
  const animated = (o, eye, pixelsPerRadian, dt) => {
    const one = m => { const spec = m?.userData?.motion; if (!spec) return 0; const v = o.userData.motionSpeed ?? spec.speed; return v >= 0 ? shaderMotion(sphereOf(o), o.matrixWorld.elements, v, dt, eye, pixelsPerRadian) : Infinity; };
    if (!Array.isArray(o.material)) return one(o.material);
    let px = 0; for (const m of o.material) px = Math.max(px, one(m)); return px;
  };
  // bounds in the mesh's own space (an instanced mesh: of all its instances)
  const sphereOf = o => {
    if (o.isInstancedMesh) return o.boundingSphere ?? (o.computeBoundingSphere(), o.boundingSphere);
    return o.geometry.boundingSphere ?? (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere);
  };
  // Which drawn meshes move this frame; their proxies shown, everything else hidden. Returns the movers.
  const classify = (camera, pixelsPerRadian, dt) => {
    for (const p of proxies.values()) p.visible = false;
    const eye = camera.position; let n = 0;
    stats.candidates = drawn.length; stats.skinned = stats.shader = stats.rigid = 0;
    for (const o of drawn) {
      const r = records.get(o), known = r.known, now = o.matrixWorld.elements;
      let move = null;
      if (o.isSkinnedMesh) move = 'skinned';
      else if (r.spec && animated(o, eye, pixelsPerRadian, dt) > minShaderPixels) move = 'shader';
      else if (known && !equal(r.last, now) && screenMotion(sphereOf(o), now, r.last, eye, pixelsPerRadian) > minPixels) move = 'rigid';
      if (!move) continue;
      const ms = materials(o);
      if (ms.some(m => !m || m.depthWrite === false || (m.transparent && !m.alphaHash))) continue;   // not in the depth buffer: nothing to match
      if (Object.keys(o.geometry.morphAttributes ?? {}).length) continue;   // (no mover has morph targets; a proxy would need them)
      const p = proxyOf(o); p.visible = true; p.geometry = o.geometry; p.matrixWorld.copy(o.matrixWorld);
      p.userData.prevModel = (p.userData.prevModel ?? new THREE.Matrix4()).fromArray(known ? r.last : now);
      if (o.isSkinnedMesh) { if (p.skeleton !== o.skeleton) p.bind(o.skeleton, o.bindMatrix); p.bindMatrix.copy(o.bindMatrix); p.bindMatrixInverse.copy(o.bindMatrixInverse); p.userData.prevBones = bonesOf(o.skeleton, frame).tex; }
      if (o.isInstancedMesh) { p.instanceMatrix = o.instanceMatrix; p.count = o.count; }
      const mats = ms.map(m => {
        const v = variantOf(m);
        if (v.spec && v.frame !== frame) {
          v.frame = frame;
          for (const k of Object.keys(v.spec.uniforms ?? {})) assign(v.material.uniforms[`${k}_mvPrev`], v.lastFrame === frame - 1 ? v.last[k] : v.uniforms[k]?.value);
        }
        return v.material;
      });
      p.material = Array.isArray(o.material) ? mats : mats[0];
      stats[move]++; n++;
    }
    return n;
  };
  return {
    target, scene, stats, seen, classify,
    setSize(w, h) { target.setSize(w, h); },
    // after the scene's draw, with the TAA's jittered camera: the movers' velocity into `target`. previous: { view, projection,
    // position } of the camera in the previous frame; jitter: the clip-space offset (2 x the uv jitter). Returns the movers.
    render(renderer, camera, depth, previous, jitter, dt) {
      shared.tMotionDepth.value = depth; shared.uMotionNear.value = camera.near; shared.uMotionFar.value = camera.far;
      shared.mvPrevView.value.copy(previous.view); shared.mvPrevProjection.value.copy(previous.projection); shared.mvPrevCamera.value.copy(previous.position);
      shared.uMotionJitter.value.copy(jitter);
      const n = classify(camera, target.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)), dt);
      stats.movers = n;
      if (!n) return 0;
      const saved = renderer.getRenderTarget(), color = renderer.getClearColor(clearColor), alpha = renderer.getClearAlpha(), auto = renderer.autoClear;
      try {
        renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
        renderer.autoClear = false; renderer.render(scene, camera);
      } finally { renderer.autoClear = auto; renderer.setClearColor(color, alpha); renderer.setRenderTarget(saved); }
      return n;
    },
    // the frame is done: what was drawn becomes the previous state (the still meshes' records hold it already)
    advance() {
      for (const o of drawn) {
        const r = records.get(o); r.last.set(o.matrixWorld.elements);
        if (o.isSkinnedMesh && o.skeleton) { const b = bonesOf(o.skeleton, frame); b.last.set(o.skeleton.boneMatrices); b.lastFrame = frame; }
        if (!r.spec) continue;
        for (const m of materials(o)) {
          const spec = m?.userData?.motion; if (!spec) continue;
          const v = variantOf(m); if (v.lastFrame === frame) continue;   // (one material, many meshes: once a frame)
          v.last ??= {};
          for (const k of Object.keys(spec.uniforms ?? {})) v.last[k] = snapshot(v.uniforms[k]?.value);
          v.lastFrame = frame;
        }
      }
      drawn.length = 0; frame++;
    },
    // nothing carries over (a reset of the TAA history)
    reset() { drawn.length = 0; frame += 2; },
    dispose() { target.dispose(); for (const p of proxies.values()) p.removeFromParent(); proxies.clear(); generic?.material.dispose(); },
  };
}
