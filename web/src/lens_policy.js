// The live cinematic lens (lens.js): its parameters, and the JS references of the equations its shaders run. No three,
// DOM or GPU: tools/test_lens.mjs.
//
// A full-frame camera, as photo mode's (three's filmGauge): the frame's long side spans 36 mm, so a 16:9 frame is a
// 36 x 20.25 mm gate and the walkthrough's 62 degrees (vertical) is a 16.9 mm lens, the film's 40 degrees 28 mm. Depth of
// field from the thin-lens equation; photo mode (photo.js) path-traces the same thin lens with its own settings and the
// same six-bladed aperture (rotation 0.3).
//
// The look, as an architectural photographer works (the film's camera language; its lens section sets these numbers):
// rooms in deep focus, shallow focus only for a close subject. The aperture follows the focus distance: f/2 on a close
// subject (a detail, the dog, what the visitor aims at within about a metre), f/8 for a room, a smooth blend between
// (apertureFor). At 16.9 mm, f/2 on the dog 0.8 m away blurs a wall 5 m behind it to a disc 11 px across at 1440 px; a
// room, focused at 2.5 m at f/8, is sharp from 1 m to the horizon (1.5 px at most). Autofocus focuses a close subject
// exactly and rests on a room at the larger of the hyperfocal distance at f/8 and 2.5 m (focusFor), and it locks: the focus moves
// only once what the centre sees would be visibly soft where it is, and stays soft for a moment (afStep), so it neither
// hunts across an edge nor breathes as the camera moves.
// The rest of the lens is kept nearly invisible: bloom only on what is small and far brighter than white (a lamp, the fire,
// a glint of sun; never a daylight window, which is larger than the glow's reach), within about 1% of the frame height;
// natural vignetting of 0.1 EV in the corners; lateral chromatic aberration of a quarter pixel in the corners at 1080p.
export const FILM_GAUGE_MM = 36;
// the gate's height for a frame's aspect (three's getFilmHeight): 20.25 mm at 16:9; a portrait frame is 36 mm tall
export const sensorHeightMm = aspect => FILM_GAUGE_MM / Math.max(1, aspect);
export const SENSOR_HEIGHT_MM = sensorHeightMm(16 / 9);
export const LENS = {
  fStop: 2, fStopRooms: 8,                          // the aperture on a close subject and for a room (apertureFor)
  blades: 6, bladeRotation: 0.3, roundness: 0.6,   // aperture: 6 blades as photo mode's, rounded 60% toward a circle
  maxCoc: 0.01,                                     // largest blur radius, as a fraction of the image height (14 px at 1440)
  samples: 43,                                      // gather taps (rings of 1, 7, 14, 21)
  bloom: 0.03,                                      // share of the light the glow spreads past its source that is added
  bloomLevels: 3, bloomScatter: 0.5,                // half, quarter and eighth resolution: a glow about 1% of the height
  bloomThreshold: 4,                                // exposed: 2 EV above diffuse white (1); only the excess glows
  bloomIsolation: 2, bloomRing: 0.05,               // and only where brighter than twice its surround this far out
                                                    // (image heights): a source smaller than the ring, not a window
  glareMax: 32,                                     // the excess that glows is capped here (exposed): the sun's disc
  vignette: 0.1,                                    // EV darker in the corners, the shape of cos^4 natural vignetting
  ca: 0.00025,                                      // lateral chromatic aberration at the corner, image heights (0.27 px at 1080)
  focusTime: 0.6,                                   // a focus pull settles (95%) in this many seconds, critically damped
  lockCoc: 0.015,                                   // mm: autofocus holds while the centre's blur at the focus is within this
  lockTime: 0.12,                                   // s: and moves once it has been softer for about this long
  afRegion: 0.07,                                   // the autofocus area: a square this fraction of the height across, at the centre
  afGrid: 5,                                        // its samples per side
  skyDepth: 500,                                    // metres: farther (or the far plane) is sky, which autofocus ignores
  acceptableCoc: 0.03,                              // mm: the full-frame circle of confusion for the hyperfocal distance
  subjectNear: 1.2, subjectFar: 2.5,                // m: closer subjects are focused on exactly, wide open; from subjectFar
                                                    // out, a room: stopped down, at the hyperfocal distance; a blend between
  snapDistance: 1.5, snapAngle: 30,                 // a camera jump (teleport, cut) larger than this snaps focus instead of pulling
};

