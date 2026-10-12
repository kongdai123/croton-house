import {chromium} from '/Users/masenov/Documents/GitHub/croton-house/web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',args:['--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8780/index.html?x=0.8&y=-2.2&h=142&fast=1');await page.waitForFunction(()=>window.__ready,null,{timeout:120000});await page.evaluate(()=>window.__app.player.lock=()=>{});
await page.keyboard.press('m');
for(const [kind,id] of [['rn','btn-views'],['pano','btn-panos'],['photo','btn-photos']]){
 await page.click('#'+id);await page.waitForTimeout(350);
 assert(await page.evaluate(kind=>window.__app.minimap.hit.every(h=>h.b.kind!==kind),kind));
 await page.click('#'+id);await page.waitForTimeout(350);assert(await page.evaluate(kind=>window.__app.minimap.hit.some(h=>h.b.kind===kind),kind));
 console.log('PASS bigmap drawn/hit blips follow '+kind);
}
const pixel=await page.evaluate(()=>{const a=window.__app,b=a.minimap.hit.find(h=>h.b.kind==='photo'&&h.b.gallery===39),r=a.minimap.bigCanvas.getBoundingClientRect();return {x:r.left+b.x/a.minimap.dpr,y:r.top+b.y/a.minimap.dpr,id:b.b.id};});
await page.mouse.click(pixel.x,pixel.y);await page.waitForFunction(()=>!window.__app.viewpoints.fly&&window.__app.markers.card?.ready,null,{timeout:20000});assert.equal(await page.evaluate(()=>window.__app.viewpoints.current.id),pixel.id);console.log('PASS map green click to framed card');await page.evaluate(()=>window.__app.markers.closeCard());
await page.click('#btn-zillow');const poor=await page.evaluate(()=>{const a=window.__app,v=a.viewpoints.targets.find(v=>v.kind==='photo'&&v.quality==='poor');return {id:v.id,index:a.viewpoints.targets.indexOf(v)};});
await page.locator('#panelBody .vp').nth(poor.index).click();await page.waitForFunction(()=>!window.__app.viewpoints.fly&&window.__app.markers.card?.ready,null,{timeout:20000});assert.equal(await page.evaluate(()=>window.__app.viewpoints.current.id),poor.id);console.log('PASS poor photo still reachable in viewpoint list');
await page.keyboard.press('c');await page.click('#compareSlider');await page.keyboard.press('c');assert.equal(await page.evaluate(()=>window.__app.viewpoints.compareOpen),false);console.log('PASS C closes compare after slider focus');
assert.deepEqual(errors,[]);await browser.close();
