// Self-time profile of 60 frames at a pose: node tools/cpuprof.mjs [x y h]
import { chromium } from 'playwright';
const [x = 1, y = 13, h = 185] = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`http://127.0.0.1:8780/index.html?x=${x}&y=${y}&h=${h}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await cdp.send('Profiler.start');
await page.evaluate(() => { let T = 100; for (let i = 0; i < 60; i++) window.renderAt(T += 1 / 60); });
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map(n => [n.id, n])), self = new Map();
const dt = profile.timeDeltas; let total = 0;
profile.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); total += dt[i] || 0; });
console.log(`total ${(total / 1000 / 60).toFixed(1)} ms/frame`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log((v / total * 100).toFixed(1).padStart(5) + '%', k);
await browser.close();
