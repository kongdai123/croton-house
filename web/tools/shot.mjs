// Headless screenshot of a page served at http://127.0.0.1:8780 (the "croton-house" preview server).
// usage: node tools/shot.mjs "showcase.html?module=living&item=sofa&az=35" out.png [width] [height]
//        node tools/shot.mjs "index.html?x=0&y=-3.5&h=0&p=0&t=2" out.png     (main app: teleport via query, see main.js)
import { chromium } from 'playwright';
const [path = 'showcase.html?module=living', out = 'shot.png', w = '1280', h = '800'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:8780/${path}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }).catch(() => console.log('[warn] __ready timeout'));
await page.waitForTimeout(600);
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
