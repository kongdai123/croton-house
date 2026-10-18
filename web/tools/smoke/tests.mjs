// The UI smoke tests (gate d). Each test is { name, timeoutS?, run(ctx) }; they share one page (the house loads once), in order,
// and each leaves the house as it found it. A test fails by throwing; ctx.expect(cond, message) is the assertion.
// Code inside page.evaluate / waitForFunction runs in the browser: it cannot see anything of this module except its arguments.
import { sampleStats, parseColor, isBlank, switchStance, sliderRun, sliderSide } from './helpers.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = v => JSON.stringify(v, (k, x) => (typeof x === 'number' ? +x.toFixed(3) : x));

// Defined once in the page after the app is up (window.__smoke): small helpers the tests share.
function installInPage() {
  const a = window.__app;
  window.__smoke = {
    // interact.js doorIsOpen
    doorIsOpen: d => (d.kind === 'french' || d.kind === 'bifold' ? d.target > 0.5 : d.kind === 'slider' ? d.open > 0.3 : Math.abs(d.target ?? 0) > 0.1),
    home: { x: a.player.pos.x, z: a.player.pos.z, yaw: a.player.yaw, pitch: a.player.pitch },
    place(x, z, yaw, pitch = 0) {
      const p = a.player;
      p.keys.clear(); p.pos.set(x, 0, z); p.yaw = yaw; p.pitch = pitch; p.vel.set(0, 0, 0); p.resetJump();
      p.update(1e-4); a.camera.updateMatrixWorld(true);
    },
    restore() { const h = window.__smoke.home; window.__smoke.place(h.x, h.z, h.yaw, h.pitch); },
    // switches still fading toward their manual target
    settled() { return a.baked.lampGroups.records.every(r => !r.group || r.group.always || !r.toggle.manual || Math.abs(r.level - +r.toggle.on) < 1e-3); },
    groupRecords() { return a.baked.lampGroups.records; },
  };
}


// Runs in the page before its scripts (addInitScript): keeps the WebGL context of #gl reachable as window.__ctxLoss and, per
// arg.when, loses it with WEBGL_lose_context and restores it arg.restoreMs later. when: 'early' = arg.afterMs after the context
// exists (the house is still being built); 'ready' = the moment the Enter button enables, while the shaders compile and the
// first frame is drawn; 'never' = only on demand (window.__ctxLoss.lose()).
function hookContext(arg) {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = original.call(this, type, ...rest);
    if (gl && /webgl/.test(String(type)) && this.id === 'gl' && !window.__ctxLoss) {
      const ext = gl.getExtension('WEBGL_lose_context');
      const S = window.__ctxLoss = { gl, lost: 0, restored: 0, phases: [], lose: () => ext.loseContext(), restore: () => ext.restoreContext() };
      const phase = () => (window.__app ? 'running' : document.getElementById('enter')?.disabled === false ? 'warm-up' : 'building');
      this.addEventListener('webglcontextlost', () => { S.lost++; S.phases.push(phase()); setTimeout(() => { if (arg.restoreMs >= 0 && gl.isContextLost()) ext.restoreContext(); }, arg.restoreMs); });
      this.addEventListener('webglcontextrestored', () => { S.restored++; });
      if (arg.when === 'early') setTimeout(() => ext.loseContext(), arg.afterMs);
      else if (arg.when === 'ready') { const t = setInterval(() => { if (document.getElementById('enter')?.disabled === false && !window.__app) { clearInterval(t); ext.loseContext(); } }, 20); }
    }
    return gl;
  };
}

async function enterHouse(ctx, page = ctx.page) {
  await ctx.untilOn(page, () => !document.getElementById('enter').disabled, null, 120000, 'the Enter button to enable');
  // under SwiftShader entering compiles the house's programs on the main thread: the click is acknowledged only after
  // that (minutes on a 4-core machine); the test's own time limit bounds the wait
  await page.click('#enter', { timeout: 0 });
  await ctx.untilOn(page, () => document.getElementById('title').classList.contains('hidden'), null, 10000, 'the landing page to close');
  // the first-steps card opens on entering; Escape only closes it
  if (await page.evaluate(() => !document.getElementById('firststeps').classList.contains('hidden'))) {
    await page.keyboard.press('Escape');
    await ctx.untilOn(page, () => document.getElementById('firststeps').classList.contains('hidden'), null, 5000, 'the first-steps card to close on Escape');
  }
}

