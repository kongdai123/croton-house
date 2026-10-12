// Scripted play-test: walk, sit, grab a chair, open the glass doors, open panels, dusk, tour; screenshots to a folder.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || '/tmp/playtest'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
await page.goto('http://127.0.0.1:8780/index.html?x=0&y=-3.5&h=0&fast=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const app = () => page.evaluate(() => { const a = window.__app; return { pos: [a.player.pos.x.toFixed(2), a.player.pos.z.toFixed(2)], seat: !!a.player.seat, locked: a.player.locked, dusk: a.state.dusk, quality: a.state.quality }; });
// 1. walk forward 2 s (W key)
await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW'); await page.waitForTimeout(300);
console.log('after walk', await app()); await shot('01_walk');
// 2. sit on the sofa: teleport near it, face it, click centre (pointer not locked -> uses pointer position; put pointer at centre)
await page.evaluate(() => { window.__app.player.teleport(2.3, 0.95, 90); window.__app.player.pitch = -0.55; });
await page.waitForTimeout(400); await page.mouse.move(640, 400); await page.waitForTimeout(200); await shot('02_sofa_hover');
const label = await page.evaluate(() => document.getElementById('label').textContent); console.log('hover label:', label);
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(1400); console.log('after click', await app()); await shot('03_sitting');
await page.evaluate(() => window.__app.player.pitch = -0.9); await page.waitForTimeout(200); await shot('04_look_down_seated');
await page.keyboard.press('KeyW'); await page.waitForTimeout(500); console.log('after stand', await app());
// 3. grab a dining chair: teleport, hover, drag
await page.evaluate(() => { window.__app.player.teleport(1.85, -2.0, 0); window.__app.player.pitch = -0.5; }); await page.waitForTimeout(300);
await page.mouse.move(640, 560); await page.waitForTimeout(200); console.log('hover label:', await page.evaluate(() => document.getElementById('label').textContent));
await page.mouse.down(); for (let i = 0; i < 20; i++) { await page.mouse.move(560 + i * 12, 520 + i * 2); await page.waitForTimeout(40); } await page.mouse.up(); await page.waitForTimeout(300); await shot('05_chair_dragged');
// 4. open the French doors from the office
await page.evaluate(() => { window.__app.player.teleport(-0.3, -3.4, 0); window.__app.player.pitch = 0; }); await page.waitForTimeout(300);
await page.mouse.move(640, 400); await page.waitForTimeout(200); console.log('door label:', await page.evaluate(() => document.getElementById('label').textContent));
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(900); await shot('06_doors_open');
await page.keyboard.down('KeyW'); await page.waitForTimeout(2200); await page.keyboard.up('KeyW'); await page.waitForTimeout(200); console.log('walked out?', await app()); await shot('07_on_patio');
// 5. minimap big, viewpoints panel, rednote panel
await page.keyboard.press('KeyM'); await page.waitForTimeout(500); await shot('08_bigmap'); await page.keyboard.press('KeyM');
await page.keyboard.press('KeyV'); await page.waitForTimeout(600); await shot('09_viewpoints'); await page.keyboard.press('Escape');
await page.keyboard.press('KeyR'); await page.waitForTimeout(800); await shot('10_rednote'); await page.keyboard.press('Escape');
// 6. fly to a photo viewpoint and the compare overlay; then a pano
await page.evaluate(() => window.__app.viewpoints.goTo(window.__app.viewpoints.targets.find(v => v.kind === 'photo' && v.gallery === 9))); await page.waitForTimeout(3500); await shot('11_photo_compare');
await page.keyboard.press('Escape'); await page.evaluate(() => window.__app.viewpoints.goTo(window.__app.viewpoints.targets.find(v => v.id === '26bd39e7b7'))); await page.waitForTimeout(5000); await shot('12_pano_mode');
await page.keyboard.press('Space'); await page.waitForTimeout(400); await shot('13_pano_toggled'); await page.keyboard.press('KeyW'); await page.waitForTimeout(300);
// 7. dusk
await page.evaluate(() => { window.__app.player.teleport(0.9, -11.5, 180); }); await page.keyboard.press('KeyN'); await page.waitForTimeout(4000); await shot('14_dusk_backyard');
await page.evaluate(() => { window.__app.player.teleport(0.0, 3.5, 0); }); await page.waitForTimeout(800); await shot('15_dusk_inside');
// 8. tour start
await page.keyboard.press('KeyN'); await page.waitForTimeout(1500); await page.keyboard.press('KeyT'); await page.waitForTimeout(6000); await shot('16_tour');
console.log('errors:', errors.slice(0, 10));
await browser.close();