export const focalLengthMm = (vfovDeg, sensor = SENSOR_HEIGHT_MM) => sensor / 2 / Math.tan(vfovDeg * Math.PI / 360);
// The thin lens's blur at a distance: the radius of the circle of confusion as a fraction of the image height, signed:
// positive behind the focus plane (the far field), negative in front (the near field). depth and focus in metres along
// the view axis, focal in mm.
export function cocRadius(depth, focal, fStop, focus, sensor = SENSOR_HEIGHT_MM) {
  const f = focal / 1000, s = Math.max(focus, f * 1.01), d = Math.max(depth, 1e-4);
  const diameter = f * f / (fStop * (s - f)) * (d - s) / d;   // metres on the sensor
  return diameter / 2 / (sensor / 1000);
}
export const clampCoc = (c, maxCoc = LENS.maxCoc) => Math.max(-maxCoc, Math.min(maxCoc, c));
// Focused here, everything from half this distance to the horizon is acceptably sharp: where autofocus rests on sky.
export const hyperfocal = (focal, fStop, coc = LENS.acceptableCoc) => (focal * focal / (fStop * coc) + focal) / 1000;

// 0 for a close subject (subjectNear or nearer), 1 for a room (subjectFar or farther), smooth in log distance between.
export function roomShare(distance, near = LENS.subjectNear, far = LENS.subjectFar) {
  const u = Math.min(1, Math.max(0, (Math.log2(distance) - Math.log2(near)) / (Math.log2(far) - Math.log2(near))));
  return u * u * (3 - 2 * u);
}
// The aperture for a focus distance: wide open close, stopped down for a room (a blend in stops). Follows the focus as it
// pulls, so a pull from a room to the dog opens up as it comes in.
export function apertureFor(focus, open = LENS.fStop, rooms = LENS.fStopRooms, near = LENS.subjectNear, far = LENS.subjectFar) {
  return 2 ** (Math.log2(open) + (Math.log2(rooms) - Math.log2(open)) * roomShare(focus, near, far));
}

// The glow's source at a pixel (exposed units: diffuse white is about 1): l, its brightest channel; around, the mean of its
// surround on the bloomRing. Only the excess over the threshold glows, the threshold rising to bloomIsolation times the
// surround, so inside a window (its surround as bright) nothing does; a soft knee (continuous in value and slope), capped.
export function glowExcess(l, around, o = {}) {
  const { bloomThreshold = LENS.bloomThreshold, bloomIsolation = LENS.bloomIsolation, glareMax = LENS.glareMax } = o;
  const t = Math.max(bloomThreshold, bloomIsolation * around), knee = 0.5 * t, e = l - t;
  if (e <= 0) return 0;
  return Math.min(e < knee ? e * e / (2 * knee) : e - 0.5 * knee, glareMax);
}

// The aperture: sample offsets of the gather (unit disc), in rings of 1, 7, 14, 21 for 43 samples, each ring pulled in to
// a rounded polygon with `blades` sides. Returns [x0, y0, x1, y1, ...].
export function bokehKernel(samples = LENS.samples, blades = LENS.blades, rotation = LENS.bladeRotation, roundness = LENS.roundness) {
  const rings = []; let n = 1, count = 1;
  rings.push(1);
  for (let r = 1; count < samples; r++) { const k = Math.min(7 * r, samples - count); rings.push(k); count += k; n = r; }
  const out = [0, 0];
  for (let r = 1; r < rings.length; r++) {
    const radius = r / n, k = rings[r];
    for (let i = 0; i < k; i++) {
      const a = (i + (r % 2) * 0.5) / k * 2 * Math.PI, edge = polygonRadius(a, blades, rotation);
      const rr = radius * (roundness + (1 - roundness) * edge);
      out.push(rr * Math.cos(a), rr * Math.sin(a));
    }
  }
  return out;
}
// distance from the centre to the edge of a regular polygon (unit circumradius) along angle a
export function polygonRadius(a, blades = LENS.blades, rotation = LENS.bladeRotation) {
  if (blades < 3) return 1;
  const sector = 2 * Math.PI / blades, t = ((((a - rotation) % sector) + sector) % sector) - sector / 2;
  return Math.cos(Math.PI / blades) / Math.cos(t);
}

