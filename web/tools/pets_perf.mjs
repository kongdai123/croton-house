// Frame time / draw calls with both pets in view vs ?pets=0: node tools/pets_perf.mjs [hq]
// Same poses in both runs; pets are pinned in front of the camera so their cost is actually counted.
import { chromium } from 'playwright';
const hq = process.argv[2] !== 'fast';
const poses = [['living', 1.0, 1.4, 180, [[0.75, 2.5], [1.35, 2.75]]], ['garden', 1.2, -11.6, 180, [[0.9, -12.6], [1.6, -12.9]]], ['kitchen', -2.0, 1.8, 180, [[-2.2, 2.7], [-1.6, 2.9]]]];
async function run(extra) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:8780/index.html?fps=0&x=0&y=0&h=0&pins=0&petseed=2${hq ? '' : '&fast=1'}${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const out = {};
  for (const [n, x, z, h, spots] of poses) {
    out[n] = await page.evaluate(async ([x, z, h, spots]) => {
      const a = window.__app, P = a.pets;
      a.player.teleport(x, z, h, -0.35);
      if (P) P.agents.forEach((g, i) => P.hold(g.name, { x: spots[i][0], z: spots[i][1], yaw: 2.6 + i, mode: i ? 'sit' : 'walk', speed: i ? 0 : 0.34 }));
      await new Promise(r => setTimeout(r, 700));
      const info = a.renderer.info; info.autoReset = false; info.reset();
      const t = []; let last = performance.now(), petMs = 0;
      await new Promise(res => { let k = 0; const f = () => { const now = performance.now(); t.push(now - last); last = now; if (++k < 90) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      if (P) { const t0 = performance.now(); for (let i = 0; i < 300; i++) P.update(1 / 60); petMs = (performance.now() - t0) / 300; }
      const calls = info.render.calls / 90, tris = info.render.triangles / 90; info.autoReset = true; t.sort((p, q) => p - q);
      return { calls: Math.round(calls), tris: Math.round(tris), medMs: +t[45].toFixed(2), p90: +t[81].toFixed(2), petUpdateMs: +petMs.toFixed(3) };
    }, [x, z, h, spots]);
  }
  await browser.close();
  return out;
}
const off = await run('&pets=0'), on = await run('');
for (const n of Object.keys(on)) console.log(n.padEnd(8), 'pets=0', JSON.stringify(off[n]), '\n         pets  ', JSON.stringify(on[n]), `\n         Δ calls ${on[n].calls - off[n].calls}, Δ median ${(on[n].medMs - off[n].medMs).toFixed(2)} ms, Δ tris ${on[n].tris - off[n].tris}`);