const needBaked = async ctx => { ctx.expect(await ctx.page.evaluate(() => !!window.__app.baked && !!window.__app.baked.lampGroups), 'baked lighting with lamp groups is not active (see the load test)'); };

export const TESTS = [
  {
    name: 'load', timeoutS: 420,
    async run(ctx) {
      const page = await ctx.openMain();   // ctx.page is null until openMain sets it
      // landing
      const landing = await page.evaluate(() => ({ title: !document.getElementById('title').classList.contains('hidden'), w: document.getElementById('gl').width, h: document.getElementById('gl').height, ready: window.__ready === true, enter: !!document.getElementById('enter') }));
      ctx.expect(landing.title && landing.enter, `the landing page is not showing: ${fmt(landing)}`);
      ctx.expect(landing.w > 0 && landing.h > 0, `the canvas has no size: ${fmt(landing)}`);
      await enterHouse(ctx);
      await page.evaluate(installInPage);
      const st = await page.evaluate(() => { const s = window.__app.state; return { ready: s.ready, baked: s.baked, fallback: s.bakedFallback ?? null, slot: s.bakedSlot, slots: s.bakedSlots, tier: s.tier, quality: s.quality, gpu: s.gpu }; });
      ctx.log(`tier ${st.tier}, quality ${st.quality}, slot ${st.slot} of [${st.slots}], gpu ${st.gpu}`);
      ctx.expect(st.baked === true, `baked mode is off (state.baked=${st.baked})`);
      ctx.expect(!st.fallback, `fell back to legacy lighting: ${st.fallback}`);
      ctx.expect(await page.evaluate(() => !!window.__app.baked), 'window.__app.baked is missing');
      // let the programs link, then audit the samplers
      await ctx.frames(30);
      const audit = await page.evaluate(() => window.__app.baked.auditSamplers());
      ctx.expect(audit && audit.failed.length === 0, `shader programs failed to link: ${fmt(audit?.failed)}`);
      ctx.expect(audit.max <= 16, `a baked program uses ${audit.max} samplers (limit 16): ${fmt(audit.worst)}`);
      ctx.log(`samplers max ${audit.max}/${audit.limit}, programs ${audit.programs}`);
    },
  },
  {
    name: 'tour',
    async run(ctx) {
      const { page } = ctx;
      const tour = () => page.evaluate(() => { const a = window.__app; return { active: a.tourCtl.active, touring: document.body.classList.contains('touring'), on: document.getElementById('btn-tour').classList.contains('on'), driven: !!a.player.driven, enabled: a.player.enabled, fly: !!a.viewpoints.fly }; });
      // button on, button off
      await page.click('#btn-tour');
      await ctx.until(() => window.__app.tourCtl.active, null, 5000, 'the tour to start after clicking #btn-tour');
      let s = await tour();
      ctx.expect(s.touring && s.on, `tour started but the page does not show it: ${fmt(s)}`);
      await page.click('#btn-tour');
      await ctx.until(() => !window.__app.tourCtl.active, null, 5000, 'the tour to stop after clicking #btn-tour again');
      s = await tour();
      ctx.expect(!s.touring && !s.on && !s.driven && s.enabled, `tour stopped but left state behind: ${fmt(s)}`);
      // stop in the middle of a flight (the walking-locked regression)
      await page.click('#btn-tour');
      await ctx.until(() => { const a = window.__app; return a.tourCtl.active && a.tourCtl.i >= 1 && !!a.viewpoints.fly; }, null, 180000, 'a tour flight (stop 2 or later)');
      await page.click('#btn-tour');
      await ctx.until(() => !window.__app.tourCtl.active, null, 5000, 'the tour to stop mid-flight');
      s = await tour();
      ctx.expect(!s.driven && s.enabled && !s.fly, `stopping mid-flight left the player driven or the flight alive: ${fmt(s)}`);
      // walking works: hold a movement key until the player has moved (some key may face a wall)
      let moved = 0, key = null;
      for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) {
        const p0 = await page.evaluate(() => { const p = window.__app.player.pos; return { x: p.x, z: p.z }; });
        await page.keyboard.down(k);
        try {
          await page.waitForFunction(p0 => Math.hypot(window.__app.player.pos.x - p0.x, window.__app.player.pos.z - p0.z) > 0.3, p0, { timeout: 12000 * ctx.session.slow });
        } catch { /* blocked this way, try the next key */ }
        await page.keyboard.up(k);
        moved = await page.evaluate(p0 => Math.hypot(window.__app.player.pos.x - p0.x, window.__app.player.pos.z - p0.z), p0);
        if (moved > 0.3) { key = k; break; }
      }
      ctx.expect(moved > 0.3, `walking is dead after stopping the tour mid-flight (moved ${moved.toFixed(3)} m with W, S, A, D)`);
      ctx.log(`walked ${moved.toFixed(2)} m with ${key} after the stop`);
      s = await tour();
      ctx.expect(!s.active && !s.driven, `after walking: ${fmt(s)}`);
      await page.evaluate(() => window.__smoke.restore());
    },
  },
  {
    name: 'switches', timeoutS: 420,
    async run(ctx) {
      const { page } = ctx;
      await needBaked(ctx);
      const plates = await page.evaluate(() => {
        const out = []; window.__app.scene.traverse(o => { if (o.name.startsWith('wall-switch-')) out.push(o.name); });
        return out;
      });
      ctx.expect(plates.length > 0, 'no wall-switch-* objects in the scene');
      ctx.log(`${plates.length} wall switches`);
      const report = [], failures = [];
      for (let i = 0; i < plates.length; i++) try {
        const info = await page.evaluate(i => {
          const a = window.__app, plates = []; a.scene.traverse(o => { if (o.name.startsWith('wall-switch-')) plates.push(o); });
          const plate = plates[i], p = plate.getWorldPosition(new a.THREE.Vector3()), lg = a.baked.lampGroups;
          const rec = lg.records.find(r => r.toggle === plate.userData.lightSwitch);
          const members = rec?.group ? lg.records.filter(r => r.group === rec.group).length : 0;
          return { name: plate.name, x: p.x, y: p.y, z: p.z, ry: plate.rotation.y, matched: !!rec?.group, members, on: plate.userData.lightSwitch.on };
        }, i);
        if (!info.matched) { report.push(`${info.name}: matches no baked lamp group (skipped)`); continue; }
        // Stand where a visitor can: 0.7 m in front of the plate first (switchStance), else further back or to the side
        // (the click reaches 4 m; a bed or a counter may stand in front of a plate), never where the walk's colliders would push the player away; aim at the plate's centre.
        const first = switchStance(info);
        for (const target of [!info.on, info.on]) {   // press it, then press it back
          const r = await page.evaluate(({ i, first }) => {
            const a = window.__app, T = a.THREE, plates = []; a.scene.traverse(o => { if (o.name.startsWith('wall-switch-')) plates.push(o); });
            const plate = plates[i], c = plate.getWorldPosition(new T.Vector3());
            const ry = new T.Euler().setFromQuaternion(plate.getWorldQuaternion(new T.Quaternion()), 'YXZ').y;
            const n = { x: Math.sin(ry), z: Math.cos(ry) }, l = { x: Math.cos(ry), z: -Math.sin(ry) }, tried = [];
            const spots = [{ x: first.x, z: first.z }];
            for (const d of [0.7, 1.0, 1.4, 1.9, 2.5, 3.2]) for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.5, -1.5]) spots.push({ x: c.x + n.x * d + l.x * off, z: c.z + n.z * d + l.z * off });
            for (const s of spots) {
              window.__smoke.place(s.x, s.z, 0, 0);
              const p = a.player.pos;
              if (Math.hypot(p.x - s.x, p.z - s.z) > 0.02) { tried.push(`(${s.x.toFixed(2)}, ${s.z.toFixed(2)}) blocked`); continue; }
              const e = a.camera.getWorldPosition(new T.Vector3()), dx = c.x - e.x, dz = c.z - e.z;
              window.__smoke.place(s.x, s.z, Math.atan2(-dx, -dz), Math.atan2(c.y - e.y, Math.hypot(dx, dz)));
              a.interact.pointer.set(0, 0);
              const hit = a.interact.pick(), root = hit?.root ?? null;
              if (root === plate) { a.interact.press(); a.interact.release(); return { pickedPlate: true, stance: s, tried }; }
              tried.push(`(${s.x.toFixed(2)}, ${s.z.toFixed(2)}) picks ${root ? (root.name || root.userData.id || '?') : hit?.door ? 'door ' + hit.door.id : hit ? 'other' : 'nothing'}`);
            }
            return { pickedPlate: false, tried };
          }, { i, first });
          ctx.expect(r.pickedPlate, `${info.name} at (${info.x.toFixed(2)}, ${info.z.toFixed(2)}): no standing spot within 3.2 m (1.5 m to either side) picks the plate: ${r.tried.filter((t, k, all) => all.indexOf(t) === k).slice(0, 10).join('; ')}`);
          try { await ctx.until(() => window.__smoke.settled(), null, 30000, 'the switch fade to finish'); } catch (e) { throw new Error(`${info.name}: ${e.message}`); }
          const after = await page.evaluate(({ i, target }) => {
            const a = window.__app, plates = []; a.scene.traverse(o => { if (o.name.startsWith('wall-switch-')) plates.push(o); });
            const lg = a.baked.lampGroups, rec = lg.records.find(r => r.toggle === plates[i].userData.lightSwitch), g = rec.group;
            const members = lg.records.filter(r => r.group === g).map(r => ({ on: r.toggle.on, level: +r.level.toFixed(3) }));
            return { members, groupLevel: lg.levels[g.index], gain: g.gain ?? 1 };
          }, { i, target });
          const bad = after.members.filter(m => m.on !== target || Math.abs(m.level - +target) > 0.01);
          ctx.expect(bad.length === 0, `${info.name}: pressing it to ${target ? 'on' : 'off'} left group members behind: ${fmt(after.members)}`);
          ctx.expect(Math.abs(after.groupLevel - after.gain * +target) < 0.01, `${info.name}: the group's baked level is ${after.groupLevel}, expected ${after.gain * +target}`);
        }
        report.push(`${info.name}: ${info.members} member(s)`);
      } catch (e) { failures.push(e.message); await page.evaluate(() => { const a = window.__app; a.baked.lampGroups.reset(a.baked.slotName); }); }
      ctx.log(report.join('; '));
      // every plate is tried, so one bad plate does not hide the others
      ctx.expect(failures.length === 0, `${failures.length} of ${plates.length} switches failed:\n  ${failures.join('\n  ')}`);
      await page.evaluate(() => { const a = window.__app; a.baked.lampGroups.reset(a.baked.slotName); window.__smoke.restore(); });
    },
  },
  {
    name: 'doors', timeoutS: 300,
    async run(ctx) {
      const { page } = ctx;
      const doors = await page.evaluate(() => window.__app.getDoors().map((d, i) => ({ i, id: d.id, kind: d.kind, open: window.__smoke.doorIsOpen(d), cx: d.plan.cx, cy: d.plan.cy, isH: d.plan.isH, w: d.w })));
      ctx.expect(doors.length > 0, 'no doors');
      ctx.log(`${doors.length} doors: ${[...new Set(doors.map(d => d.kind))].join(', ')}`);
      // every door toggles through interact.toggleDoor (what a click calls) and back
      for (const d of doors) {
        const r = await page.evaluate(i => {
          const a = window.__app, door = a.getDoors()[i], o = window.__smoke.doorIsOpen(door);
          a.interact.toggleDoor(door); const t1 = window.__smoke.doorIsOpen(door);
          a.interact.toggleDoor(door); const t2 = window.__smoke.doorIsOpen(door);
          return { o, t1, t2 };
        }, d.i);
        ctx.expect(r.t1 !== r.o, `door ${d.id} (${d.kind}) did not toggle: ${fmt(r)}`);
        ctx.expect(r.t2 === r.o, `door ${d.id} (${d.kind}) did not toggle back: ${fmt(r)}`);
      }
      // sliders: closed ones block walking from either side; open ones let you through
      const walk = run => page.evaluate(run => {
        const a = window.__app, p = a.player;
        window.__smoke.place(run.start.x, run.start.z, run.yaw, 0);
        p.keys.add('KeyW');
        let minSide = Infinity;
        for (let k = 0; k < 75; k++) {   // 2.5 s of simulated walking at 30 Hz, about 6 m of free path
          p.update(1 / 30);
          minSide = Math.min(minSide, run.side * (p.pos[run.axis] - run.plane));
        }
        p.keys.delete('KeyW');
        return { x: p.pos.x, z: p.pos.z, minSide };
      }, run);
      const setOpen = (i, want) => page.evaluate(({ i, want }) => { const a = window.__app, d = a.getDoors()[i]; if (window.__smoke.doorIsOpen(d) !== want) a.interact.toggleDoor(d); return window.__smoke.doorIsOpen(d); }, { i, want });
      const sliders = doors.filter(d => d.kind === 'slider');
      ctx.expect(sliders.length > 0, 'no slider doors');
      for (const d of sliders) {
        ctx.expect(await setOpen(d.i, false) === false, `slider ${d.id} would not close`);
        for (const side of [-1, 1]) {
          const run = sliderRun(d, side), r = await walk(run);
          ctx.expect(r.minSide >= 0, `closed slider ${d.id}: walking into the glass from side ${side} got through (reached ${r.minSide.toFixed(2)} m past the wall plane at ${fmt({ x: r.x, z: r.z })})`);
          ctx.expect(sliderSide(run, { x: r.x, z: r.z }) >= 0, `closed slider ${d.id}: ended on the far side`);
        }
        ctx.expect(await setOpen(d.i, true) === true, `slider ${d.id} would not open`);
        let crossed = false; const tries = [];
        for (const side of [-1, 1]) { const r = await walk(sliderRun(d, side)); tries.push(r.minSide); if (r.minSide < -0.05) crossed = true; }
        ctx.expect(crossed, `open slider ${d.id}: could not walk through from either side (closest approach ${fmt(tries)} m)`);
        await setOpen(d.i, d.open);
      }
      await page.evaluate(() => window.__smoke.restore());
    },
  },
  {
    name: 'quality-and-slots', timeoutS: 900,
    async run(ctx) {
      const { page } = ctx;
      await needBaked(ctx);
      // three manual switches in three different groups
      const picked = await page.evaluate(() => {
        const lg = window.__app.baked.lampGroups, seen = new Set(), idx = [];
        lg.records.forEach((r, i) => { if (r.group && !r.group.always && !seen.has(r.group) && idx.length < 3) { seen.add(r.group); idx.push(i); } });
        for (const i of idx) lg.records[i].toggle.set(!lg.records[i].toggle.on);
        return idx;
      });
      ctx.expect(picked.length > 0, 'no switchable lamp groups');
      await ctx.until(() => window.__smoke.settled(), null, 30000, 'the switches to settle');
      const snap = () => page.evaluate(idx => {
        const a = window.__app, lg = a.baked?.lampGroups;
        return { baked: !!a.baked, fallback: a.state.bakedFallback ?? null, quality: a.state.quality, sw: lg ? idx.map(i => ({ on: lg.records[i].toggle.on, manual: lg.records[i].toggle.manual, level: +lg.records[i].level.toFixed(3) })) : null };
      }, picked);
      const before = await snap();
      ctx.expect(before.sw.every(s => s.manual), `setup: switches are not manual: ${fmt(before)}`);
      const first = before.quality, other = first === 'mobile' ? 'laptop' : 'mobile';
      for (const name of [other, first]) {
        await page.evaluate(name => window.__app.setQuality(name), name);   // resolves when the atlases are swapped
        await ctx.until(() => window.__smoke.settled(), null, 30000, 'the switches to settle after the quality change');
        const now = await snap();
        ctx.expect(now.baked && !now.fallback, `quality ${name}: baked lighting fell back to legacy (${now.fallback})`);
        ctx.expect(now.quality === name, `quality did not change to ${name}: ${now.quality}`);
        ctx.expect(fmt(now.sw) === fmt(before.sw), `quality ${name} reset the switches: before ${fmt(before.sw)}, after ${fmt(now.sw)}`);
      }
      // J-key path is covered in the keyboard test. Slot switches: each available slot, switches back to its defaults.
      const slots = await page.evaluate(() => ({ list: [...window.__app.baked.availableSlots], cur: window.__app.baked.slotName }));
      if (slots.list.length < 2) { ctx.log(`only slot ${slots.list} available, slot switching not exercised`); return; }
      for (const name of [...slots.list.filter(s => s !== slots.cur), slots.cur]) {
        await page.evaluate(() => { const lg = window.__app.baked.lampGroups, r = lg.records.find(r => r.group && !r.group.always); r.toggle.set(!r.toggle.on); });   // a manual choice the slot change must end
        const ok = await page.evaluate(name => window.__app.setBakedSlot(name, { quiet: true }), name);
        ctx.expect(ok === true, `setBakedSlot('${name}') returned ${ok}`);
        const r = await page.evaluate(name => {
          const a = window.__app, lg = a.baked.lampGroups, wrong = [];
          for (const rec of lg.records) {
            if (!rec.group) continue;
            const list = rec.group.defaultOn ?? rec.toggle.lighting?.defaultOn ?? [], want = !!rec.group.always || list.includes(name);
            if (rec.toggle.manual || rec.toggle.on !== want) wrong.push({ group: rec.group.index, on: rec.toggle.on, manual: rec.toggle.manual, want });
          }
          const warming = document.getElementById('warming');
          return { slot: a.baked.slotName, stateSlot: a.state.bakedSlot, pending: a.state.bakedSlotPending ?? null, wrong, overlay: !warming.classList.contains('hidden'), fallback: a.state.bakedFallback ?? null };
        }, name);
        ctx.expect(r.slot === name && r.stateSlot === name, `slot '${name}': baked.slotName=${r.slot}, state.bakedSlot=${r.stateSlot}`);
        ctx.expect(!r.pending && !r.fallback, `slot '${name}': pending=${r.pending}, fallback=${r.fallback}`);
        ctx.expect(r.wrong.length === 0, `slot '${name}': switches not at the slot's defaults: ${fmt(r.wrong)}`);
        await ctx.until(() => document.getElementById('warming').classList.contains('hidden'), null, 10000, `the loading overlay to clear after slot '${name}'`);
      }
      await page.evaluate(() => { const a = window.__app; a.baked.lampGroups.reset(a.baked.slotName); });
    },
  },
  {
    name: 'resize',
    async run(ctx) {
      const { page } = ctx;
      // A ResizeObserver registered after the app's runs in the same notification, right after the app's resize handler: the canvas
      // must already hold the scene then (setSize clears the drawing buffer; the handler repaints at once).
      await page.evaluate(() => {
        const c = document.getElementById('gl'), t = document.createElement('canvas'); t.width = t.height = 8;
        const x = t.getContext('2d', { willReadFrequently: true }), read = () => { x.clearRect(0, 0, 8, 8); x.drawImage(c, 0, 0, 8, 8); return Array.from(x.getImageData(0, 0, 8, 8).data); };
        window.__smoke.samples = []; window.__smoke.readCanvas = () => ({ w: c.width, h: c.height, px: read() });
        new ResizeObserver(() => { window.__smoke.samples.push(window.__smoke.readCanvas()); }).observe(c);
      });
      const bg = parseColor(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)), bgMean = (bg[0] + bg[1] + bg[2]) / 3;
      await sleep(1000);
      const pre = await page.evaluate(() => window.__smoke.readCanvas());
      ctx.expect(!isBlank(sampleStats(pre.px), bgMean), `control: the canvas is already blank before resizing (${fmt(sampleStats(pre.px))}, background ${bgMean.toFixed(1)}); the scene may be too dark for this check`);
      const sizes = [[1100, 700], [820, 620], [960, 600]];
      for (const [w, h] of sizes) {
        // the app applies at most one fit per 500 ms, and after an immediate fit it also schedules a trailing one 500 ms
        // later (main.js scheduleFit: window 'resize' and the ResizeObserver both call it), which restarts the 500 ms: wait
        // out both so this resize is applied inside the observer callback
        await sleep(1300);
        const n = await page.evaluate(() => window.__smoke.samples.length);
        await page.setViewportSize({ width: w, height: h });
        await ctx.until(n => window.__smoke.samples.length > n, n, 15000, `a ResizeObserver callback for ${w}x${h}`);
        const s = await page.evaluate(n => window.__smoke.samples[n], n);
        const dpr = await page.evaluate(() => devicePixelRatio);
        ctx.expect(s.w === Math.round(w * dpr), `after resizing to ${w}x${h} the drawing buffer is ${s.w}x${s.h}: the app's resize handler had not run before the observer (throttled?)`);
        const st = sampleStats(s.px);
        ctx.expect(!isBlank(st, bgMean), `the canvas is blank right after resizing to ${w}x${h} (mean ${st.mean.toFixed(1)}, alpha ${st.alpha.toFixed(0)}, background ${bgMean.toFixed(1)})`);
      }
    },
  },
  {
    name: 'keyboard', timeoutS: 420,
    async run(ctx) {
      const { page } = ctx;
      const key = k => page.keyboard.press(k);
      const q = () => page.evaluate(() => { const a = window.__app; return { tour: a.tourCtl.active, quality: a.state.quality, slot: a.state.bakedSlot ?? null, pending: a.state.bakedSlotPending ?? null, pins: { ...a.markers.enabled }, help: !document.getElementById('controls').classList.contains('hidden'), title: !document.getElementById('title').classList.contains('hidden'), fs: !document.getElementById('firststeps').classList.contains('hidden') }; });
      ctx.expect(!(await q()).title, 'setup: the landing page is showing');
      // T: tour on, off
      await key('KeyT'); await ctx.until(() => window.__app.tourCtl.active, null, 5000, 'T to start the tour');
      await key('KeyT'); await ctx.until(() => !window.__app.tourCtl.active, null, 5000, 'T to stop the tour');
      // J: quality flips and flips back
      const q0 = (await q()).quality;
      await key('KeyJ'); await ctx.until(q0 => window.__app.state.quality !== q0, q0, 5000, 'J to change the quality');
      await key('KeyJ'); await ctx.until(q0 => window.__app.state.quality === q0, q0, 5000, 'J to change the quality back');
      await page.evaluate(q0 => window.__app.setQuality(q0), q0);   // let the (possibly queued) atlas swaps finish
      ctx.expect(await page.evaluate(() => !!window.__app.baked && !window.__app.state.bakedFallback), 'J twice dropped baked lighting');
      // N: next time of day (baked: next slot; one slot only: a toast)
      const s0 = await q(), slots = await page.evaluate(() => window.__app.baked.availableSlots.length);
      if (slots > 1) {
        await key('KeyN');
        await ctx.until(s0 => window.__app.state.bakedSlot !== s0 && !window.__app.state.bakedSlotPending, s0.slot, 180000, 'N to switch the time of day');
        await page.evaluate(s0 => window.__app.setBakedSlot(s0, { quiet: true }), s0.slot);
        ctx.expect((await q()).slot === s0.slot, 'could not return to the starting slot');
      } else {
        await key('KeyN');
        ctx.expect(await page.evaluate(() => document.getElementById('toast').textContent.trim().length > 0), 'N with one slot should say so in a toast');
      }
      // H: all pins on or off, then back
      const h0 = (await q()).pins, allOn = Object.values(h0).every(Boolean);
      await key('KeyH'); await ctx.until(on => Object.values(window.__app.markers.enabled).every(v => v === on), !allOn, 5000, `H to turn all pins ${allOn ? 'off' : 'on'}`);
      await key('KeyH'); await ctx.until(on => Object.values(window.__app.markers.enabled).every(v => v === on), allOn, 5000, 'H to flip the pins back');
      // ? opens the help card, Escape closes it and leaves the house showing
      await key('Slash'); await ctx.until(() => !document.getElementById('controls').classList.contains('hidden'), null, 5000, '? to open the help card');
      await key('Escape'); await ctx.until(() => document.getElementById('controls').classList.contains('hidden'), null, 5000, 'Escape to close the help card');
      ctx.expect(!(await q()).title, 'Escape closed the help card and also opened the menu');
      // Enter: the introduction; Escape closes just that
      await key('Enter'); await ctx.until(() => !document.getElementById('firststeps').classList.contains('hidden'), null, 5000, 'Enter to open the introduction');
      await key('Escape'); await ctx.until(() => document.getElementById('firststeps').classList.contains('hidden'), null, 5000, 'Escape to close the introduction');
      ctx.expect(!(await q()).title, 'Escape closed the introduction and also opened the menu');
      // Escape with nothing open: the menu (landing), and again: back in
      await key('Escape'); await ctx.until(() => !document.getElementById('title').classList.contains('hidden'), null, 5000, 'Escape to open the menu');
      await key('Escape'); await ctx.until(() => document.getElementById('title').classList.contains('hidden'), null, 5000, 'Escape to leave the menu');
    },
  },
  {
    // A context lost and restored (a GPU reset, a backgrounded phone tab) during the load and after entering must neither stop the
    // start (window.__ready) nor leave the house unable to draw. Startup guard: web/src/startup_guard.js; postmortem row 20.
    name: 'context-loss', timeoutS: 900,
    async run(ctx) {
      const readCanvas = () => { const c = document.getElementById('gl'), t = document.createElement('canvas'); t.width = t.height = 8; const x = t.getContext('2d', { willReadFrequently: true }); x.clearRect(0, 0, 8, 8); x.drawImage(c, 0, 0, 8, 8); return Array.from(x.getImageData(0, 0, 8, 8).data); };
      const drawing = async (page, what) => {
        const f0 = await page.evaluate(() => window.__app.renderer.info.render.frame);
        await ctx.untilOn(page, f0 => window.__app.renderer.info.render.frame > f0 + 10 && !window.__ctxLoss.gl.isContextLost(), f0, 120000, `the house to keep drawing ${what}`);
        const bg = parseColor(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
        const px = await page.evaluate(readCanvas);
        ctx.expect(!isBlank(sampleStats(px), (bg[0] + bg[1] + bg[2]) / 3), `the canvas is blank ${what}: ${fmt(sampleStats(px))}`);
      };
      const info = page => page.evaluate(() => { const S = window.__ctxLoss, a = window.__app; return { lost: S.lost, restored: S.restored, phases: S.phases, ready: window.__ready === true, hdr: a.lighting.renderConfig.hdr, baked: a.state.baked }; });
      const loads = [['during the build', { when: 'early', afterMs: 2500, restoreMs: 1500 }, 'building'], ['during the shader warm-up', { when: 'ready', restoreMs: 1500 }, 'warm-up']];
      const main = ctx.page;
      let page = null, first = null;
      for (const [what, arg, phase] of loads) {
        const p = await ctx.session.newPage('', { init: hookContext, initArg: arg });   // resolves only when window.__ready is true
        const s = await info(p); first ??= s;
        ctx.log(`loss ${what}: lost ${s.lost}, restored ${s.restored}, at ${s.phases}, ready ${s.ready}, hdr ${s.hdr}, baked ${s.baked}`);
        ctx.expect(s.lost >= 1, `no context loss happened ${what}: the load finished before it (phases: ${s.phases}); the test checked nothing`);
        await ctx.untilOn(p, () => window.__ctxLoss.restored >= window.__ctxLoss.lost, null, 30000, `the context to be restored ${what}`);
        ctx.expect(s.ready, `window.__ready never became true after a loss ${what}`);
        ctx.expect(s.phases.includes(phase) || arg.when === 'early', `the loss did not hit the ${phase} phase (${s.phases})`);
        await enterHouse(ctx, p);
        await drawing(p, `after a loss ${what}`);
        await p.evaluate(async () => { const a = window.__app; await a.applyTime(); a.pets?.relight(); });   // the step that threw: time of day + pet relight
        if (page) await page.context().close().catch(() => {}); page = p;
      }
      // lost and restored again once the visitor is in: the house, the pets and a time change all still work
      ctx.page = page;   // the helpers (ctx.until, ctx.frames) act on ctx.page; the shared page comes back at the end
      for (const restoreMs of [1500, 100]) {
        const n = (await info(page)).lost;
        await page.evaluate(() => { window.__ctxLoss.lose(); });
        await ctx.untilOn(page, n => window.__ctxLoss.lost > n, n, 10000, 'the context to be lost');
        await sleep(restoreMs);
        await page.evaluate(() => { if (window.__ctxLoss.gl.isContextLost()) window.__ctxLoss.restore(); });
        await ctx.untilOn(page, n => window.__ctxLoss.restored > n, n, 30000, 'the context to be restored');
        await drawing(page, `after losing the context in the house (restored after ${restoreMs} ms)`);
        await page.evaluate(async () => { const a = window.__app; await a.applyTime(); a.pets?.relight(); });
      }
      const end = await info(page);
      ctx.expect(end.ready && end.hdr === first.hdr, `the lighting configuration changed across the losses (hdr ${first.hdr} -> ${end.hdr})`);
      ctx.page = main;
    },
  },
  {
    name: 'legacy', timeoutS: 420,
    async run(ctx) {
      const page = await ctx.openPage('?legacy&tier=mobile');
      await enterHouse(ctx, page);
      await page.evaluate(installInPage);
      const st = await page.evaluate(() => { const s = window.__app.state; return { baked: s.baked, dusk: s.dusk }; });
      ctx.expect(st.baked === false, `?legacy still runs baked lighting (state.baked=${st.baked})`);
      await ctx.frames(10, page);
      for (const want of [!st.dusk, st.dusk]) {
        await page.evaluate(async () => { const a = window.__app; a.toggleDusk(); await a.applyTime(); });
        const now = await page.evaluate(() => window.__app.state.dusk);
        ctx.expect(now === want, `toggleDusk: state.dusk is ${now}, expected ${want}`);
        await ctx.frames(10, page);
      }
    },
  },
];
export { installInPage };