// ---- autofocus -------------------------------------------------------------------------------------------------------------
// The centre-weighted area's samples: [{ depth (m), weight }]. A weighted median of log distance, sky ignored (depth beyond
// skyDepth or not finite): one stray sample (a pole, a leaf edge, a window's view) cannot move it. null: all sky.
export function focusTarget(samples, skyDepth = LENS.skyDepth) {
  const valid = samples.filter(s => Number.isFinite(s.depth) && s.depth > 0 && s.depth < skyDepth && s.weight > 0).map(s => ({ x: Math.log2(s.depth), w: s.weight }));
  if (!valid.length) return null;
  valid.sort((a, b) => a.x - b.x);
  const total = valid.reduce((t, s) => t + s.w, 0); let run = 0;
  for (const s of valid) { run += s.w; if (run >= total / 2) return 2 ** s.x; }
  return 2 ** valid.at(-1).x;
}
// The area's sample pattern: a grid of afGrid x afGrid over a square afRegion of the height across, weighted toward its
// centre (a Gaussian, sigma a third of its half-width). Offsets from the centre in units of the image height.
export function focusPattern(grid = LENS.afGrid, region = LENS.afRegion) {
  const out = [], half = (grid - 1) / 2, sigma = Math.max(1, half) / 1.5;
  for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
    const u = (i - half) / Math.max(1, half), v = (j - half) / Math.max(1, half), w = Math.exp(-((i - half) ** 2 + (j - half) ** 2) / (2 * sigma * sigma));
    out.push({ x: u * region / 2, y: v * region / 2, weight: w });
  }
  return out;
}
// Where to focus for what the centre area sees (m): a close subject exactly; a room (subjectFar or farther, a view through
// the house to the garden too) at the hyperfocal distance of the room aperture or subjectFar, whichever is farther, so it
// reads sharp from about a metre to the horizon; between, a blend in log distance, continuous and rising. What the visitor
// aims at goes through this too (the dog or a piece within reach exactly; a door across the room leaves the room sharp);
// the film's set focus (lens.js control) bypasses it. H: hyperfocal(focal, LENS.fStopRooms).
export function focusFor(subject, H, near = LENS.subjectNear, far = LENS.subjectFar) {
  const x = Math.log2(subject), t = roomShare(subject, near, far);
  return 2 ** (x + (Math.max(Math.log2(H), Math.log2(far)) - x) * t);
}
// The focus pull: a critically damped spring on log2 distance, integrated exactly (any frame rate, no overshoot from rest).
// state { x, v } (log2 metres, per second); settles to 95% of a step in `time` seconds.
export function glideFocus(state, target, dt, time = LENS.focusTime) {
  const w = 4.744 / Math.max(1e-3, time), c1 = state.x - target, c2 = state.v + w * c1, e = Math.exp(-w * dt);
  return { x: target + (c1 + c2 * dt) * e, v: (c2 - w * (c1 + c2 * dt)) * e };
}
// One frame of autofocus (lens.js runs the same on the GPU). state { x, v: the focus and its velocity (log2 m), m: how long
// the target has looked soft (0-1), lock: the target the focus pulls to (log2 m) }, or null (start afresh); measured: the
// wanted focus this frame (log2 m: focusFor of the area's median, or what is aimed at). The lock moves to the measurement
// once a subject at the measured distance would blur past lockCoc at the lock's focus and aperture for about lockTime;
// lockCoc 0 follows every frame (tracking). focal and o.sensor (the gate's height) in mm.
export function afStep(state, measured, dt, focal, o = {}) {
  const { lockCoc = LENS.lockCoc, lockTime = LENS.lockTime, time = LENS.focusTime, open = LENS.fStop, rooms = LENS.fStopRooms, sensor = SENSOR_HEIGHT_MM } = o;
  if (!state) return { x: measured, v: 0, m: 0, lock: measured };
  let { m, lock } = state;
  if (lockCoc <= 0) lock = measured;
  else {
    const s = 2 ** lock, blur = Math.abs(clampCoc(cocRadius(2 ** measured, focal, apertureFor(s, open, rooms), s, sensor))) * 2 * sensor;
    m = (blur > lockCoc ? 1 : 0) + (m - (blur > lockCoc ? 1 : 0)) * Math.exp(-dt / lockTime);
    if (m > 0.5) { lock = measured; m = 0; }
  }
  return { ...glideFocus(state, lock, dt, time), m, lock };
}

// ---- switches ----------------------------------------------------------------------------------------------------------------
// On by default where the tier says (hq desktop), never in the fixed-exposure ?capture mode (compared with Cycles) unless
// asked; ?lens=0 turns the whole lens off, ?dof=0 / ?bloom=0 / ?vignette=0 / ?ca=0 one part. stored: the visitor's own
// choice (the Y key), if any.
export function lensWanted(search, tierPreset, stored = null) {
  const q = new URLSearchParams(search);
  if (q.has('lens')) return q.get('lens') !== '0';
  if (q.has('capture')) return false;
  if (stored === '0' || stored === '1') return stored === '1';
  return !!tierPreset?.lens;
}
export function lensParts(search) {
  const q = new URLSearchParams(search), on = k => !q.has(k) || q.get(k) !== '0';
  return { dof: on('dof'), bloom: on('bloom'), vignette: on('vignette'), ca: on('ca') };
}
