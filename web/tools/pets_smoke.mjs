// Pets smoke test: load the app, report page errors, pet build/state and a few seconds of roaming.
// usage: node tools/pets_smoke.mjs ["query"]   e.g. "x=2&y=-2&h=180&petseed=3"
import { chromium } from 'playwright';
const q = process.argv[2] ?? 'x=2&y=-1&h=180&pins=0&fast=1&petseed=7';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let errs = 0;
page.on('pageerror', e => { errs++; console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')); });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { if (m.type() === 'error') errs++; console.log(`[console.${m.type()}]`, m.text().slice(0, 300)); } });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:8780/index.html?${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
console.log('ready in', Date.now() - t0, 'ms');
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const P = window.__app.pets; if (!P) return 'pets: null';
  const out = { seed: P.seed, stats: P.stats, perches: P.perches?.length, agents: P.agents.map(a => ({ name: a.name, x: +a.x.toFixed(2), z: +a.z.toFixed(2), y: +a.y.toFixed(3), state: a.state, mode: a.mode, r: a.r, walk: a.walk })) };
  return JSON.stringify(out, null, 1);
}));
console.log('errors', errs);
await browser.close();
