// The frame clock: the one time every per-frame consumer reads. main.js advances it once per drawn frame, before anything
// updates or draws. Its time is the simulation's: the live loop's frame time clamped to 0.1 s, or exactly what renderAt(t)
// and ?simdt step, so a frame a tool steps draws the same on any machine and at any recording pace.
// `gap` is the time since the previous frame before that clamp: a real hitch in the live loop (a long frame, a hidden
// tab), the whole step for renderAt. A history that integrates over frames (TAA, the volumetric light) goes stale over a
// long gap, and over frames it did not see (a pass skipped while a panorama hid the house).
// Render-path code does not read the wall clock (performance.now, Date.now): the recorder steps 100-300 ms of wall
// clock per frame while it takes a screenshot, so TAA dropped its history on every recorded frame and the puddles'
// ripples ran at the recorder's pace (docs/audit/postmortem.md, row 29). tools/test_frame_clock.mjs lists the places that
// may read it (measurements, loading, the frame pacing itself).
export const frameClock = { t: 0, dt: 0, gap: 0, frame: 0 };
export function advanceFrameClock(dt, gap = dt, clock = frameClock) {
  clock.dt = dt; clock.gap = Math.max(dt, gap); clock.t += dt; clock.frame++;
  return clock;
}
// A history that follows the frames goes stale after STALE_AFTER seconds without them: one frame that long, or the
// frame-clock time since the consumer last drew (lastT: its frameClock.t then; null: never drew).
export const STALE_AFTER = 0.2;
export const staleSince = (lastT, clock = frameClock) => lastT == null || clock.gap > STALE_AFTER || clock.t - lastT > STALE_AFTER + 1e-9;
