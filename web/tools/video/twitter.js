// The Twitter/X cut: a 40 s cinematic film of the walkthrough, run in the page by tools/video/record.mjs --script twitter.js.
// Unlike choreography.js (one continuous walk through the site's demonstration), this is a list of shots joined by cuts:
// each shot sets up its own state (time of day, doors, pets, cards), the recorder renders a few seconds of "pre-roll"
// that are not kept (auto exposure and TAA settle, a slot crossfade finishes), then the shot's camera move is kept.
// Every move is a keyframed path on the frame clock (renderAt), so the film is smooth and repeatable, and a shot can be
// recorded on its own (record.mjs --shots name,name) with the same result.
// No interface: the recorder hides the site's HUD (--clean); the only text is this file's title cards (Liter, the landing
// page's Swiss look). window.__video.hold() tells the recorder to wait in wall-clock time without stepping while a
// lighting slot, a font or a picture loads, so nothing pops.
(() => {
  const A = window.__app, p = A.player, cam = A.camera, pets = A.pets;
  const OPT = window.__videoOptions || {};
  const clamp01 = (u) => Math.max(0, Math.min(1, u)), lerp = (a, b, u) => a + (b - a) * u, rad = (deg) => deg * Math.PI / 180;
  const smooth = (u) => u * u * (3 - 2 * u), sine = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
  // time warps for a shot's progress: cut on motion ('linear', 'soft'), or settle ('inout', 'out', 'in')
  const WARP = { linear: (u) => u, soft: (u) => lerp(u, sine(u), 0.45), inout: sine, out: (u) => Math.sin(u * Math.PI / 2), in: (u) => 1 - Math.cos(u * Math.PI / 2) };

  // ---- music grid: shot lengths are whole beats of "Tuscany" (Oak Studios, ~100 BPM, a fingerpicked note every 0.3 s from
  // 0.43 s), so cuts fall on the music when encode.sh starts the track 0.4 s in (MUSIC_START=0.4). The guitar is played
  // freely, so the grid drifts by up to ~0.1 s over the film.
  const BEAT = 0.6;
  const beats = (n) => n * BEAT;

  // ---- camera paths. keys: [u (0..1 of the shot), plan x, plan y, eye height, heading (deg, 0 = north, clockwise), pitch (deg)].
  // Every channel is a cubic Hermite spline in u with tangents from the neighbouring keys (C1: no speed jumps at a key);
  // headings are unwrapped so a turn takes the short way.
  function path(keys) {
    const k = keys.map(r => r.slice());
    for (let i = 1; i < k.length; i++) k[i][4] = k[i - 1][4] + ((((k[i][4] - k[i - 1][4]) % 360) + 540) % 360 - 180);
    const n = k.length;
    const tan = (i, c) => n < 2 ? 0 : i === 0 ? (k[1][c] - k[0][c]) / (k[1][0] - k[0][0]) : i === n - 1 ? (k[n - 1][c] - k[n - 2][c]) / (k[n - 1][0] - k[n - 2][0]) : (k[i + 1][c] - k[i - 1][c]) / (k[i + 1][0] - k[i - 1][0]);
    return (u) => {
      if (n === 1) return { x: k[0][1], y: k[0][2], eye: k[0][3], h: k[0][4], pitch: k[0][5] };
      let i = 0; while (i < n - 2 && u > k[i + 1][0]) i++;
      const u0 = k[i][0], u1 = k[i + 1][0], L = u1 - u0, s = clamp01((u - u0) / L), s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      const ch = (c) => h00 * k[i][c] + h10 * L * tan(i, c) + h01 * k[i + 1][c] + h11 * L * tan(i + 1, c);
      return { x: ch(1), y: ch(2), eye: ch(3), h: ch(4), pitch: ch(5) };
    };
  }
  // put the eye at a pose: the player (driven, so its own update leaves the camera alone) and the camera agree, so
  // everything that reads the player's position (pets, auto exposure's indoor weight, doors) sees the film's camera
  function place(v, fov) {
    p.driven = true; p.enabled = false;
    p.pos.set(v.x, 0, -v.y); p.eye = v.eye; p.yaw = rad(-v.h); p.pitch = rad(v.pitch);
    cam.position.set(v.x, v.eye, -v.y); cam.rotation.set(0, 0, 0, 'YXZ'); cam.rotation.y = p.yaw; cam.rotation.x = p.pitch;
    if (fov && Math.abs(cam.fov - fov) > 1e-6) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
  // blend a pose's aim toward a world point (weight w), smoothed across frames so a moving subject is followed, not snapped to
  const aimState = { yaw: null, pitch: null };
  function aimAt(v, target, w, dt) {
    if (!target || w <= 0) { aimState.yaw = aimState.pitch = null; return v; }
    const dx = target.x - v.x, dz = target.z + v.y, dist = Math.hypot(dx, dz);
    const hAim = Math.atan2(dx, -dz) * 180 / Math.PI, pAim = Math.atan2(target.y - v.eye, Math.max(0.2, dist)) * 180 / Math.PI;
    let dh = ((hAim - v.h) % 360 + 540) % 360 - 180;
    const want = { h: v.h + dh * w, pitch: lerp(v.pitch, pAim, w) };
    if (aimState.yaw === null) { aimState.yaw = want.h; aimState.pitch = want.pitch; }
    const k = 1 - Math.exp(-dt / 0.25); let d = ((want.h - aimState.yaw) % 360 + 540) % 360 - 180;
    aimState.yaw += d * k; aimState.pitch += (want.pitch - aimState.pitch) * k;
    return { ...v, h: aimState.yaw, pitch: aimState.pitch };
  }

  // ---- state helpers ----
  const doors = () => A.getDoors();
  const doorNear = (x, y, r = 0.8) => { let best = null, bd = r; for (const dr of doors()) { const q = Math.hypot(dr.plan.cx - x, dr.plan.cy - y); if (q < bd) { bd = q; best = dr; } } return best; };
  const isOpen = (dr) => dr.kind === 'french' || dr.kind === 'bifold' ? dr.target > 0.5 : dr.kind === 'slider' ? dr.open > 0.3 : Math.abs(dr.target) >= 0.1;
  function door(x, y, open) { const dr = doorNear(x, y); if (dr && isOpen(dr) !== open) A.interact.toggleDoor(dr); return dr; }
  // place a pet at a plan position, settled in a pose, facing a plan point; released by free() for a call
  function stage(name, px, py, mode, lx, ly, y) {
    const a = pets?.get(name); if (!a) return;
    const x = px, z = -py, yaw = Math.atan2(lx - px, -ly + py);
    a.perch = null; a.path = null; a.call = null; a.goal = null; a.x = x; a.z = z; a.yaw = yaw; a.state = 'pause'; a.st = 0;
    pets.hold(name, { x, z, yaw, mode, speed: 0, ...(y === undefined ? {} : { y }) });
  }
  function free(name) { const a = pets?.get(name); if (a) { a.hold = null; a.state = 'pause'; a.st = 0; } }
  // the pets wait out of sight (below the ground, under the garage) unless a shot stages them
  const stash = () => { for (const n of ['dog', 'cat']) if (pets?.get(n)) stage(n, -5.5, -2.5, 'lie', -5.5, 0, -3); };
  // request a time of day; true when a crossfade was started
  function slot(name) {
    if (A.state.bakedSlot === name && !A.state.bakedSlotPending) return false;
    if (A.state.bakedSlotPending) { V.warn.push(`slot ${name} requested while ${A.state.bakedSlotPending} is pending`); return false; }
    V.slotBegun = false; A.setBakedSlot(name, { quiet: true }); return true;
  }
  // seconds of pre-roll kept after a slot crossfade at a cut: the volumetric light's history holds the old slot's mist
  // (it follows a change of its media at its history rate, 4% a frame while the camera holds still), and auto exposure
  // is still gliding to the new light: into dusk outdoors the target rises ~7 EV and the glide (0.8 s) takes ~2.5 s
  const SETTLE = 3.0;
  const cardPin = (slug) => A.markers.pins.find(q => q.kind === 'rn' && q.post.slug === slug);

  // ---- title cards (film-only DOM, over the canvas) ----
  const css = document.createElement('style');
  css.textContent = `
    #film { position:fixed; inset:0; z-index:400; pointer-events:none; font-family:Liter, "Helvetica Neue", Arial, sans-serif; font-synthesis:none; -webkit-font-smoothing:antialiased }
    #film .addr { position:absolute; left:104px; bottom:96px; color:#fbf8f1; opacity:0; text-shadow:0 2px 24px rgba(0,0,0,.5), 0 1px 3px rgba(0,0,0,.4) }
    #film .addr h1 { margin:0 0 0 -6px; font-weight:400; font-size:140px; line-height:.9; letter-spacing:-.045em }
    #film .addr .k { margin-top:26px; padding-top:20px; border-top:2px solid rgba(251,248,241,.92); font-size:46px; letter-spacing:-.01em }
    /* sizes for a phone: the timeline shows a 1920 px frame about 390 px wide, so 70 px here is 14 px there */
    #film .end { position:absolute; inset:0; background:#f2efe7; color:#1a1917; opacity:0; padding:0 140px; display:flex; flex-direction:column; justify-content:center }
    #film .end .head { display:flex; justify-content:space-between; padding-bottom:18px; border-bottom:2px solid #1a1917; font-size:28px; letter-spacing:.22em; text-transform:uppercase; color:#77716a }
    #film .end h1 { margin:64px 0 0 -8px; font-weight:400; font-size:184px; line-height:.86; letter-spacing:-.05em }
    #film .end .walk { display:flex; align-items:center; gap:30px; margin-top:70px; font-size:88px; line-height:1; letter-spacing:-.03em }
    #film .end .walk i { width:44px; height:44px; background:#bf3f2b; flex:none }
    #film .end .url { margin-top:30px; font-size:66px; line-height:1; letter-spacing:-.02em; color:#bf3f2b }
    #film .end .blue { position:absolute; right:140px; top:330px; width:330px; height:330px; background:#2c4a8a }
    #film .end .ochre { position:absolute; right:108px; top:298px; width:120px; height:170px; background:#d8a646 }
  `;
  document.head.appendChild(css);
  const film = document.createElement('div'); film.id = 'film';
  film.innerHTML = '<div class="addr"><h1>2513 Croton Ave</h1><div class="k">Sarasota, Florida</div></div>' +
    '<div class="end"><i class="blue"></i><i class="ochre"></i><div class="head"><span>Studio Hu Dwelling</span><span>Sarasota, Florida</span></div>' +
    '<h1>2513<br>Croton Ave</h1><div class="walk"><i></i><span>Walk through it yourself</span></div><div class="url">kongdai123.github.io/croton-house</div></div>';
  document.body.appendChild(film);
  const addr = film.querySelector('.addr'), end = film.querySelector('.end');
  let fontsReady = false;
  Promise.all([document.fonts.load('400 40px Liter'), document.fonts.ready]).then(() => { fontsReady = true; });

  // ---- the shots ----
  // dur: kept seconds. pre: pre-roll seconds (not kept). slot: time of day during the shot. setup(): staged state before
  // the pre-roll. keys/warp: the camera move. fov: vertical field of view (the site uses 62°). at: [[t, fn]] events at
  // shot-local seconds. aim(t): optional world point the camera leans toward, with weight aimW(t). overlay(t): title cards.
  const TOUR = OPT.tourSlot || 'noon';   // the time of day of the walk through the rooms (record.mjs --tour-slot)
  const SHOTS = [
    {
      // 1. The hook (Twitter autoplays muted; the first frame decides): blue hour in the back garden, the fire lit, the
      // house glowing beyond it, the dog asleep by the fire. A slow sideways glide; the address over it from the first frame.
      name: 'hook', dur: beats(6), pre: 2.0, slot: 'dusk', fov: 56, warp: 'linear',
      setup() { stash(); door(-0.06, -4.66, false); stage('dog', 2.25, 11.75, 'lie', 1.6, 12.3); },
      keys: [[0, 2.95, 13.55, 0.95, 199, -2], [1, 2.35, 13.75, 1.0, 192, -1.5]],
      overlay(t) { addr.style.opacity = clamp01((beats(6) - 0.25 - t) / 0.45).toFixed(3); },
    },
    {
      // 2. Day over the front garden: from above the street, straight down toward the house and tilting up, until the
      // open door and its number sit between the palm and the banana leaves.
      // (50° keeps the placeholder neighbours at the frame's edges out of it)
      name: 'aerial', dur: beats(7), pre: 2.0, slot: TOUR, fov: 50, warp: 'soft',
      setup() { stash(); door(-0.06, -4.66, true); },
      keys: [[0, 0.9, -18.2, 7.6, 1, -24], [1, 0.4, -13.6, 3.9, 1, -12]],
    },
    {
      // 3. In through the door: the island, the living room and straight through the house to the garden beyond the glass.
      name: 'enter', dur: beats(5), pre: 1.2, slot: TOUR, fov: 62, warp: 'soft',
      setup() { stash(); door(-0.06, -4.66, true); },
      keys: [[0, -0.06, -4.35, 1.6, 0, -2], [1, 0.2, -2.5, 1.6, 6, -3]],
    },
    {
      // 4. A sideways dolly behind the sofa: the window seat, the kitchen, the light on the floor.
      name: 'living', dur: beats(6), pre: 1.0, slot: TOUR, fov: 60, warp: 'soft',
      setup() { stash(); },
      keys: [[0, 3.65, 0.55, 1.5, 218, -8], [1, 2.55, 0.35, 1.45, 206, -8]],
    },
    {
      // 5. The dog: called, it walks up to the lens and sits; petted, close. The cat watches from the window seat.
      // Crouched at the dog's height in front of the sofa, the coffee table just out of frame.
      name: 'dog', dur: beats(7), pre: 1.0, slot: TOUR, fov: 48, warp: 'inout',
      setup() { stash(); stage('dog', 1.0, -3.0, 'lie', 1.85, -1.75); stage('cat', 1.7, -3.75, 'sit', 1.85, -1.75); },
      keys: [[0, 1.85, -1.75, 0.72, 207, -9], [1, 1.8, -1.82, 0.66, 209, -15]],
      // call at once; pet when it has sat down in front of the lens (or at the latest beat), never mid-walk
      at: [[0.15, () => { free('dog'); pets.call('dog'); }], [beats(2.5), () => pets.pet('dog'), () => pets.get('dog')?.state === 'attend', beats(5)]],
      aim: () => { const a = pets?.get('dog'); return a ? { x: a.x, y: 0.3, z: a.z } : null; }, aimW: (t) => 0.75 * smooth(clamp01((t - 0.3) / 1.0)),
    },
    {
      // 6. Then and now: the owner's RedNote photo of the garden doors floats beside the same view.
      name: 'rednote', dur: beats(8), pre: 1.0, slot: TOUR, fov: 52, warp: 'soft',
      setup() { stash(); A.markers.closeCard(); },
      keys: [[0, 2.85, 2.75, 1.38, 4, -8], [1, 3.0, 2.95, 1.36, 8, -9]],
      at: [[0.3, () => { const pin = cardPin('69fd344f00'); if (pin) A.markers.openCard(pin); }]],
    },
    {
      // 7. The dining room from the office: the lantern, the Wishbone chairs, the glass doors and the fig.
      name: 'dining', dur: beats(5), pre: 1.0, slot: TOUR, fov: 60, warp: 'soft',
      setup() { stash(); A.markers.closeCard(); },
      keys: [[0, -1.45, 2.35, 1.5, 60, -6], [1, -1.15, 2.55, 1.48, 64, -6]],
    },
    {
      // 8. The day in one shot, from the back garden facing the house: sunrise, noon, golden hour, blue hour (the lamps and
      // the fire come on), then the camera rises and pulls back over the garden; the end card fades in over it.
      name: 'timelapse', dur: beats(18), pre: 2.0, slot: 'sunrise', fov: 54, warp: 'linear',
      setup() { stash(); A.markers.closeCard(); door(-0.06, -4.66, false); stage('dog', 3.0, 10.4, 'lie', 2.4, 15.0); },
      keys: [[0, 2.4, 15.0, 1.45, 184, -3], [0.62, 2.3, 15.5, 1.55, 183, -4], [1, 1.7, 17.6, 3.4, 179, -9]],
      at: [[beats(1.5), () => slot('noon')], [beats(5.5), () => slot('golden')], [beats(9.5), () => slot('dusk')]],
      overlay(t) { end.style.opacity = clamp01((t - (beats(18) - 0.6)) / 0.6).toFixed(3); },
    },
    { name: 'card', dur: beats(6), pre: 0, slot: 'dusk', fov: 54, keys: [[0, 1.7, 17.6, 3.4, 179, -9]], overlay() { end.style.opacity = 1; } },
  ];

  // ---- stills (record.mjs --stills poses.json): one-frame shots for checking compositions and times of day ----
  if (OPT.stills) {
    SHOTS.length = 0;
    for (const s of OPT.stills) SHOTS.push({ name: s.name, dur: 1 / (OPT.fps || 30), pre: s.pre ?? 1.0, slot: s.slot ?? 'sunrise', fov: s.fov ?? 62, keys: [[0, s.x, s.y, s.eye ?? 1.6, s.h, s.pitch ?? 0]],
      setup() { stash(); A.markers.closeCard(); for (const [x, y, open] of s.doors ?? []) door(x, y, open); for (const [n, x, y, mode, lx, ly] of s.pets ?? []) stage(n, x, y, mode, lx, ly); } });
  }
  const only = OPT.shots?.length ? SHOTS.filter(s => OPT.shots.includes(s.name)) : SHOTS;

  // ---- the timeline: the recorder calls step() once per frame, then draws it ----
  const V = window.__video = {
    timeline: true, shots: only.map(s => ({ name: s.name, dur: s.dur })), log: [], warn: [],
    i: -1, phase: 'next', t: 0, filmT: 0, done: false, error: null, slotBegun: false, fired: null,
    hold() {
      if (!fontsReady) return 'font';
      if (A.state.bakedSlotPending && !V.slotBegun) return 'slot';
      if (A.markers.card && !A.markers.card.ready) return 'card';
      return '';
    },
    // advance one frame of dt seconds; returns { save, shot, t } (save: keep this frame) or { done }
    step(dt) {
      try {
        for (;;) {
          if (V.phase === 'next') {
            if (++V.i >= only.length) { V.done = true; return { done: true }; }
            const s = only[V.i];
            V.t = 0; V.pre = s.pre ?? 1.0; V.fired = new Set(); aimState.yaw = aimState.pitch = null;
            addr.style.opacity = 0; end.style.opacity = 0;
            s.setup?.(); V.fading = !!s.slot && slot(s.slot);
            s.path = path(s.keys); V.phase = V.pre > 0 ? 'pre' : 'roll';
          }
          const s = only[V.i];
          if (V.phase === 'pre') {
            // hold the first pose; the pre-roll lasts until its time is up and any slot crossfade has finished, then SETTLE
            // more seconds with the volumetric light started afresh on the new slot's media
            V.pose(s, 0, dt);
            if (V.fading && !A.state.bakedSlotPending) { V.fading = false; A.baked?.shafts?.reset(); V.pre = Math.max(V.pre, SETTLE); }
            if (V.pre > 0 || A.state.bakedSlotPending) { V.pre -= dt; return { save: false, shot: s.name, t: 0, pre: true }; }
            V.phase = 'roll';
          }
          if (V.t >= s.dur - 1e-6) { V.phase = 'next'; continue; }
          // events: [t, fn] fires at t; [t, fn, when, latest] fires from t on as soon as when() holds, at the latest at `latest`
          for (const [i, [at, fn, when, latest]] of (s.at ?? []).entries()) if (!V.fired.has(i) && V.t >= at - 1e-6 && (!when || when() || V.t >= latest - 1e-6)) { V.fired.add(i); fn(); V.log.push(`${s.name} event ${i} at ${V.t.toFixed(2)} s`); }
          V.pose(s, V.t, dt);
          s.overlay?.(V.t);
          const out = { save: true, shot: s.name, t: +V.t.toFixed(4), filmT: +V.filmT.toFixed(4) };
          V.t += dt; V.filmT += dt;
          return out;
        }
      } catch (e) { V.error = String(e?.stack || e); V.done = true; return { done: true, error: V.error }; }
    },
    pose(s, t, dt) {
      const u = (WARP[s.warp] ?? WARP.soft)(clamp01(t / s.dur));
      let v = s.path(u);
      if (s.aim) v = aimAt(v, s.aim(t), s.aimW ? s.aimW(t) : 1, dt);
      place(v, s.fov ?? 62);
    },
    start() {
      // a slot's fade begins (and its hold ends) when the destination is fully staged: its 'transition' progress report
      const b = A.baked, setSlot = b.setSlot;
      b.setSlot = (name, cb) => setSlot(name, (f, info) => { if (info?.phase === 'transition') V.slotBegun = true; cb?.(f, info); });
      for (const k of ['rn', 'pano', 'photo']) A.markers.toggle(k, false);
      if (pets?.hearts && OPT.hearts === false) pets.hearts.spawn = () => {};
    },
  };
})();
