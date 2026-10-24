// Device tier, chosen before the renderer, shadow map and composer exist. ?tier=hq|laptop|mobile overrides detection.
// msaa: samples in the composer's buffers. The canvas's own antialias flag does nothing once a composer renders
// offscreen, so this is the real geometric antialiasing; SMAA after it only cleans what MSAA cannot see.
// hq: Apple M-series Max / Ultra. laptop: other Apple M GPUs, NVIDIA and every unrecognised desktop GPU.
// mobile: iPhone, iPad (including iPadOS reporting a Mac with touch points), coarse pointers, software rasterisers.
export const TIERS = {
  hq: { name: 'hq', contact: true, puddles: true, shafts: true, taa: false, pixelRatio: 2, shadowMap: 4096, hqShadow: true, gtao: { samples: 16, pd: 16 }, smaa: true, msaa: 4, ssr: true, anisotropy: 16, grass: 'hq', mirrors: true, textureCap: Infinity },
  laptop: { name: 'laptop', contact: true, puddles: false, shafts: false, taa: false, pixelRatio: 1.25, shadowMap: 2048, hqShadow: true, gtao: { samples: 6, pd: 6 }, smaa: false, msaa: 2, anisotropy: 4, grass: 'laptop', mirrors: false, textureCap: 2048 },
  mobile: { name: 'mobile', contact: false, puddles: false, shafts: false, taa: false, pixelRatio: 1, shadowMap: 1024, hqShadow: false, gtao: null, smaa: false, msaa: 0, anisotropy: 1, grass: 'fast', mirrors: false, textureCap: 1024 },
};

// Scanned texture set for this visit, chosen before any texture request so the browser downloads only that set.
// No ?tex: 1k WebP on hq and laptop, 512 WebP on mobile. ?tex=512|1k|2k|4k forces one; 2k is the original JPEG library.
export function detectTexSet(tier, search = location.search) {
  const forced = new URLSearchParams(search).get('tex');
  if (['512', '1k', '2k', '4k'].includes(forced)) return forced;
  return tier === 'mobile' ? '512' : '1k';
}

// J toggles between the tier's own preset and one other: hq / laptop drop to the mobile preset, mobile steps up to laptop.
export function qualityPair(tier) { return tier === 'mobile' ? ['mobile', 'laptop'] : [tier, 'mobile']; }

function gpuString() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return gpu;
  } catch { return ''; }
}

export function detectTier(search = location.search) {
  const gpu = gpuString(), ua = navigator.userAgent;
  const forced = new URLSearchParams(search).get('tier');
  if (TIERS[forced]) return { tier: forced, gpu, source: 'query' };
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (ios || coarse || /Android|Mobile/.test(ua)) return { tier: 'mobile', gpu, source: ios ? 'ios' : 'touch' };
  if (/SwiftShader|llvmpipe|Software/i.test(gpu)) return { tier: 'mobile', gpu, source: 'software' };
  if (/Apple M\d+ (Max|Ultra)\b/i.test(gpu)) return { tier: 'hq', gpu, source: 'gpu' };
  // Other Apple M chips, NVIDIA, AMD, Intel, and Safari's masked "Apple GPU" all start on the lighter path.
  return { tier: 'laptop', gpu, source: 'gpu' };
}
