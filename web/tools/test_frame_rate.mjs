// Frame pacing (src/frame_rate.js) on a simulated display: animation frames come at refresh times, a drawn frame keeps the
// page busy for its cost (main thread, or GPU: then the main thread reports little work but the next frame still waits),
// and the governor must settle on an even fraction of the refresh rate that fits, without see-sawing, ride out one hitch,
// come back up when frames get cheap, and keep ?fps caps exact.
//   node tools/test_frame_rate.mjs
import { importSrc } from './harness/util.mjs';

const { createFrameRate } = await importSrc('src/frame_rate.js');
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };

// hz: display; cost(t) -> { cpu, gpu } ms of a frame drawn at t; seconds of simulation. Returns the drawn frames.
function simulate({ hz, cost, seconds, cap = null, warm = 1 }) {
  const period = 1000 / hz, fr = createFrameRate({ cap }), frames = [], divisors = [];
  let t = 0, busyUntil = 0;
  // the loading screen: a second of cheap frames at the display's rate
  for (; t < warm * 1000; t += period) fr.tick(t);
  const end = t + seconds * 1000;
  for (; t < end; t += period) {
    if (t < busyUntil - 1e-6) continue;          // the page is still busy: this refresh brings no animation frame
    if (!fr.tick(t)) continue;
    const c = cost(t - warm * 1000), work = c.cpu;
    fr.drawn(t, work);
    frames.push(t); divisors.push(fr.divisor);
    busyUntil = t + Math.max(c.cpu, c.gpu ?? 0);
  }
  const intervals = frames.slice(1).map((f, i) => f - frames[i]);
  return { fr, frames, intervals, divisors, changes: divisors.filter((d, i) => i && d !== divisors[i - 1]).length };
}
const tail = (a, n) => a.slice(-n);
const fps = (iv) => 1000 / (iv.reduce((s, x) => s + x, 0) / iv.length);
const even = iv => iv.length && Math.max(...iv) - Math.min(...iv) < 1;

{ const r = simulate({ hz: 120, cost: () => ({ cpu: 5 }), seconds: 10 });
  check(Math.abs(fps(tail(r.intervals, 200)) - 120) < 1 && r.changes === 0, `120 Hz, 5 ms frames: every refresh (${fps(tail(r.intervals, 200)).toFixed(1)} fps)`); }
{ const r = simulate({ hz: 120, cost: () => ({ cpu: 12 }), seconds: 20 }), iv = tail(r.intervals, 300);
  check(Math.abs(fps(iv) - 60) < 0.5 && even(iv), `120 Hz, 12 ms frames: an even 60 fps (${fps(iv).toFixed(1)}, intervals ${Math.min(...iv).toFixed(1)}..${Math.max(...iv).toFixed(1)})`);
  check(r.changes <= 3, `... settles (${r.changes} rate changes in 20 s)`); }
{ const r = simulate({ hz: 60, cost: () => ({ cpu: 20 }), seconds: 30 }), iv = tail(r.intervals, 300);
  check(Math.abs(fps(iv) - 30) < 0.5 && even(iv), `60 Hz, 20 ms frames: an even 30 fps for good (${fps(iv).toFixed(1)})`); }
{ const r = simulate({ hz: 144, cost: () => ({ cpu: 9 }), seconds: 20 }), iv = tail(r.intervals, 300);
  check(Math.abs(fps(iv) - 72) < 0.5 && even(iv), `144 Hz, 9 ms frames: 72 fps (${fps(iv).toFixed(1)})`); }
{ const r = simulate({ hz: 60, cost: t => ({ cpu: t < 15000 ? 22 : 6 }), seconds: 40 }), iv = tail(r.intervals, 300);
  check(Math.abs(fps(iv) - 60) < 0.5, `heavy, then cheap: back to 60 fps (${fps(iv).toFixed(1)})`); }
{ const r = simulate({ hz: 60, cost: t => ({ cpu: Math.abs(t - 8000) < 1 ? 600 : 8 }), seconds: 20 });
  check(r.changes === 0 && r.divisors.at(-1) === 1, `one 600 ms hitch at 60 Hz does not move the rate (${r.changes} changes)`); }
{ // GPU-bound: the main thread reports 3 ms, the GPU needs 25 ms per frame on a 60 Hz screen
  const r = simulate({ hz: 60, cost: () => ({ cpu: 3, gpu: 25 }), seconds: 120 }), iv = tail(r.intervals, 600);
  check(Math.abs(fps(iv) - 30) < 2, `GPU-bound 25 ms at 60 Hz: about 30 fps (${fps(iv).toFixed(1)})`);
  check(r.changes <= 12, `... probes back up rarely (${r.changes} rate changes in 120 s)`); }
{ const r = simulate({ hz: 144, cost: () => ({ cpu: 4 }), seconds: 10, cap: 30 }), iv = tail(r.intervals, 200);
  check(Math.abs(fps(iv) - 30) < 0.3, `?fps=30 on 144 Hz averages 30 fps (${fps(iv).toFixed(2)})`); }
{ const r = simulate({ hz: 144, cost: () => ({ cpu: 4 }), seconds: 5, cap: 0 });
  check(Math.abs(fps(tail(r.intervals, 200)) - 144) < 1, '?fps=0 draws every animation frame'); }
{ const r = simulate({ hz: 60, cost: () => ({ cpu: 45 }), seconds: 20 }), iv = tail(r.intervals, 100);
  check(Math.abs(fps(iv) - 20) < 0.5 && even(iv), `60 Hz, 45 ms frames: an even 20 fps (${fps(iv).toFixed(1)})`); }
console.log(createFrameRate({}).describe());

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
