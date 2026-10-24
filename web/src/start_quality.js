// Adaptive start (desktops): the tier guessed from the GPU's name (tier.js classifyGpu) is checked once against the frames
// it actually makes. Once the first frame is drawn (on the landing page or in the walkthrough) and SETTLE_MS have passed,
// SAMPLES frames EVERY_MS apart are timed with the GPU drained after them (gl.finish: what a frame costs, CPU and GPU
// together), and their median decides, once:
//   laptop -> hq      a frame costs under UP_MS (hq's extra pixels, MSAA, AO samples, reflections and shafts cost about
//                     2-2.5x: still inside a 60 Hz frame); hq is then timed the same way and handed back to laptop if it
//                     costs over REVERT_MS: the only second change, never a third;
//   laptop -> mobile  a frame costs over DOWN_MS and most of it is the wait for the GPU (a frame bound by draw calls on the
//   hq -> laptop      CPU gains little from fewer effects, so it keeps them).
// Otherwise the tier stays. Pressing J (or ?tier=, ?capture, ?adapt=0, ?fast) ends it. A tier's atlases load in the
// background (lightmap.js setQuality); the measuring waits for the switch to finish.
export const START = { SETTLE_MS: 1500, SAMPLES: 15, EVERY_MS: 100, UP_MS: 7, DOWN_MS: 45, REVERT_MS: 30, GPU_SHARE: 0.5 };
const median = a => { const v = [...a].sort((p, q) => p - q); return v.length ? v[v.length >> 1] : NaN; };

// The tier to move to from `tier` given the timed frames ([{ cpu, total }] ms), or null to stay. `from`: the tier a step
// up came from (the verification of that step).
export function decide(tier, frames, from = null, S = START) {
  const total = median(frames.map(f => f.total)), gpu = median(frames.map(f => (f.total - f.cpu) / Math.max(f.total, 1e-3)));
  if (!(total > 0)) return null;
  if (from) return total > S.REVERT_MS ? from : null;
  if (tier === 'laptop' && total < S.UP_MS) return 'hq';
  const down = total > S.DOWN_MS && gpu >= S.GPU_SHARE;
  if (tier === 'laptop' && down) return 'mobile';
  if (tier === 'hq' && down) return 'laptop';
  return null;
}

// setTier(name): switch (main.js setQuality), returns a promise for the switch's end.
export function createStartQuality({ tier, enabled = true, setTier, now = () => performance.now(), S = START }) {
  const state = { phase: enabled ? 'idle' : 'off', tier, from: null, medianMs: null, steps: [] };
  let t0 = 0, next = 0, frames = [];
  const settle = t => { state.phase = 'settle'; t0 = t; frames = []; };
  async function step(to) {
    state.steps.push({ from: state.tier, to, ms: state.medianMs }); const was = state.tier;
    state.phase = 'switching'; state.tier = to;
    try { await setTier(to); } catch { /* the switch reports its own failure */ }
    if (state.phase !== 'switching') return;   // cancelled meanwhile
    // a step up is timed again once its atlases are in (the settle window starts now)
    if (state.from === null && to === 'hq' && was === 'laptop') { state.from = was; settle(now()); state.verifyAfter = true; } else state.phase = 'done';
  }
  return {
    state,
    // every drawn frame: the clock starts at the first one
    begin(t) { if (state.phase === 'idle') settle(t); },
    // should this frame be timed (gl.finish after it)?
    wants(t) {
      if (state.phase === 'settle' && t - t0 >= S.SETTLE_MS) { state.phase = 'measure'; next = t; }
      return state.phase === 'measure' && t >= next;
    },
    sample(cpu, total, t) {
      if (state.phase !== 'measure') return;
      frames.push({ cpu, total }); next = t + S.EVERY_MS;
      if (frames.length < S.SAMPLES) return;
      state.medianMs = +median(frames.map(f => f.total)).toFixed(1);
      const verifying = state.verifyAfter; state.verifyAfter = false;
      const to = decide(state.tier, frames, verifying ? state.from : null, S);
      if (to && to !== state.tier) step(to); else state.phase = 'done';
    },
    // the view is not the walkthrough's (a panorama, photo mode, a hidden tab): start the window again
    pause(t) { if (state.phase === 'measure' || state.phase === 'settle') settle(t); },
    cancel() { if (state.phase !== 'off') state.phase = 'done'; },
  };
}
