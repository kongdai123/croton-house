// Startup and frame resilience for a WebGL context that can be lost and restored at any moment (a GPU reset, a tab sent
// to the background on a phone, the driver reclaiming memory). Two rules:
//  1. A step that is not essential to showing the house (pet relighting, contact shadows, puddles, one frame's update) fails
//     soft: it is logged once and skipped, never thrown through the start.
//  2. A step that failed while the context was lost is retried once after 'webglcontextrestored', so the resource it was
//     building is "pending", not missing for good.
// The canvas only needs addEventListener; isLost reads the context (gl.isContextLost()). Node tests drive both with fakes.
// A failure with the context alive is a real bug, not a GPU reset: it goes to console.error so the gates (UI smoke) fail on it.
export function createGuard({ canvas, isLost = () => false, log = (...a) => console.warn(...a), error = (...a) => console.error(...a), defer = fn => setTimeout(fn, 0) }) {
  const reported = new Set(), retry = new Map();
  let losses = 0;
  canvas?.addEventListener?.('webglcontextlost', () => { losses++; });
  const fail = (label, fn, err, startLosses) => {
    const lost = isLost() || losses !== startLosses;                 // lost before, during or after the step
    if (!reported.has(label)) { reported.add(label); (lost ? log : error)(`[startup] ${label} failed${lost ? ' (context lost), will retry' : ''}, continuing:`, err?.message ?? err); }
    if (lost) retry.set(label, fn);                                   // try again once restored
  };
  // Runs fn; a throw (or a rejected promise) is logged once per label and swallowed. Returns fn's result, or undefined on failure.
  function soft(label, fn) {
    const n = losses;
    try {
      const out = fn();
      return out && typeof out.then === 'function' ? out.then(v => v, err => { fail(label, fn, err, n); }) : out;
    } catch (err) { fail(label, fn, err, n); }
  }
  canvas?.addEventListener?.('webglcontextrestored', () => {
    const jobs = [...retry]; retry.clear();
    if (jobs.length) defer(() => { for (const [label, fn] of jobs) soft(label, fn); });
  });
  // Resolves true at once when the context is alive, or when it is restored; false after `ms` (a context that never returns
  // must not hold the load forever: the steps after it are guarded and the frames are skipped by the renderer meanwhile).
  function waitForContext(ms = 15000) {
    if (!isLost()) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = ok => { clearTimeout(timer); canvas.removeEventListener('webglcontextrestored', on); resolve(ok); };
      const on = () => done(true), timer = setTimeout(() => done(false), ms);
      canvas.addEventListener('webglcontextrestored', on);
    });
  }
  return { soft, waitForContext, isLost, get queued() { return [...retry.keys()]; }, get lossCount() { return losses; } };
}
