// Renders the standalone dog viewer to compare/pets/dog_*.png and a side-by-side with the reference photo.
// usage: cd web && node tools/dog_build.mjs && node tools/dog_shots.mjs [filter]
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = new URL('../../compare/pets/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const REF = process.env.REF_IMAGE;   // the reference photo to compare against (local file)
if (!REF) throw new Error('set REF_IMAGE to the reference photo');
const filter = process.argv[2] ?? '', filters = filter.split(',').filter(Boolean), want = (n) => !filters.length || filters.some((f) => n.includes(f));
const walk = (dur, speed = 0.35) => [{ mode: 'idle', dur: 0.4 }, { mode: 'walk', dur, speed }];
const SHOTS = {
  front: { view: 'front' }, q34: { view: 'q34' }, side: { view: 'side' }, back: { view: 'back' }, head: { view: 'head' }, top: { view: 'top' },
  walk_side: { view: 'side', seq: walk(1.37) }, walk_q34: { view: 'q34', seq: walk(1.55) },
  sit_q34: { view: 'q34', seq: [{ mode: 'idle', dur: 0.3 }, { mode: 'sit', dur: 1.6 }] }, sit_side: { view: 'side', seq: [{ mode: 'idle', dur: 0.3 }, { mode: 'sit', dur: 1.6 }] },
  lie_q34: { view: 'q34', seq: [{ mode: 'idle', dur: 0.3 }, { mode: 'lie', dur: 2.5 }] }, lie_side: { view: 'side', seq: [{ mode: 'idle', dur: 0.3 }, { mode: 'lie', dur: 2.5 }] },
  trot_side: { view: 'side', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'walk', dur: 1.3, speed: 0.9, excite: 1 }] },
  trot_q34: { view: 'q34', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'walk', dur: 1.42, speed: 0.9, excite: 1 }] },
  sit_lookup: { view: 'player', seq: [{ mode: 'idle', dur: 0.3 }, { mode: 'sit', dur: 2.2, look: 'cam', attend: true, excite: 0.8 }] },
  pet_hop: { view: 'pet', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'pet', dur: 0.48, petN: 0, look: 'cam', excite: 1 }] },
  pet_tilt: { view: 'player', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'pet', dur: 1.3, petN: 0, look: 'cam', excite: 1 }] },
  pet_bow: { view: 'pet', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'pet', dur: 1.35, petN: 1, look: 'cam', excite: 1 }] },
  pet_belly: { view: 'belly', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'pet', dur: 2.6, petN: 2, look: 'cam', excite: 1 }] },
  pet_belly_top: { view: 'player', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'pet', dur: 3.0, petN: 2, look: 'cam', excite: 1 }] },
  jump_crouch: { view: 'side', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'jump', dur: 0.13 }] },
  jump_push: { view: 'side', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'jump', dur: 0.21 }] },
  jump_air: { view: 'side', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'jump', dur: 0.4 }] },
  jump_reach: { view: 'side', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'jump', dur: 0.58 }] },
  jump_land: { view: 'side', seq: [{ mode: 'idle', dur: 0.4 }, { mode: 'jump', dur: 0.68 }] },
};
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:8780/tools/dog_viewer.html?auto=1&w=${w}&h=${h}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  return page;
}
const page = await open(900, 700), done = [];
for (const [name, o] of Object.entries(SHOTS)) {
  if (!want(name)) continue;
  const r = await page.evaluate((o) => window.show(o), o);
  await page.screenshot({ path: `${OUT}dog_${name}.png` }); done.push(name);
  console.log(name, JSON.stringify({ calls: r.calls, tris: r.tris }));
}
if (done.length > 1) {   // contact sheet of this run
  const cols = 3, w = 450, h = 350, sheet = await browser.newPage({ viewport: { width: cols * w, height: Math.ceil(done.length / cols) * h }, deviceScaleFactor: 1 });
  await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},${w}px);font:14px system-ui">${done.map((n) => `<div style="position:relative"><img src="data:image/png;base64,${fs.readFileSync(`${OUT}dog_${n}.png`).toString('base64')}" width="${w}" height="${h}"><span style="position:absolute;left:6px;top:4px;color:#fff;text-shadow:0 1px 2px #000">${n}</span></div>`).join('')}</body>`);
  await sheet.screenshot({ path: `${OUT}dog_sheet${filter ? '_' + filter.replace(/,/g, '-') : ''}.png` });
}
if (!filters.length || filters.some((f) => 'ref'.includes(f))) {
  const rp = await open(736, 416);
  await rp.evaluate(() => window.show({ view: 'ref', seq: [{ mode: 'idle', dur: 0.3 }], headYaw: 0.6, headPitch: -0.12 }));
  await rp.screenshot({ path: `${OUT}dog_ref_view.png` });
  const a = fs.readFileSync(REF).toString('base64'), b = fs.readFileSync(`${OUT}dog_ref_view.png`).toString('base64');
  const sb = await browser.newPage({ viewport: { width: 1484, height: 446 }, deviceScaleFactor: 1 });
  await sb.setContent(`<body style="margin:0;background:#222;display:flex;gap:12px;padding:0;font:13px system-ui;color:#ddd">
    <figure style="margin:0"><img src="data:image/png;base64,${a}" width="736" height="416"><figcaption style="padding:4px 8px">reference photo</figcaption></figure>
    <figure style="margin:0"><img src="data:image/png;base64,${b}" width="736" height="416"><figcaption style="padding:4px 8px">procedural dog (dog.js)</figcaption></figure></body>`);
  await sb.screenshot({ path: `${OUT}dog_vs_reference.png` });
  console.log('saved', `${OUT}dog_vs_reference.png`);
}
await browser.close();
