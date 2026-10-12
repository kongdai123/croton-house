// Precompute the daylight bake (src/daylight.js) and save it as data/daylight.bin, so visitors skip ~0.5–2 s of CPU ray
// tests. Run after changing walls, windows or fixed furniture; a stale file is detected by its fingerprint and ignored.
// usage (from web/, with the dev server on 8780): node tools/bake_daylight.mjs
import { chromium } from 'playwright';
import fs from 'fs';
const base = 'http://127.0.0.1:8780/index.html?auto=1';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`${base}&daylight=live`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const out = await page.evaluate(() => {
  const d = window.__app.lighting.daylight, bytes = new Uint8Array(d.serialize());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), fingerprint: d.fingerprint.toString(16), bakeMs: Math.round(d.bakeMs) };
});
fs.writeFileSync('data/daylight.bin', Buffer.from(out.base64, 'base64'));
console.log(`data/daylight.bin: ${fs.statSync('data/daylight.bin').size} bytes, fingerprint ${out.fingerprint}, live bake took ${out.bakeMs} ms`);
// Check the app now loads it instead of baking.
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const used = await page.evaluate(() => window.__app.state.daylightSource);
console.log(used === 'file' ? 'verified: the app loads the file' : `WARNING: the app did not use the file (source: ${used})`);
await browser.close();
if (used !== 'file') process.exit(1);
