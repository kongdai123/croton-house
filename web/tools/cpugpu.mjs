// CPU-submit vs GPU time per frame at a few poses: node tools/cpugpu.mjs [hq|fast] [dpr]
import { chromium } from 'playwright';
const hq = (process.argv[2] ?? 'hq') === 'hq', dpr = +(process.argv[3] ?? 1);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
await page.goto(`http://127.0.0.1:8780/index.html?x=0&y=0&h=0${hq ? '' : '&fast=1'}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
for (const [n, x, y, h] of [['living', -0.6, -2.2, 75], ['garden', 1, 13, 185], ['front', 0, -11.5, 0]]) {
  console.log(n.padEnd(7), await page.evaluate(([x, y, h]) => {
    const a = window.__app, gl = a.renderer.getContext(); a.player.teleport(x, -y, h, 0);
    let T = performance.now() / 1000; for (let i = 0; i < 20; i++) window.renderAt(T += 1 / 60);
    gl.finish(); const cpu = [], gpu = [];
    for (let i = 0; i < 30; i++) { const t0 = performance.now(); window.renderAt(T += 1 / 60); const t1 = performance.now(); gl.finish(); const t2 = performance.now(); cpu.push(t1 - t0); gpu.push(t2 - t1); }
    const med = v => v.sort((p, q) => p - q)[15].toFixed(1);
    return `cpu ${med(cpu)} ms  gpu-wait ${med(gpu)} ms  px ${a.renderer.domElement.width}x${a.renderer.domElement.height}`;
  }, [x, y, h]));
}
await browser.close();
