// White balance of the baked walkthrough's camera: pure policy, no three, no DOM (white_balance.js runs it per frame).
// The camera adapts to the light it sees by, as an eye or a photographer's white balance does. The adapting illuminant is
// the baked light (the probe volume: sky, sun bounce and the lamps at their live levels) on the surfaces in view indoors
// and at the eye outdoors (white_balance.js adaptingIlluminant), clamped to a plausible illuminant (a colour temperature
// and a small tint off the Planckian locus), and the frame is partially adapted from it towards the display white (D65)
// in CAT16's cone space (von Kries), with a degree of adaptation that is high indoors (an interior photographer's white
// balance: white walls read white or warm-white under 3000 K lamps) and low outdoors (golden hour stays golden, blue hour
// stays blue). Applied in scene-linear Rec.709 before exposure and AgX, as one 3 x 3 matrix; it keeps the illuminant's
// luminance (the auto exposure's meter is unaffected).
import { autoExposureEnabled } from './auto_exposure_policy.js';

export const WHITE_BALANCE = {
  // degree of adaptation D (0 none, 1 the illuminant becomes neutral), indoors and outdoors (plan.js indoorWeight blends)
  indoorD: 0.8, outdoorD: 0.4,
  // the illuminant's clamp: colour temperature range (K) and tint (Duv, CIE 1960 uv distance from the Planckian locus)
  minK: 2500, maxK: 10000, maxDuv: 0.012,
  // time constant (s) of the glide towards a new illuminant; a teleport (> teleport m in one frame) snaps
  tau: 1.5, teleport: 1.5,
  // the lookup (white_balance.js adaptingIlluminant). Indoors: rays at these angles (degrees) about the horizontal view, to
  // the first wall or the outline, at most `reach` m, read `back` m short of it facing the camera. Outdoors: the eye and
  // points this far ahead (m) while no wall stands between.
  rays: [-30, -15, 0, 15, 30], reach: 8, back: 0.4, ahead: [1, 2],
  // below this luminance (the probe's L0, linear) the illuminant's colour is noise: hold the previous one
  floor: 1e-4,
};
// On by default with the auto exposure (the visitor's frame); never with a fixed exposure (?capture, ?fixedexposure,
// ?rawtone, autoexp=0: what the Cycles references are compared against), and off with ?wb=0.
export const whiteBalanceEnabled = query => autoExposureEnabled(query) && !['0', 'off'].includes(query.get('wb'));
// ?wbd=<indoor>,<outdoor>: other degrees of adaptation (calibration), each clamped to 0..1
export function degreeOverride(query) {
  const [indoorD, outdoorD] = (query.get('wbd') ?? '').split(',').map(v => v === '' ? NaN : Math.min(1, Math.max(0, Number(v))));
  return { ...(Number.isFinite(indoorD) ? { indoorD } : {}), ...(Number.isFinite(outdoorD) ? { outdoorD } : {}) };
}

// ---- colour spaces (row-major 3 x 3)
// linear Rec.709 -> CIE XYZ (D65 white: RGB 1, 1, 1 -> 0.95047, 1, 1.08883)
export const RGB_TO_XYZ = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041];
// CIE XYZ -> CAT16's sharpened cone space (Li et al. 2017, CAM16)
export const CAT16 = [0.401288, 0.650173, -0.051461, -0.250268, 1.204414, 0.045854, -0.002079, 0.048952, 0.953127];
export const mul = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; };
export const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export function invert(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det];
}
export const XYZ_TO_RGB = invert(RGB_TO_XYZ);
const RGB_TO_LMS = mul(CAT16, RGB_TO_XYZ), LMS_TO_RGB = invert(RGB_TO_LMS);
export const luminance = rgb => 0.2126729 * rgb[0] + 0.7151522 * rgb[1] + 0.0721750 * rgb[2];
export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ---- the Planckian locus in CIE 1960 uv (Krystek 1985, 1000-15000 K), and an illuminant as temperature + tint
const locus = T => [(0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T),
  (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T)];
