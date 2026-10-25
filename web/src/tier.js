// Device tier, chosen before the renderer, shadow map and composer exist. ?tier=hq|laptop|mobile overrides detection.
// taa: false, or TAA's internal resolution scale (taa.js; it then replaces MSAA and SMAA). shafts: volumetric light.
// msaa: samples in the composer's buffers. The canvas's own antialias flag does nothing once a composer renders
// offscreen, so this is the real geometric antialiasing; SMAA after it only cleans what MSAA cannot see.
// hq: Apple M-series Max / Ultra. laptop: other Apple M GPUs, NVIDIA and every unrecognised desktop GPU.
// mobile: iPhone, iPad (including iPadOS reporting a Mac with touch points), coarse pointers, software rasterisers.
export const TIERS = {
  hq: { name: 'hq', contact: true, puddles: true, shafts: true, taa: 1, lens: true, pixelRatio: 2, shadowMap: 4096, hqShadow: true, gtao: { samples: 16, pd: 16 }, smaa: true, msaa: 4, ssr: true, anisotropy: 16, grass: 'hq', mirrors: true, textureCap: Infinity },
  laptop: { name: 'laptop', contact: true, puddles: false, shafts: false, taa: false, lens: false, pixelRatio: 1.25, shadowMap: 2048, hqShadow: true, gtao: { samples: 6, pd: 6 }, smaa: false, msaa: 2, anisotropy: 4, grass: 'laptop', mirrors: false, textureCap: 2048 },
  mobile: { name: 'mobile', contact: false, puddles: false, shafts: false, taa: false, lens: false, pixelRatio: 1, shadowMap: 1024, hqShadow: false, gtao: null, smaa: false, msaa: 0, anisotropy: 1, grass: 'fast', mirrors: false, textureCap: 1024 },
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

// The desktop tier a WebGL renderer string (ANGLE's or the driver's) earns: 'hq' for GPUs known to carry it at 1440p,
// 'laptop' for everything else (integrated graphics, older or smaller discrete GPUs, Safari's masked "Apple GPU", strings
// we do not know). Software rasterisers are 'mobile'. The start is adaptive on top of this (start_quality.js), so a
// borderline guess is corrected by measuring.
//   hq: Apple M Pro / Max / Ultra; NVIDIA RTX 2060 and up in every series since (desktop and laptop), the workstation
//   RTX cards, GTX 1080 / 1080 Ti and TITAN; AMD Radeon RX 5600 / 5700, RX 6600 and up, RX 7600 and up, RX 9060 and up,
//   Radeon VII and the Pro W6000 / W7000 cards; Intel Arc A580 / A7x0 and the B-series.
export function classifyGpu(gpu = '') {
  const s = String(gpu);
  if (/SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i.test(s)) return 'mobile';
  if (/Apple M\d+ (Pro|Max|Ultra)\b/i.test(s)) return 'hq';
  const rtx = s.match(/\bRTX\s*(\d)0(\d)0\b/i);                                   // GeForce RTX 2060 .. 5090 (also "Laptop GPU")
  if (rtx && +rtx[1] >= 2 && +rtx[2] >= 6) return 'hq';
  if (/\bRTX\s*(A[2-9]\d{3}|\d{4}\s*Ada|PRO\s*\d{4})\b|Quadro RTX|TITAN (RTX|V|Xp?)\b|GTX\s*1080/i.test(s)) return 'hq';
  const rx = +(s.match(/\bRX\s*(\d{4})\b/i)?.[1] ?? 0);                            // Radeon RX 5600 .. 9070
  if ((rx >= 5600 && rx < 6000) || (rx >= 6600 && rx < 7000) || (rx >= 7600 && rx < 8000) || (rx >= 9060 && rx < 10000)) return 'hq';
  if (/Radeon (VII|Pro W[67]\d{3})/i.test(s)) return 'hq';
  if (/\bArc\b(\(TM\))?\s*(A7\d0|A580|B\d{3})/i.test(s)) return 'hq';
  return 'laptop';
}

export function detectTier(search = location.search) {
  const gpu = gpuString(), ua = navigator.userAgent;
  const forced = new URLSearchParams(search).get('tier');
  if (TIERS[forced]) return { tier: forced, gpu, source: 'query', adaptive: false };
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (ios || coarse || /Android|Mobile/.test(ua)) return { tier: 'mobile', gpu, source: ios ? 'ios' : 'touch', adaptive: false };
  const tier = classifyGpu(gpu);
  if (tier === 'mobile') return { tier, gpu, source: 'software', adaptive: false };
  // a desktop: the guess is checked against measured frame times after the first frames (start_quality.js)
  return { tier, gpu, source: 'gpu', adaptive: true };
}
