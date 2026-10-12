import { chromium } from '/Users/masenov/Documents/GitHub/croton-house/web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('croton-lang', 'en'));
await page.goto('http://127.0.0.1:8780/index.html?x=0.8&y=4.05&h=35&p=-0.05', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
await page.evaluate(() => { const a = window.__app; a.player.lock = () => {}; a.markers.visible = false; for (const o of a.layout.placed) if (o.userData.id === 'decor-curtain-sheer') o.userData.toggle.set(false, true); });
const record = (name, data) => { results.push({name, ...data}); console.log('PASS', name, JSON.stringify(data)); };
async function pose(x, y, h, p) {
  await page.evaluate(([x,y,h,p]) => { const a=window.__app; a.player.stand(); a.player.teleport(x,-y,h,p); }, [x,y,h,p]);
  await page.waitForTimeout(700);
}
async function target(id, placementX) {
  return await page.evaluate(([id, x]) => {
    const a=window.__app;
    const root=a.layout.placed.find(o => o.userData.id===id && (x===undefined || Math.abs((o.userData.placement?.x ?? o.position.x)-x)<0.02));
    if (!root) throw new Error('Missing '+id);
    window.__target=root;
    root.updateMatrixWorld(true);
    const probes=[];
    root.traverse(o => {
      if (!o.isMesh || o.userData.batched || !o.visible || o.userData.allowOverride===false) return;
      const b=new a.THREE.Box3().setFromObject(o), c=b.getCenter(new a.THREE.Vector3());
      probes.push(c);
      for (const t of [.2,.5,.8]) for (const u of [.2,.5,.8]) probes.push(new a.THREE.Vector3(b.min.x+(b.max.x-b.min.x)*t,b.min.y+(b.max.y-b.min.y)*u,c.z));
    });
    for (const v of probes) {
      v.project(a.camera);
      if (v.z<0 || v.z>1 || Math.abs(v.x)>.92 || Math.abs(v.y)>.82) continue;
      a.interact.pointer.set(v.x,v.y);
      if (a.interact.pick()?.root===root) return { x:(v.x+1)/2*innerWidth, y:(1-v.y)/2*innerHeight };
    }
    throw new Error('No reachable pixel '+id);
  }, [id, placementX]);
}
async function click(px) { await page.mouse.move(px.x,px.y); await page.waitForTimeout(150); await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up(); }
async function settled() { await page.waitForFunction(() => !window.__target.userData.toggle.moving, null, {timeout:20000}); }
async function screenshot(name) { await page.mouse.move(20,90); await page.waitForTimeout(350); await page.locator('#label').evaluate(e=>e.style.opacity='0'); await page.screenshot({path:'/tmp/ch/'+name+'.png'}); await page.locator('#label').evaluate(e=>e.style.opacity=''); }
async function togglePair(id,x,offShot,onShot) {
  let px=await target(id,x); await page.mouse.move(px.x,px.y); await page.waitForTimeout(200);
  const label=await page.locator('#label').textContent();
  const expected=await page.evaluate(() => window.__target.userData.toggle.label.en);
  assert.equal(label,expected); assert(await page.locator('#label').evaluate(e=>e.classList.contains('show')));
  await screenshot(offShot);
  await click(px); assert.equal(await page.evaluate(()=>window.__target.userData.toggle.on),true);
  const value=await page.evaluate(()=>window.__target.userData.toggle.value); assert(value<1,'animation should not snap');
  await settled(); assert.equal(await page.evaluate(()=>window.__target.userData.toggle.value),1);
  px=await target(id,x); await page.mouse.move(px.x,px.y); await page.waitForTimeout(200);
  assert.equal(await page.locator('#label').textContent(), await page.evaluate(()=>window.__target.userData.toggle.labelOn.en));
  await screenshot(onShot); await click(px); await settled();
  assert.equal(await page.evaluate(()=>window.__target.userData.toggle.on),false);
  record(id,{hover:label,clickedBothWays:true,animationValueAfterClick:value,quality:await page.evaluate(()=>window.__app.state.quality)});
}
try {
  await togglePair('decor-curtain-sheer',1.55,'curtain_closed','curtain_open');
  let px=await target('decor-curtain-sheer',1.55);
  await page.mouse.move(px.x,px.y); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.__target.userData.toggle.on),false);
  await page.mouse.move(px.x,px.y); await page.mouse.down(); await page.mouse.move(px.x+30,px.y); await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.__target.userData.toggle.on),false);
  await page.mouse.click(px.x,px.y,{button:'right'}); assert(await page.locator('#ctxmenu').isVisible());
  assert.equal(await page.evaluate(()=>window.__target.userData.toggle.on),false); await page.keyboard.press('Escape');
  await page.click('#btn-lang'); await page.mouse.move(px.x,px.y); await page.waitForTimeout(200);
  assert.equal(await page.locator('#label').textContent(),'拉开窗帘'); await page.click('#btn-lang');
  record('toggle gestures',{longPressIgnored:true,dragIgnored:true,rightClickMenu:true,chineseLabel:true});
  await pose(-0.2,7.8,29,0.12);
  await page.evaluate(()=>{const shadow=window.__app.lighting.sun.shadow;let value=shadow.needsUpdate;window.__shadowRefreshes=0;Object.defineProperty(shadow,'needsUpdate',{configurable:true,get:()=>value,set:v=>{if(v)window.__shadowRefreshes++;value=v;}});});
  await togglePair('outdoor-umbrella',1,'umbrella_closed','umbrella_open');
  const refreshes=await page.evaluate(()=>window.__shadowRefreshes); assert(refreshes>5);
  record('umbrella shadow',{refreshes,castShadow:await page.evaluate(()=>{let cast=false;window.__target.traverse(o=>{if(o.isMesh&&o.material?.color?.getHex()===0x141b33&&o.castShadow)cast=true;});return cast;})});
  await pose(2.17,-2.95,180,0.1);
  await togglePair('decor-cellular-shade',2.17,'shade_lowered','shade_raised');
  await pose(1.6,10.9,0,-0.72);
  await togglePair('outdoor-fire-pit',1.6,'fire_day_off','fire_day_lit');
  const lightsDay=await page.evaluate(()=>{const g=window.__target;const l=g.children.find(o=>o.isPointLight);return {id:l.id,visible:l.visible,intensity:l.intensity};});
  assert.equal(lightsDay.visible,true); assert.equal(lightsDay.intensity,0);
  await page.evaluate(async()=>{window.__app.state.dusk=true;await window.__app.applyTime();}); await settled();
  await screenshot('fire_dusk_lit');
  const lightsDusk=await page.evaluate(()=>{const l=window.__target.children.find(o=>o.isPointLight);return {id:l.id,visible:l.visible,intensity:l.intensity};});
  assert.equal(lightsDay.id,lightsDusk.id); assert.equal(lightsDusk.visible,true); assert(lightsDusk.intensity>0);
  px=await target('outdoor-fire-pit',1.6); await click(px); await settled(); await screenshot('fire_dusk_off');
  assert.equal(await page.evaluate(()=>window.__target.children.find(o=>o.isPointLight).intensity),0);
  record('fire day/dusk',{day:lightsDay,dusk:lightsDusk,manualDuskExtinguish:true});
  await page.evaluate(async()=>{window.__app.state.dusk=false;await window.__app.applyTime();});
  await pose(1.85,1.2,-20,-0.45);
  px=await target('wishbone-chair',1.12); await click(px); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>!!window.__app.player.seat),true); record('chair sit',{seated:true});
  await pose(1.85,1.2,-20,-0.45); px=await target('wishbone-chair',1.12);
  const home=await page.evaluate(()=>window.__target.position.toArray());
  await page.mouse.move(px.x,px.y); await page.mouse.down();
  for (let k=1;k<=15;k++) {await page.mouse.move(px.x+k*6,px.y-k*3); await page.waitForTimeout(50);}
  await page.waitForTimeout(500); await page.mouse.up();
  assert.equal(await page.evaluate(()=>!!window.__app.player.seat),false);
  const distance=await page.evaluate(home=>window.__target.position.distanceTo(new window.__app.THREE.Vector3(...home)),home);assert(distance>.05);
  px=await target('wishbone-chair',1.12).catch(async()=>page.evaluate(()=>{const a=window.__app,v=window.__target.position.clone();v.y=.42;v.project(a.camera);return{x:(v.x+1)/2*innerWidth,y:(1-v.y)/2*innerHeight};}));
  await page.mouse.click(px.x,px.y,{button:'right'}); await page.waitForTimeout(200);
  const buttons=await page.locator('#ctxmenu button').allTextContents();assert(buttons.some(t=>t.includes('Put')));
  await page.locator('#ctxmenu button').first().click();
  await page.waitForFunction(home=>window.__target.position.distanceTo(new window.__app.THREE.Vector3(...home))<.01,home,{timeout:10000});
  record('chair drag and return',{distance,menu:buttons,returned:true});
  await pose(2.8,4.0,0,-0.1);
  const doorPixel=await page.evaluate(()=>{
    const a=window.__app;
    for(let y=160;y<700;y+=15) for(let x=180;x<1100;x+=15){a.interact.pointer.set(x/innerWidth*2-1,1-y/innerHeight*2);const h=a.interact.pick();if(h?.door){window.__door=h.door;return{x,y,kind:h.door.kind};}}
    throw new Error('No door pixel');
  });
  const doorState=()=>page.evaluate(()=>{const d=window.__door;return d.kind==='slider'?d.open:d.target;});
  const before=await doorState();await click(doorPixel);const after=await doorState();assert.notEqual(before,after);
  record('door click',{kind:doorPixel.kind,before,after});
  assert.deepEqual(errors,[]);
  record('runtime',{errors,batchingEnabled:true});
  await writeFile('interact_results.json',JSON.stringify(results,null,2));
} finally { await browser.close(); }
