// Pure helpers of the UI smoke suite (gate d): no browser, no DOM, unit-tested in tools/test_smoke_helpers.mjs.

// ---- command line
// node tools/smoke/run.mjs [--headed] [--url=URL] [--out=DIR] [--only=a,b] [--list] [--gpu] [--timeout=SECONDS] [--no-build]
export function parseArgs(argv) {
  const o = { headed: false, url: null, out: 'smoke-artifacts', only: [], list: false, gpu: false, timeoutS: 240, build: true };
  for (let i = 0; i < argv.length; i++) {
    let [k, v] = argv[i].split(/=(.*)/s, 2);
    const take = () => { if (v !== undefined) return v; if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${k} needs a value`); return argv[++i]; };
    switch (k) {
      case '--headed': o.headed = true; break;
      case '--list': o.list = true; break;
      case '--gpu': o.gpu = true; break;           // real GPU: do not force SwiftShader
      case '--no-build': o.build = false; break;
      case '--url': o.url = take().replace(/\/+$/, ''); break;
      case '--out': o.out = take(); break;
      case '--only': o.only = take().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--timeout': { const n = Number(take()); if (!(n > 0)) throw new Error('--timeout needs a positive number of seconds'); o.timeoutS = n; break; }
      default: throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  return o;
}

// ---- console messages
// 'error' fails the run, 'patch' is a baked-shader patch warning (also a failure), 'ignore' is noise.
// Missing photos and panoramas are expected where the site is served without source/zillow (CI): they only 404.
const MISSING_OK = /\/assets\/(photos|panos|pano_thumbs)\/|favicon/i;
export function classifyConsole({ type, text = '', url = '' }) {
  if (/left unpatched|patch failed/i.test(text)) return 'patch';
  if (type !== 'error') return 'ignore';
  if (/Failed to load resource/i.test(text) && MISSING_OK.test(url)) return 'ignore';
  if (/GL Driver Message|GPU stall|ReadPixels/i.test(text)) return 'ignore';
  return 'error';
}

// ---- pixels
export function parseColor(css) {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(css) ?? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) throw new Error(`cannot parse colour ${css}`);
  return m.slice(1, 4).map(x => (/^\d+$/.test(x) ? +x : parseInt(x, 16)));
}
// RGBA bytes (a 8x8 sample, or any size) -> mean colour and mean alpha
export function sampleStats(rgba) {
  const n = rgba.length / 4; let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < rgba.length; i += 4) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; }
  return { mean: (r + g + b) / (3 * n), alpha: a / n };
}
// A cleared canvas reads back as transparent black. The page background is nearly black too, so "not blank" means: opaque
// and brighter than the background by a margin.
export function isBlank(sample, bgMean, margin = 4) { return !(sample.alpha > 128 && sample.mean > bgMean + margin); }

// ---- wall switches
// Where to stand and look to press a plate: dist metres in front of it (its local +z, the rocker side), eye at eyeY, aimed at
// the plate. Player conventions (player.js): forward = (-sin yaw, -cos yaw); a positive pitch looks up.
export function switchStance({ x, y = 1.12, z, ry }, { dist = 0.7, eye = 1.62 } = {}) {
  const nx = Math.sin(ry), nz = Math.cos(ry);
  return { x: x + nx * dist, z: z + nz * dist, yaw: ry, pitch: Math.atan2(y - eye, dist) };
}
export const forwardOf = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

// ---- sliders
// A slider door in plan: { cx, cy, isH, w } (house.js: w is the sliding half's width, the closed sliding half's collider spans
// cx..cx+w along the wall, the wall's axis is x when isH, plan y maps to world -z). For each side of the wall, where to
// start (dist metres off the wall, in line with the middle of the sliding half) and which way to face to walk into the glass.
export function sliderRun({ cx, cy, isH, w }, side, dist = 0.6) {
  const s = side < 0 ? -1 : 1;
  if (isH) return { start: { x: cx + w / 2, z: -cy + s * dist }, yaw: s > 0 ? 0 : Math.PI, plane: -cy, axis: 'z', side: s };
  return { start: { x: cx + s * dist, z: -(cy + w / 2) }, yaw: s * Math.PI / 2, plane: cx, axis: 'x', side: s };
}
// signed distance of a position past the wall plane, positive on the starting side
export const sliderSide = (run, pos) => run.side * (pos[run.axis] - run.plane);
