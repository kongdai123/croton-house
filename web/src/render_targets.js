// Validate the same colour/depth combination as the composer, including format-specific MSAA.
import * as THREE from 'three';
export function composerConfig(renderer, requested = 0) {
  const gl = renderer.getContext(), saved = renderer.getRenderTarget();
  const hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  for (const type of hdr ? [THREE.HalfFloatType, THREE.UnsignedByteType] : [THREE.UnsignedByteType]) {
    const format = type === THREE.HalfFloatType ? gl.RGBA16F : gl.RGBA8;
    let supported = [];
    try { supported = gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES) ?? []; } catch (_) { /* Single-sample is still worth testing. */ }
    // GL rounds a request up to the next supported count (2 on a 4-only format is 4x), so try it as asked first;
    // the completeness check rejects a count over the format's maximum, then the listed lower counts follow.
    const max = Math.min(requested, renderer.capabilities.maxSamples ?? requested);
    const counts = [...supported].filter(n => n > 0 && n < max).sort((a, b) => b - a);
    for (const samples of [...new Set([...(max > 0 ? [max] : []), ...counts]), 0]) {
      const target = new THREE.WebGLRenderTarget(4, 4, { type, samples });
      target.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
      try {
        renderer.setRenderTarget(target);
        let valid = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        // setRenderTarget binds the MSAA buffer; also validate its resolved texture/depth attachments.
        const resolved = renderer.properties.get(target).__webglFramebuffer;
        gl.bindFramebuffer(gl.FRAMEBUFFER, resolved);
        valid &&= gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        if (valid) return { type, samples, hdr: type === THREE.HalfFloatType, direct: false };
      } catch (_) { /* Try fewer samples, then byte colour. */ }
      finally { renderer.resetState(); renderer.setRenderTarget(saved); target.dispose(); }
    }
  }
  return { type: THREE.UnsignedByteType, samples: 0, hdr: false, direct: true };
}
