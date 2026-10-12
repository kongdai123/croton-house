import { chromium } from '/Users/masenov/Documents/GitHub/croton-house/web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({channel:'chrome',args:['--use-angle=metal','--ignore-gpu-blocklist']});
const context = await browser.newContext({viewport:{width:1280,height:800}}), page=await context.newPage(), errors=[], results=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const pass=(name,data={})=>{results.push({name,...data});console.log('PASS',name,JSON.stringify(data));};
const ready=()=>page.waitForFunction(()=>window.__ready,null,{timeout:120000});
const setup=()=>page.evaluate(()=>{window.__app.player.lock=()=>{};});
await page.goto('http://127.0.0.1:8780/index.html?fast=1');await ready();await setup();
await page.click('#enter');assert(await page.locator('#controls').isVisible());assert.match(await page.locator('#controlsBody').textContent(),/空格/);await page.screenshot({path:'../../evidence/hud_help_zh.png'});
await page.click('#btn-lang');assert.match(await page.locator('#controlsBody').textContent(),/Space/);await page.screenshot({path:'../../evidence/hud_help_en.png'});
await page.click('#controlsClose');assert.equal(await page.evaluate(()=>localStorage.getItem('croton-controls-dismissed')),'1');
await page.keyboard.press('/');assert(await page.locator('#controls').isVisible());await page.keyboard.press('?');assert(!(await page.locator('#controls').isVisible()));
await page.click('#btn-help');assert(await page.locator('#controls').isVisible());await page.click('#btn-help');assert(!(await page.locator('#controls').isVisible()));pass('tutorial auto-show, zh/en, chip, / and ?');
await page.reload();await ready();await setup();await page.click('#enter');assert(!(await page.locator('#controls').isVisible()));pass('tutorial dismissal persists');
const pins=await page.evaluate(()=>{const a=window.__app;return Object.fromEntries(['rn','pano','photo'].map(k=>[k,a.markers.pins.filter(p=>p.kind===k).length]));});assert(pins.rn>0&&pins.pano>0&&pins.photo>0);
assert(await page.evaluate(()=>window.__app.markers.pins.every(p=>p.kind!=='photo'||p.spot.quality!=='poor')));
const poseMatch=await page.evaluate(()=>{const a=window.__app,v=a.viewpoints.targets.find(v=>v.gallery===8);return {x:v.x,y:v.y,eye:v.eye};});assert.deepEqual(poseMatch,{x:.8,y:-2.2,eye:1.2});pass('three colours and vetted poses',pins);
if (!process.env.HUD_FAST) for(const [k,id] of [['rn','btn-views'],['pano','btn-panos'],['photo','btn-photos']]) {
 await page.click('#'+id);await page.waitForTimeout(80);
 const r=await page.evaluate(k=>{const a=window.__app; a.minimap.drawBig();return {enabled:{...a.markers.enabled},headKinds:a.markers.heads.map(h=>h.userData.pin.kind),mapVisible:a.minimap.isVisible(k)};},k);
 assert.equal(r.enabled[k],false);for(const j of ['rn','pano','photo'].filter(j=>j!==k))assert.equal(r.enabled[j],true);assert(!r.headKinds.includes(k));assert.equal(r.mapVisible,false);
 await page.reload();await ready();await setup();await page.click('#enter');assert.equal(await page.evaluate(k=>window.__app.markers.enabled[k],k),false);assert.equal(await page.locator('#'+id).getAttribute('aria-pressed'),'false');
 await page.click('#'+id);assert.equal(await page.evaluate(k=>window.__app.markers.enabled[k],k),true);pass(k+' toggle independent, minimap and reload');
}
await page.evaluate(()=>{const a=window.__app;a.player.teleport(.8,2.2,142);});await page.waitForTimeout(700);await page.screenshot({path:'../../evidence/hud_pins_all.png'});
async function aimPin(kind) {
 return await page.evaluate(kind=>{
  const a=window.__app,pins=a.markers.pins.filter(p=>p.kind===kind);
  for(const p of pins)for(const offset of [[0,2],[2,0],[-2,0],[0,-2],[0,3]]){
   a.player.teleport(p.spot.x+offset[0],-p.spot.y+offset[1],0);a.player.eye=a.player.eyeHeight;a.player.yaw=Math.atan2(offset[0],offset[1]);a.player.update(1/60);a.markers.update(1/60);a.scene.updateMatrixWorld(true);
   const v=p.head.getWorldPosition(new a.THREE.Vector3()).project(a.camera);if(Math.abs(v.x)>.8||Math.abs(v.y)>.8||v.z>1)continue;
   const hit=a.markers.pick(new a.THREE.Vector2(v.x,v.y));if(hit?.pin===p)return {id:p.target.id,kind,x:(v.x+1)/2*innerWidth,y:(1-v.y)/2*innerHeight,spot:p.spot};
  }
  throw Error('No reachable '+kind+' pin');
 },kind);
}
for(const kind of ['rn','pano','photo']){
 const p=await aimPin(kind);await page.waitForTimeout(250);await page.mouse.move(p.x,p.y);await page.waitForTimeout(150);assert(await page.locator('#label').evaluate(e=>e.classList.contains('show')));
 await page.screenshot({path:'hud_pin_'+kind+'.png'});
 await page.mouse.down();await page.waitForTimeout(80);await page.mouse.up();
 await page.waitForFunction(k=>!window.__app.viewpoints.fly&&window.__app.markers.card?.ready&&window.__app.markers.card.pin.kind===k,kind,{timeout:20000});await page.waitForTimeout(800);
 const r=await page.evaluate(()=>{const a=window.__app,c=a.markers.card;return {kind:c.pin.kind,current:a.viewpoints.current.id,x:a.player.pos.x,y:-a.player.pos.z,compare:a.viewpoints.compareOpen,pano:a.viewpoints.panoActive,loaded:!!c.imgs[c.i]||!!c.video};});console.log('pin arrival',kind,JSON.stringify(r));assert.equal(r.current,p.id);assert.equal(r.compare,false);assert.equal(r.pano,false);assert.equal(r.loaded,true);assert(Math.abs(r.x-p.spot.x)<.01&&Math.abs(r.y-p.spot.y)<.01);
 await page.screenshot({path:'hud_card_'+kind+'.png'});pass(kind+' pin hover + click flies to framed card',r);
 if(kind==='photo') {await page.keyboard.press('c');assert(await page.evaluate(()=>window.__app.viewpoints.compareOpen));await page.keyboard.press('c');assert(!(await page.evaluate(()=>window.__app.viewpoints.compareOpen)));pass('C photo compare');}
 if(kind==='pano') {await page.keyboard.press('c');await page.waitForFunction(()=>window.__app.viewpoints.panoActive);const looked=await page.evaluate(()=>{const p=window.__app.player,before=p.yaw;p.locked=true;document.getElementById('gl').dispatchEvent(new MouseEvent('mousemove',{movementX:80,movementY:0}));p.locked=false;return Math.abs(p.yaw-before)>.1;});assert(looked);await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.__app.player.pos.y),0);await page.keyboard.press('c');assert(!(await page.evaluate(()=>window.__app.viewpoints.panoActive)));pass('C pano enter/exit and no pano jump');}
 await page.evaluate(()=>window.__app.markers.closeCard());await page.waitForTimeout(400);
}
const trajectories=await page.evaluate(()=>{
 const a=window.__app,p=a.player,out={};
 for(const walking of [false,true]){
  p.keys.clear();p.teleport(0,11.5,0);p.eyeHeight=1.62;p.eye=1.62;if(walking)p.keys.add('KeyW');for(let i=0;i<30;i++)p.update(1/120);
  const start={x:p.pos.x,z:p.pos.z,y:a.camera.position.y};p.jump();const samples=[];for(let i=0;i<120;i++){p.update(1/120);samples.push({t:(i+1)/120,y:a.camera.position.y,feet:p.pos.y,z:p.pos.z});}
  out[walking?'walking':'standing']={start,samples,apex:Math.max(...samples.map(s=>s.feet)),endY:a.camera.position.y,airtime:samples.find(s=>s.feet===0)?.t,airDisplacement:Math.abs(samples.find(s=>s.feet===0).z-start.z)};
 }
 p.keys.clear();p.teleport(0,11.5,0);p.eyeHeight=2.1;p.eye=2.1;p.jump();let ceiling=0;for(let i=0;i<120;i++){p.update(1/120);ceiling=Math.max(ceiling,p.pos.y+p.eye+.17);}out.ceiling=ceiling;p.eyeHeight=1.62;p.eye=1.62;
 p.teleport(0,11.5,0);p.sit({position:new a.THREE.Vector3(0,.45,11.5),facing:0});for(let i=0;i<120;i++)p.update(1/120);p.jump();out.seated={seat:!!p.seat,y:p.pos.y,vy:p.jumpVel};
 a.tourCtl.start();p.jump();out.tour={active:a.tourCtl.active,y:p.pos.y,vy:p.jumpVel};a.tourCtl.stop();a.viewpoints.fly=null;p.enabled=true;p.driven=false;
 a.viewpoints.goTo({kind:'point',x:0,y:-12});p.jump();out.fly={y:p.pos.y,vy:p.jumpVel};a.viewpoints.fly=null;p.enabled=true;p.driven=false;p.teleport(0,11.5,0);
 return out;
});
for(const k of ['standing','walking']){const r=trajectories[k];assert(Math.abs(r.apex-.45)<.01);assert(Math.abs(r.endY-1.62)<.02);assert(r.airtime>.55&&r.airtime<.65);}assert(trajectories.walking.airDisplacement>1);assert(trajectories.ceiling<=2.441);assert.deepEqual(trajectories.seated,{seat:false,y:0,vy:0});assert.equal(trajectories.tour.vy,0);assert.equal(trajectories.fly.vy,0);
pass('jump trajectory and exclusions',{standing:{apex:trajectories.standing.apex,airtime:trajectories.standing.airtime,endY:trajectories.standing.endY},walking:{apex:trajectories.walking.apex,airtime:trajectories.walking.airtime,airDisplacement:trajectories.walking.airDisplacement},ceiling:trajectories.ceiling});
await page.keyboard.down('w');await page.waitForTimeout(300);const keyStart=await page.evaluate(()=>({y:window.__app.camera.position.y,z:window.__app.player.pos.z}));await page.keyboard.press('Space');const realtime=[];for(let i=0;i<16;i++){await page.waitForTimeout(50);realtime.push(await page.evaluate(()=>({y:window.__app.camera.position.y,z:window.__app.player.pos.z,feet:window.__app.player.pos.y})));}await page.keyboard.up('w');assert(Math.max(...realtime.map(s=>s.y))-keyStart.y>.4);assert(realtime.at(-1).feet===0);assert(Math.abs(realtime[8].z-keyStart.z)>.6);pass('real Space key while W held',{apexDelta:Math.max(...realtime.map(s=>s.y))-keyStart.y,airborne:realtime.filter(s=>s.feet>0).length});
await page.click('#btn-rednote');assert(await page.locator('#panel').isVisible());await page.click('#panelClose');await page.click('#btn-rednote');assert(await page.locator('#panel').isVisible());await page.click('#panelClose');await page.click('#btn-zillow');assert(await page.locator('#panelBody .vp').count()>0);await page.click('#panelClose');pass('RedNote and Zillow panels remain reachable');
const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),touch=await mobile.newPage();await touch.goto('http://127.0.0.1:8780/index.html?x=0&y=-11.5&h=0');await touch.waitForFunction(()=>window.__ready,null,{timeout:120000});await touch.click('#btn-help');assert.match(await touch.locator('#controlsBody').textContent(),/摇杆/);assert(await touch.locator('#touchJump').isVisible());await touch.click('#btn-help');await touch.click('#touchJump');await touch.waitForTimeout(200);assert(await touch.evaluate(()=>window.__app.player.pos.y>.2));await touch.waitForTimeout(600);assert.equal(await touch.evaluate(()=>window.__app.player.pos.y),0);pass('touch help and jump button');await touch.screenshot({path:'../../evidence/hud_touch.png'});await mobile.close();
assert.deepEqual(errors,[]);pass('no console or page errors');await writeFile('hud_results.json',JSON.stringify({results,trajectories,realtime,errors},null,2));await browser.close();