// sampled every mired (1e6 / K) from 67 (14925 K) to 1000 (1000 K)
const MIRED0 = 67, MIRED1 = 1000, TABLE = Array.from({ length: MIRED1 - MIRED0 + 1 }, (_, i) => locus(1e6 / (MIRED0 + i)));
export function rgbToUV(rgb) {
  const [X, Y, Z] = apply(RGB_TO_XYZ, rgb), d = X + 15 * Y + 3 * Z;
  return d > 0 ? [4 * X / d, 6 * Y / d] : [NaN, NaN];
}
// uv -> linear Rec.709 at luminance Y
export function uvToRGB(u, v, Y = 1) {
  const d = 2 * u - 8 * v + 4, x = 3 * u / d, y = 2 * v / d;
  return apply(XYZ_TO_RGB, [x / y * Y, Y, (1 - x - y) / y * Y]);
}
// The nearest point of the locus: { mired, kelvin, duv } (duv > 0 above the locus, towards green; < 0 towards magenta).
export function uvToTemperature(u, v) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < TABLE.length; i++) { const du = u - TABLE[i][0], dv = v - TABLE[i][1], d = du * du + dv * dv; if (d < bestD) { bestD = d; best = i; } }
  // refine on the two segments beside the nearest sample (projection, clamped to each segment)
  let mired = MIRED0 + best, foot = TABLE[best];
  for (const j of [best - 1, best + 1]) {
    if (j < 0 || j >= TABLE.length) continue;
    const a = TABLE[best], b = TABLE[j], eu = b[0] - a[0], ev = b[1] - a[1], t = Math.max(0, Math.min(1, ((u - a[0]) * eu + (v - a[1]) * ev) / (eu * eu + ev * ev)));
    const p = [a[0] + t * eu, a[1] + t * ev], d = (u - p[0]) ** 2 + (v - p[1]) ** 2;
    if (d < bestD) { bestD = d; mired = MIRED0 + best + (j - best) * t; foot = p; }
  }
  const [tu, tv] = tangent(mired), du = u - foot[0], dv = v - foot[1];
  // the normal (-tv, tu) points to larger v for a locus walked towards lower temperatures (tu > 0)
  const duv = Math.sign(tu * dv - tv * du || 1) * Math.hypot(du, dv);
  return { mired, kelvin: 1e6 / mired, duv };
}
// unit tangent of the locus at a mired value, walking towards lower temperatures (rising mired)
function tangent(mired) {
  const a = locus(1e6 / Math.max(MIRED0, mired - 0.5)), b = locus(1e6 / Math.min(MIRED1, mired + 0.5)), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}
// uv of a temperature (mired) and tint
export function temperatureToUV(mired, duv) {
  const p = locus(1e6 / mired), [tu, tv] = tangent(mired);
  return [p[0] - tv * duv, p[1] + tu * duv];
}

// The illuminant as the camera takes it: its temperature clamped to [minK, maxK] and its tint to +-maxDuv, so the light
// off one coloured wall (a red sofa, the oak floor, a green garden) cannot swing the frame. null when too dark to tell.
export function clampIlluminant(rgb, settings = WHITE_BALANCE) {
  const Y = luminance(rgb);
  if (!(Y > settings.floor) || rgb.some(c => !Number.isFinite(c))) return null;
  const raw = uvToTemperature(...rgbToUV(rgb.map(c => Math.max(c, 0))));
  const mired = Math.min(1e6 / settings.minK, Math.max(1e6 / settings.maxK, raw.mired));
  const duv = Math.min(settings.maxDuv, Math.max(-settings.maxDuv, raw.duv));
  return { mired, duv, kelvin: 1e6 / mired, raw };
}

// Degree of adaptation at an indoor weight (0 outdoors .. 1 indoors).
export const adaptationDegree = (indoor, settings = WHITE_BALANCE) => settings.outdoorD + (settings.indoorD - settings.outdoorD) * Math.min(1, Math.max(0, indoor));

// The von Kries matrix (row-major, linear Rec.709 in and out) that adapts an illuminant (RGB, any scale) with degree D
// towards the display white (D65, RGB 1, 1, 1) in CAT16 cone space: per cone, gain = D * white / illuminant + 1 - D, both
// at the same luminance. D = 0 is the identity; D = 1 maps the illuminant to neutral grey of its own luminance; at any D
// the illuminant's luminance is kept (its cone response becomes the linear mix D * white + (1 - D) * itself).
export function adaptationMatrix(illuminant, D) {
  const Y = luminance(illuminant);
  if (!(Y > 0) || D === 0) return IDENTITY.slice();
  const s = apply(RGB_TO_LMS, illuminant.map(c => c / Y)), w = apply(RGB_TO_LMS, [1, 1, 1].map(c => c / luminance([1, 1, 1])));
  const g = [0, 1, 2].map(i => D * w[i] / s[i] + 1 - D);
  return mul(LMS_TO_RGB, mul([g[0], 0, 0, 0, g[1], 0, 0, 0, g[2]], RGB_TO_LMS));
}
// The matrix from a (clamped) temperature, tint and degree.
export const temperatureMatrix = (mired, duv, D) => adaptationMatrix(uvToRGB(...temperatureToUV(mired, duv)), D);

// One step of the camera's glide: state { mired, duv, D } eases towards the target with time constant tau (frame-rate
// independent); snap (a teleport, the first frame, a context restore) jumps. A null target (too dark) holds the state's
// colour and still eases the degree.
export function glideWhiteBalance(state, target, dt, snap = false, settings = WHITE_BALANCE) {
  const goal = { mired: target.mired ?? state?.mired ?? 1e6 / 6504, duv: target.duv ?? state?.duv ?? 0, D: target.D };
  if (!state || snap) return goal;
  const a = -Math.expm1(-Math.max(0, dt) / settings.tau);
  return { mired: state.mired + (goal.mired - state.mired) * a, duv: state.duv + (goal.duv - state.duv) * a, D: state.D + (goal.D - state.D) * a };
}
