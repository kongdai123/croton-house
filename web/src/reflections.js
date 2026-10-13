// Screen-space reflections, only on surfaces that ask for them (the oak floor and the quartz counters).
// Those materials tag their pixels through the colour target's alpha (1 - 0.5 × strength; everything else writes 1),
// so walls, rugs and furniture never reflect. A pixel must also face up (floors and counter tops, not cabinet fronts).
// The pass runs straight after the scene render, reads that frame's depth, marches the reflected view ray in screen
// space, blends the hit softly (fresnel, distance and edge fades) and writes the result back into the same target,
// so GTAO after it still reads its own depth. High tier only.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';

// Tag a material's pixels as reflective (strength 0..1). Call before the material is first compiled.
export function markReflective(material, strength) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  const a = (1 - 0.5 * strength).toFixed(3);
  material.onBeforeCompile = function (shader, renderer) {
    prev?.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n\tgl_FragColor.a = ${a};`);
  };
  material.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + `|refl${a}`; };
  material.needsUpdate = true;
}

const SSRShader = {
  uniforms: {
    tColor: { value: null }, tDepth: { value: null },
    uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uViewRot: { value: new THREE.Matrix3() },
    uTexel: { value: new THREE.Vector2() }, uIntensity: { value: 1 }, uFrame: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tColor; uniform sampler2D tDepth;
    uniform mat4 uProj; uniform mat4 uInvProj; uniform mat3 uViewRot;
    uniform vec2 uTexel; uniform float uIntensity; uniform float uFrame;
    varying vec2 vUv;
    vec3 viewPos(vec2 uv) { float d = texture2D(tDepth, uv).x; vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uFrame * 0.618) * 43758.5453); }
    void main() {
      vec4 base = texture2D(tColor, vUv);
      float s = clamp((1.0 - base.a) * 2.0, 0.0, 1.0);
      if (s < 0.02) { gl_FragColor = vec4(base.rgb, 1.0); return; }
      vec3 p = viewPos(vUv);
      // normal from the depth neighbours, taking the side with the smaller step so silhouettes don't bend it
      vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0)), pl = viewPos(vUv - vec2(uTexel.x, 0.0));
      vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y)), pd = viewPos(vUv - vec2(0.0, uTexel.y));
      vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
      vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
      vec3 n = normalize(cross(dx, dy));
      if (dot(n, -p) < 0.0) n = -n;
      if ((uViewRot * n).y < 0.8) { gl_FragColor = vec4(base.rgb, 1.0); return; }   // floors and counter tops only
      vec3 v = normalize(p), r = normalize(reflect(v, n));
      const int STEPS = 28; const float MAXD = 6.0;
      float jitter = hash(gl_FragCoord.xy);
      vec3 prev = p; vec2 hitUv = vec2(-1.0); float hitT = 0.0;
      for (int i = 0; i < STEPS; i++) {
        float t = (float(i) + jitter) / float(STEPS);
        vec3 q = p + r * (MAXD * t * t + 0.02);
        vec4 c = uProj * vec4(q, 1.0); vec2 uv = c.xy / c.w * 0.5 + 0.5;
        if (c.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        float sz = viewPos(uv).z, gap = sz - q.z;
        if (gap > 0.0 && gap < 0.4 + 0.1 * MAXD * t) {
          // refine between the last free point and this one
          vec3 a = prev, b = q;
          for (int j = 0; j < 5; j++) { vec3 m = 0.5 * (a + b); vec4 mc = uProj * vec4(m, 1.0); vec2 muv = mc.xy / mc.w * 0.5 + 0.5; if (viewPos(muv).z - m.z > 0.0) b = m; else a = m; }
          vec4 bc = uProj * vec4(b, 1.0); hitUv = bc.xy / bc.w * 0.5 + 0.5; hitT = t; break;
        }
        prev = q;
      }
      if (hitUv.x < 0.0) { gl_FragColor = vec4(base.rgb, 1.0); return; }
      // glossy: a small blur that grows with the distance travelled
      vec2 o = uTexel * (1.0 + 10.0 * hitT);
      vec3 refl = (texture2D(tColor, hitUv).rgb * 2.0 + texture2D(tColor, hitUv + vec2(o.x, o.y)).rgb + texture2D(tColor, hitUv + vec2(-o.x, o.y)).rgb
                 + texture2D(tColor, hitUv + vec2(o.x, -o.y)).rgb + texture2D(tColor, hitUv + vec2(-o.x, -o.y)).rgb) / 6.0;
      float fres = mix(0.25, 1.0, pow(1.0 - max(dot(-v, n), 0.0), 4.0));
      vec2 e = min(hitUv, 1.0 - hitUv); float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
      float w = clamp(s * fres * edge * (1.0 - hitT * hitT) * uIntensity, 0.0, 0.85);
      gl_FragColor = vec4(mix(base.rgb, refl, w), 1.0);
    }`,
};

export class ReflectionPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera; this.needsSwap = false; this.frame = 0;
    this.material = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(SSRShader.uniforms), vertexShader: SSRShader.vertexShader, fragmentShader: SSRShader.fragmentShader, depthTest: false, depthWrite: false });
    this.copy = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.quad = new FullScreenQuad(null);
  }
  setSize(w, h) { this.target.setSize(w, h); this.material.uniforms.uTexel.value.set(1 / w, 1 / h); }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms, cam = this.camera;
    u.tColor.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture;
    u.uProj.value.copy(cam.projectionMatrix); u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uViewRot.value.setFromMatrix4(cam.matrixWorld); u.uFrame.value = (this.frame = (this.frame + 1) % 64);
    if (this.target.width !== readBuffer.width || this.target.height !== readBuffer.height) this.setSize(readBuffer.width, readBuffer.height);
    this.quad.material = this.material; renderer.setRenderTarget(this.target); this.quad.render(renderer);
    // write back without clearing: the target's depth must survive for GTAO
    const autoClear = renderer.autoClear; renderer.autoClear = false;
    this.copy.uniforms.tDiffuse.value = this.target.texture; this.quad.material = this.copy; renderer.setRenderTarget(readBuffer); this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }
  dispose() { this.material.dispose(); this.copy.dispose(); this.target.dispose(); this.quad.dispose(); }
}
