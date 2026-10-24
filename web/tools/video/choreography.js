// The demo film's choreography, run in the page by tools/video/record.mjs. It reuses the site's demonstration (src/demo.js:
// its caption strip, its frame-clock tasks and helpers) with a longer script: a walk through the house, the pets, moving
// furniture, the RedNote posts against the same view, a panorama, the garden, and the four times of day.
// Everything advances on the frame clock (renderAt), so the film is smooth and repeatable. window.__video.hold() tells the
// recorder to wait in wall-clock time without stepping (a lighting slot or a picture still loading), so nothing pops.
(() => {
  const A = window.__app, d = A.demo, p = A.player, vp = A.viewpoints, THREE = A.THREE;
  const zh = () => localStorage.getItem('croton-lang') === 'zh';
  const S = {
    intro: ['2513 Croton Ave · a walk through the house', '2513 Croton Ave · 漫步整栋房子'],
    walk: ['Walk in through the front door', '从正门走进来'],
    kitchen: ['The open kitchen and the window seat', '开放式厨房与窗台座'],
    sit: ['Sit on the sofa', '坐到沙发上'],
    stand: ['Stand up', '起身'],
    dog: ['Call the dog', '叫狗狗'],
    petDog: ['Pet the dog', '摸摸狗狗'],
    cat: ['Call the cat', '叫猫咪'],
    petCat: ['Pet the cat', '摸摸猫咪'],
    media: ['Open the RedNote posts', '打开小红书笔记'],
    rnGo: ['Go to where the photo was taken', '前往拍摄位置'],
    rnSeat: ['RedNote photo beside the same view: the window seat', '小红书照片与同一视角：窗台座'],
    drag: ['Move the furniture', '移动家具'],
    back: ['Return it to its place', '物归原处'],
    office: ['The office, glass doors to the garden', '书房，玻璃门外是花园'],
    bedroom: ['The primary bedroom', '主卧'],
    rnBed: ['RedNote photo beside the same view: the bed facing the garden', '小红书照片与同一视角：对着花园的床'],
    door: ['Open the door', '开门'],
    bath: ['The primary bathroom', '主卫'],
    fly: ['Choose a panorama', '选择一处全景'],
    pano: ['Enter the Zillow panorama', '进入 Zillow 全景'],
    around: ['Look around inside', '在全景中环顾'],
    leave: ['Leave the panorama', '离开全景'],
    patio: ['Out to the patio and the garden', '走到露台与花园'],
    firepit: ['The fire pit and the bench he built', '火盆与自制的木长凳'],
    sunrise: ['Time of day · sunrise after rain', '时间 · 雨后日出'],
    noon: ['Time of day · noon', '时间 · 正午'],
    golden: ['Time of day · golden hour', '时间 · 金色时刻'],
    dusk: ['Time of day · blue hour, the lamps come on', '时间 · 蓝调时分，灯亮起'],
    rnDusk: ['RedNote photo beside the same view: the lit house at dusk', '小红书照片与同一视角：黄昏亮灯的房子'],
    end: ['Now the house is yours', '现在，房子交给你'],
  };
  const tr = (k) => S[k][zh() ? 1 : 0];
  const TOTAL = 33;
  let n = 0;
  const step = (keys, k, numbered = true) => { d.show(numbered ? ++n : 0, TOTAL, keys, tr(k)); if (keys.length) d.press(0); };

  // ---- pacing: every flight walks at about a person's pace, turns no faster than ~70°/s ----
  let flights = 0;
  const pace = (speed = 1.35) => {
    const f = vp.fly; if (!f) return;
    const L = f.path ? f.path.length : Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z);
    const turn = Math.abs(Math.atan2(Math.sin(f.to.yaw - f.from.yaw), Math.cos(f.to.yaw - f.from.yaw)));
    f.dur = Math.min(9, Math.max(1.4, 0.8 + L / speed, 0.9 + turn / 1.2));
  };
  const landed = async () => { await d.wait(0.05); await d.waitFor(() => !vp.fly, 15); };
  // walk a collision-free route (nav.js, through the doorways; doors open ahead and close behind) to a composed view
  async function walk(x, y, heading, pitch = -0.05, { eye = 1.6, speed = 1.35, direct = false } = {}) {
    vp.goTo({ kind: 'tour', id: 'video' + (++flights), x, y, heading, pitch, eye }, { silent: true, direct });
    pace(speed); await landed();
  }
  // a slow push forward (and a little turn) while a view holds, so the camera never parks
  function drift(sec, push = 0.15, yawDeg = 0) {
    const x0 = p.pos.x, z0 = p.pos.z, y0 = p.yaw, fx = -Math.sin(y0), fz = -Math.cos(y0);
    return d.task(sec, (e) => { p.pos.x = x0 + fx * push * e; p.pos.z = z0 + fz * push * e; p.yaw = y0 + THREE.MathUtils.degToRad(yawDeg) * e; });
  }

  // ---- the visitor's pointer: an arrow that travels to a control and clicks it (a synthetic click, so the demo goes on) ----
  const cur = document.createElement('div');
  cur.style.cssText = 'position:fixed;z-index:200;left:0;top:0;width:30px;height:30px;opacity:0;pointer-events:none;transform:translate(1500px,700px)';
  cur.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2l17 9-7.5 1.8L9 20z" fill="#1a1917" stroke="#f2efe7" stroke-width="1.4"/></svg><i style="position:absolute;left:-15px;top:-15px;width:30px;height:30px;border:3px solid #c8352a;border-radius:50%;opacity:0"></i>';
  document.body.appendChild(cur);
  const ring = cur.querySelector('i');
  let cx = 1500, cy = 700;
  const setCur = (x, y) => { cx = x; cy = y; cur.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; };
  const showCur = (on, sec = 0.3) => { const o0 = +cur.style.opacity || 0, o1 = on ? 1 : 0; return d.task(sec, (e) => { cur.style.opacity = (o0 + (o1 - o0) * e).toFixed(2); }); };
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.55]; };
  const moveCur = (el, sec = 0.9) => { const x0 = cx, y0 = cy, [x1, y1] = centre(el); return d.task(sec, (e) => setCur(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e)); };
  async function click(el) {
    d.task(0.55, (_, u) => { ring.style.opacity = (1 - u).toFixed(2); ring.style.transform = `scale(${(0.6 + 1.4 * u).toFixed(2)})`; });
    await d.wait(0.12); el.click(); await d.wait(0.35);
  }
  // scroll the open list so an element sits near its top
  function scrollTo(el, sec) {
    const body = document.getElementById('panelBody'), s0 = body.scrollTop;
    const s1 = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, s0 + el.getBoundingClientRect().top - body.getBoundingClientRect().top - 24));
    return d.task(sec, (e) => { body.scrollTop = s0 + (s1 - s0) * e; });
  }
  // A RedNote comparison the way a visitor makes one: open the list (the media menu, or R), find the post, press its
  // "go" button; the camera walks to where the photo was taken and the post's photo floats beside the same view.
  async function rednote(slug, label, viaMenu, speed = 1.3) {
    if (viaMenu) {
      step(['Click'], 'media'); await showCur(true);
      await moveCur(document.getElementById('btn-media'), 0.9); await click(document.getElementById('btn-media'));
      await moveCur(document.getElementById('btn-rednote'), 0.6); await click(document.getElementById('btn-rednote'));
    } else { step(['R'], 'media'); d.ui.reveal('rn'); await d.wait(0.5); await showCur(true); }
    // the list is newest first (rednote.js renderPanel)
    const order = [...A.rednote.posts].sort((a, b) => (b.time || 0) - (a.time || 0)).map(q => q.slug);
    const post = document.querySelectorAll('#panelBody .post')[order.indexOf(slug)];
    await d.wait(0.4); await scrollTo(post, 1.6); await d.wait(0.6);
    const go = post.querySelector('.go');
    step(['Click'], 'rnGo'); await moveCur(go, 0.8); await click(go); pace(speed);
    showCur(false);
    await landed();
    await d.waitFor(() => A.markers.card?.ready, 6);
    step([], label);
    await d.wait(0.6); await drift(4.2, 0.06, 1.5);
    A.markers.closeCard(); await d.wait(0.4);
  }
  async function slot(name, hold) {
    V.slotBegun = false; V.slotWanted = name;
    A.setBakedSlot(name, { quiet: true });
    await d.waitFor(() => A.state.bakedSlot === name && !A.state.bakedSlotPending, 30);
    await drift(hold, 0.08, 0.8);
  }

  const nearestDoor = (x, y) => { let best = null, bd = 0.6; for (const dr of A.getDoors()) { const q = Math.hypot(dr.plan.cx - x, dr.plan.cy - y); if (q < bd) { bd = q; best = dr; } } return best; };
  const doorOpen = dr => dr.kind === 'french' || dr.kind === 'bifold' ? dr.target > 0.5 : dr.kind === 'slider' ? dr.open > 0.3 : Math.abs(dr.target) >= 0.1;

  async function script() {
    const pets = A.pets, hasDog = !!pets?.get('dog'), hasCat = !!pets?.get('cat');
    const sofa = d.find('living-sofa'), chair = d.findNear('wishbone-chair', 2.58, 2.78);
    const bathPano = vp.targets.find(v => v.kind === 'pano' && v.id === '1ffa2a5413');
    if (bathPano) vp.loadPano(bathPano.id);
    for (const k of ['rn', 'pano', 'photo']) A.markers.toggle(k, false);
    // the pets wait in the living room from the start (staged off camera, so they never pop in)
    const OPEN = [2.65, 0.55, 180, -0.16];
    if (hasDog) d.stage('dog', 1.25, -3.25, 'lie', OPEN[0], -OPEN[1]);
    if (hasCat) d.stage('cat', 3.45, -3.55, 'sit', OPEN[0], -OPEN[1]);

    // 1. The front walk, then in through the front door: the foyer, the kitchen island, the window seat.
    // over the front garden (the tour's second stop), down onto the front walk, in through the door
    p.teleport(4, 13.6, 340, -0.42); p.eye = 6; p.camera.position.y = 6;   // teleport takes world z (= -plan y)
    step([], 'intro', false); await walk(4.3, -12.2, 340, -0.38, { eye: 5.4, direct: true, speed: 0.8 });
    await walk(0.35, -9.3, 0, -0.02, { eye: 1.6, direct: true, speed: 1.3 });
    step(['W'], 'walk'); await walk(0.0, -3.8, 0, -0.03, { speed: 1.25 });
    step(['Mouse'], 'kitchen'); await walk(1.2, -2.8, 280, -0.05); await drift(2.6, 0.08, 6);

    // 2. The living room: sit on the sofa, call and pet the dog and the cat (the demonstration's own staging).
    await walk(OPEN[0], OPEN[1], OPEN[2], OPEN[3]);
    if (sofa) {
      const seat = new THREE.Vector3(); sofa.getWorldPosition(seat);
      await d.lookAt(seat.x, 0.45, seat.z, 0.9);
      step(['Click'], 'sit'); A.interact.sitOn(sofa, seat); await d.wait(3.0);
      step(['Space'], 'stand'); p.stand(); await d.wait(1.1);
    }
    if (hasDog || hasCat) await d.glide(2.65, -1.75, 200, -0.42, 1.5);
    for (const [name, key, call, pet, on] of [['dog', 'G', 'dog', 'petDog', hasDog], ['cat', 'K', 'cat', 'petCat', hasCat]]) {
      if (!on) continue;
      const a0 = pets.get(name); await d.face(a0.x, a0.z, 0.8, -0.42);
      step([key], call); d.free(name); pets.call(name);
      const at = d.clock; await d.waitFor(() => d.near(name, 1.3) || (d.clock - at > 1.0 && !pets.get(name).path && pets.get(name).state !== 'walk'), 6);
      const a = pets.get(name), head = name === 'dog' ? 0.36 : 0.26;
      await d.lookAt(a.x, head, a.z, 0.6);
      step(['Click'], pet); pets.pet(name);
      await d.track(() => ({ x: a.x, y: head, z: a.z }), 2.6);
    }

    // 3. RedNote: the window-seat post, through the media menu.
    await rednote('6ab7b98000', 'rnSeat', true);

    // 4. Furniture: a Wishbone chair pulled out from the dining table and sent home.
    if (chair) {
      await walk(2.05, 0.75, 15, -0.36);
      step(['Drag'], 'drag'); await d.drag(chair, 3.0, 2.3, 1.9); await d.wait(0.5);
      step(['Right-click'], 'back'); A.interact.putBack([chair]); await d.wait(1.8); d.dragged = null;
    }

    // 5. The primary bedroom.
    step(['W'], 'bedroom'); await walk(-5.35, 4.95, 125, -0.18); await drift(2.6, 0.05, 3);

    // 6. RedNote: the bed facing the garden, through the R key.
    await rednote('69ef572200', 'rnBed', false);

    // 7. The primary bathroom, and its Zillow panorama.
    await walk(-5.3, 4.75, 270, -0.12);
    const bathDoor = nearestDoor(-5.95, 4.78);
    if (bathDoor && !doorOpen(bathDoor)) { step(['Click'], 'door'); A.interact.toggleDoor(bathDoor); await d.wait(1.4); }
    step(['W'], 'bath'); await drift(2.0, 0.1);
    if (bathPano) {
      step(['P'], 'fly'); vp.goTo(bathPano, { silent: true }); pace(1.2); await landed(); await d.wait(0.4);
      step(['C'], 'pano'); await vp.enterPano(bathPano); await d.waitFor(() => vp.panoOpaque, 6);
      step(['Mouse'], 'around'); await d.turn(120, 5.0, 0.02);
      step(['Q'], 'leave'); await d.wait(0.4); vp.exitPano(); await d.wait(0.5);
    }

    // 8. The office, and out through its glass doors to the patio. The pets wait on the patio by the doors.
    if (hasDog) d.stage('dog', 2.5, 8.3, 'lie', 3.1, -10.2);
    if (hasCat) d.stage('cat', 3.5, 8.6, 'sit', 3.1, -10.2);
    step(['W'], 'office'); await walk(0.65, 2.15, 335, -0.12); await drift(2.2, 0.15, 4);
    step(['W'], 'patio'); await walk(3.5, 6.5, 350, -0.08); await drift(2.4, 0.15, 3);

    // 9. The times of day, from the garden looking back at the glass doors: each next slot is loaded before its crossfade.
    await walk(3.1, 10.2, 197, -0.04);
    step(['N'], 'sunrise'); await drift(2.0, 0.05, 0.5);
    step(['N'], 'noon'); await slot('noon', 3.2);
    step(['N'], 'golden'); await slot('golden', 3.2);
    step(['N'], 'dusk'); await slot('dusk', 4.2);

    // 10. The fire pit at dusk, RedNote's lit house from the back of the garden, then the end.
    // turn from the house to the fire pit (plan 1.6, 12.3) where it stands: walking there in the dark crossed its ring
    step(['Mouse'], 'firepit'); await d.face(1.6, -12.3, 2.8, -0.2); await drift(2.2, 0.1, 3);
    await rednote('6a02916b00', 'rnDusk', false, 1.8);   // the route rounds the garden's seating: keep it brisk
    step([], 'end', false); await walk(0.0, 14.5, 180, -0.02); await drift(3.0, 0.2);
  }

  const V = window.__video = {
    slotBegun: false, slotWanted: null, done: false, error: null, steps: () => n,
    // the recorder waits (without stepping the clock) while any of these is true
    hold() {
      if (A.state.bakedSlotPending && !V.slotBegun) return 'slot';
      if (!document.getElementById('panoload').classList.contains('hidden')) return 'pano';
      if (A.markers.card && !A.markers.card.ready) return 'card';
      const panel = document.getElementById('panel');
      if (!panel.classList.contains('hidden')) {
        const box = document.getElementById('panelBody').getBoundingClientRect();
        for (const img of panel.querySelectorAll('img')) { const r = img.getBoundingClientRect(); if (r.bottom > box.top && r.top < box.bottom && !(img.complete && img.naturalWidth)) return 'list'; }
      }
      return '';
    },
    start() {
      // the slot fade begins (and the hold ends) when the destination is fully staged: its 'transition' progress report
      const b = A.baked, setSlot = b.setSlot;
      b.setSlot = (name, cb) => setSlot(name, (f, info) => { if (info?.phase === 'transition') V.slotBegun = true; cb?.(f, info); });
      d.script = async () => { try { await script(); } catch (e) { V.error = String(e?.stack || e); throw e; } };
      d.start().finally(() => { V.done = true; });
    },
  };
})();
