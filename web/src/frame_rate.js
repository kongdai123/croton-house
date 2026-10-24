// Frame pacing for the walkthrough loop (main.js). Without ?fps the page draws at the display's refresh rate when frames
// fit, and otherwise steps down to an even fraction of it (every 2nd, 3rd... refresh: 120 -> 60 -> 40 -> 30 Hz on a 120 Hz
// screen) instead of missing refreshes at random, which is what reads as stutter. ?fps=N caps at N frames a second as
// before, ?fps=0 draws on every animation frame.
//
// The governor sees only animation-frame timestamps (vsync-aligned) and the main thread's time per drawn frame:
// - the refresh period is the shortest interval between animation frames lately (skipped refreshes cost nothing, so
//   between drawn frames the browser keeps calling at the display's rate; while every frame overruns a refresh the
//   shortest interval seen grows, and the target interval is kept);
// - a drawn frame is late when it arrives a refresh or more after its slot; LATE_OF late frames among the last WINDOW
//   step the rate down one notch at once;
// - a step back up is tried when the frames have run well inside the faster budget for a while; if that rate then misses
//   again the wait before the next try doubles (up to MAX_WAIT_S), so a frame that is GPU-bound (cheap on the main
//   thread, late anyway) does not see-saw.
// One isolated hitch (a shader compile, a texture upload) never moves the rate.
export const WINDOW = 30, LATE_OF = 4, UP_HEADROOM = 0.7, BASE_WAIT_S = 3, MAX_WAIT_S = 48, MIN_RATE = 20, PERIOD_SAMPLES = 240;

export function createFrameRate({ cap = null, maxRate = Infinity } = {}) {
  // cap: null = governed, 0 = every animation frame, N = at most N a second (the schedule advances by whole periods so
  // fast screens still average N, and never runs more than a period behind)
  const fixed = cap != null ? (cap > 0 ? 1000 / cap : 0) : null;
  // The refresh period: the shortest interval of the last PERIOD_SAMPLES animation frames. While every frame takes two
  // refreshes the shortest seen is two refreshes long; the target interval (divisor x period) is kept across such a
  // change, so the rate never drops because the estimate rose.
  const deltas = new Float64Array(PERIOD_SAMPLES); let nd = 0, lastTick = 0;
  let period = 1000 / 60, divisor = 1, lastDraw = 0, nextAt = 0;
  const history = []; let wait = BASE_WAIT_S, calmSince = 0, probing = 0;
  const state = { mode: fixed == null ? 'governed' : fixed ? 'capped' : 'uncapped', late: 0, steps: 0 };
  const minDivisor = () => Math.max(1, Math.ceil(1000 / maxRate / period - 0.05));
  const maxDivisor = () => Math.max(1, Math.floor(1000 / MIN_RATE / period));
  function measure(now) {
    const d = now - lastTick; lastTick = now;
    if (!(d > 2 && d < 250)) return;          // a hidden tab or a stall says nothing about the display
    deltas[nd++ % deltas.length] = d;
    if (nd < 8) return;
    let m = Infinity; for (let i = 0, n = Math.min(nd, deltas.length); i < n; i++) if (deltas[i] < m) m = deltas[i];
    // a longer estimate keeps the target interval; a shorter one (a faster screen found) tries its own full rate
    if (m > period + 0.25) { divisor = Math.max(1, Math.round(divisor * period / m)); period = m; } else if (m < period - 0.25) period = m;
  }
  function setDivisor(n, now) { n = Math.max(minDivisor(), Math.min(maxDivisor(), n)); if (n === divisor) return; divisor = n; history.length = 0; calmSince = now; state.steps++; }
  // Should this animation frame draw? Called on every one.
  function tick(now) {
    measure(now);
    if (fixed != null) {
      if (!fixed) return true;
      if (now < nextAt - 1) return false;
      nextAt = (now - nextAt > fixed ? now : nextAt) + fixed; return true;
    }
    if (divisor < minDivisor()) divisor = minDivisor();
    if (now - lastDraw < divisor * period - period * 0.5) return false;
    return true;
  }
  // After a drawn frame: when it started (the animation frame's time) and its main-thread milliseconds.
  function drawn(now, work) {
    if (fixed != null) { lastDraw = now; return; }
    const interval = now - lastDraw; lastDraw = now;
    if (!(interval > 0 && interval < 250)) { history.length = 0; calmSince = now; return; }
    const late = interval > (divisor + 0.5) * period;
    history.push({ late, work }); if (history.length > WINDOW) history.shift();
    const lates = history.reduce((n, h) => n + h.late, 0);
    state.late = lates;
    if (lates >= LATE_OF) {
      if (probing && now - probing < 2000) wait = Math.min(MAX_WAIT_S, wait * 2);   // a step up that did not hold
      probing = 0; setDivisor(divisor + 1, now); return;
    }
    if (probing && now - probing > 2000) { probing = 0; wait = Math.max(BASE_WAIT_S, wait / 2); }   // it held
    // step up when the faster budget has been comfortably met for `wait` seconds
    if (divisor > minDivisor() && history.length >= WINDOW && now - calmSince > wait * 1000) {
      const budget = (divisor - 1) * period * UP_HEADROOM, worst = history.reduce((m, h) => Math.max(m, h.work), 0);
      if (!lates && worst < budget) { probing = now; setDivisor(divisor - 1, now); }
    }
  }
  return {
    tick, drawn, state,
    get period() { return period; }, get divisor() { return divisor; },
    get rate() { return fixed != null ? (fixed ? 1000 / fixed : 1000 / period) : 1000 / (period * divisor); },
    // the stats panel's line
    describe() {
      if (fixed != null) return fixed ? `cap ${Math.round(1000 / fixed)} fps` : 'uncapped';
      const hz = 1000 / period;
      return `${(hz / divisor).toFixed(0)} fps target (${divisor === 1 ? 'every' : `1 in ${divisor}`} refresh of ${hz.toFixed(0)} Hz)`;
    },
  };
}
