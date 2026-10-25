// The Twitter/X cut: a 46 s film of the house, run in the page by tools/video/record.mjs --script twitter.js.
// Unlike choreography.js (one continuous walk through the site's demonstration), this is a list of shots joined by cuts:
// each shot sets up its own state (time of day, doors, pets, exposure, lens), the recorder renders a few seconds of
// "pre-roll" that are not kept (auto exposure and TAA settle, a slot crossfade finishes), then the shot's move is kept.
// Every move is a keyframed path on the frame clock (renderAt), so the film is smooth and repeatable, and a shot can be
// recorded on its own (record.mjs --shots name,name) with the same result.
//
// The camera language is an architectural photographer's, as the reference channel's films are made from still
// photographs moved in 2D: every shot is framed like a photograph (a level camera, verticals vertical, a lens shift when
// the frame needs more ceiling or floor, 28-37 mm, chest height indoors) and moved along one axis at a constant speed
// (a pedestal, a dolly push or pull), no rotation, no easing, the move already running on the first kept frame and still
// running on the last (the pre-roll runs into it). Long holds (6-11 s); at a cut the move reverses or changes axis; the
// end card dissolves in over the last second of the day. Deep focus everywhere but the dog, which gets the film's one
// focus pull. The variant of the plan at 46 s: the hook, the front, the living room, the dog, the dining room at golden
// hour, the day in one shot, the card (the kitchen and the bedroom of the 59 s plan dropped: the kitchen only continues
// the living room's rise, the bedroom repeats the golden interior; 46 s keeps every hold long and the film near 45 s).
// Fine detail under a fast camera strobes at 60 fps (temporal aliasing, not TAA): these speeds keep it calm.
//
// No interface: the recorder hides the site's HUD (--clean); the only text is this file's title and end card (Liter, the
// landing page's Swiss look). window.__video.hold() tells the recorder to wait in wall-clock time without stepping while
// a lighting slot, a font or a picture loads, so nothing pops.
(() => {
  const A = window.__app, p = A.player, cam = A.camera, pets = A.pets;
  const OPT = window.__videoOptions || {};
  const clamp01 = (u) => Math.max(0, Math.min(1, u)), lerp = (a, b, u) => a + (b - a) * u, rad = (deg) => deg * Math.PI / 180;
  const sine = (u) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(u));

  // ---- music grid: shot lengths are whole beats of 0.6 s (100 BPM), so cuts fall on a track's beat if one is added
  const BEAT = 0.6;
  const beats = (n) => n * BEAT;

  // ---- camera paths. keys: [u (0..1 of the shot), plan x, plan y, eye height, heading (deg, 0 = north, clockwise),
  // pitch (deg), lens shift (frame heights, + frames more above; optional)]. Every channel is a cubic Hermite spline in u
  // with tangents from the neighbouring keys (two keys: a straight line at constant speed); before the first key and after
  // the last the path runs on along its end tangents, so a pre-roll can move into the shot at the shot's own speed.
  function path(keys) {
    const k = keys.map(r => { const q = r.slice(); q[6] ??= 0; return q; });
    for (let i = 1; i < k.length; i++) k[i][4] = k[i - 1][4] + ((((k[i][4] - k[i - 1][4]) % 360) + 540) % 360 - 180);
    const n = k.length;
    const pose = (f) => ({ x: f(1), y: f(2), eye: f(3), h: f(4), pitch: f(5), shift: f(6) });
    const tan = (i, c) => n < 2 ? 0 : i === 0 ? (k[1][c] - k[0][c]) / (k[1][0] - k[0][0]) : i === n - 1 ? (k[n - 1][c] - k[n - 2][c]) / (k[n - 1][0] - k[n - 2][0]) : (k[i + 1][c] - k[i - 1][c]) / (k[i + 1][0] - k[i - 1][0]);
    return (u) => {
      if (n === 1) return pose(c => k[0][c]);
      if (u < k[0][0]) return pose(c => k[0][c] + tan(0, c) * (u - k[0][0]));
      if (u > k[n - 1][0]) return pose(c => k[n - 1][c] + tan(n - 1, c) * (u - k[n - 1][0]));
      let i = 0; while (i < n - 2 && u > k[i + 1][0]) i++;
      const u0 = k[i][0], u1 = k[i + 1][0], L = u1 - u0, s = clamp01((u - u0) / L), s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      return pose(c => h00 * k[i][c] + h10 * L * tan(i, c) + h01 * k[i + 1][c] + h11 * L * tan(i + 1, c));
    };
  }
  // put the eye at a pose: the player (driven, so its own update leaves the camera alone) and the camera agree, so
  // everything that reads the player's position (pets, auto exposure's indoor weight, doors) sees the film's camera.
  // ahead: the player stands this far in front of the lens (a called pet sits ~0.8 m from the player: 1.2 m from a lens
  // 0.4 m behind it, the distance of a portrait at 50 mm).
  function place(v, fov, ahead = 0) {
    p.driven = true; p.enabled = false;
    p.pos.set(v.x + ahead * Math.sin(rad(v.h)), 0, -(v.y + ahead * Math.cos(rad(v.h)))); p.eye = v.eye; p.yaw = rad(-v.h); p.pitch = rad(v.pitch);
    cam.position.set(v.x, v.eye, -v.y); cam.rotation.set(0, 0, 0, 'YXZ'); cam.rotation.y = p.yaw; cam.rotation.x = p.pitch;
    if (fov && Math.abs(cam.fov - fov) > 1e-6) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (A.setLensShift && Math.abs((A.camera.view?.enabled ? -A.camera.view.offsetY : 0) - (v.shift ?? 0)) > 1e-9) A.setLensShift(v.shift ?? 0);
  }
  // distance from the lens to a world point along the view axis (what a focus distance measures)
  const forward = new (A.THREE.Vector3)();
  function axisDistance(x, y, z) { cam.getWorldDirection(forward); return Math.max(0.1, (x - cam.position.x) * forward.x + (y - cam.position.y) * forward.y + (z - cam.position.z) * forward.z); }

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
  // and auto exposure is still gliding to the new light (into dusk outdoors the target rises ~7 EV)
  const SETTLE = 3.0;

  // ---- exposure and lens per shot ----
  // exposure: { key: the auto exposure's key indoors (the level a room's log mean is shown at; null: the slot's),
  //             ev: the lens's exposure compensation (EV; outdoors the auto exposure holds the slot's exposure, so this sets
  //             it; a number or a function of shot time) }
  // lens: the lens's control (lens.js: { fStop, focus, hold, track, time }) or a function (t, dt) returning it; by default
  //       autofocus during the pre-roll, then held. lensSettings: lens_policy.js LENS values for the shot.
  const AE = () => A.lighting.autoExposure;
  let lensDefaults = null;
  function applyLook(s) {
    if (AE()?.settings) AE().settings.key = s.exposure?.key ?? undefined;
    if (A.lens) { lensDefaults ??= { ...A.lens.settings }; Object.assign(A.lens.settings, lensDefaults, s.lensSettings ?? {}); A.lens.control = null; A.lens.enabled = true; }
  }
  function lookAt(s, t, dt, rolling) {
    const ev = s.exposure?.ev;
    if (A.lens) A.lens.settings.exposure = typeof ev === 'function' ? ev(t) : ev ?? 0;
    if (!A.lens) return;
    if (typeof s.lens === 'function') A.lens.control = s.lens(t, dt, rolling);
    else A.lens.control = s.lens ?? (rolling ? { hold: true } : null);
  }

  // ---- the dog's focus: on the cat until the dog has come close, then one pull to its eyes (1.2 s, sine), then
  // following its head (critically damped, tau 0.25 s); f/2.8 ----
  function dogFocus() {
    const st = { pullAt: null, from: 0, x: 0, v: 0 };
    const head = (name, h) => { const a = pets?.get(name); return a ? Math.log2(axisDistance(a.x, h, a.z)) : null; };
    return (t, dt, rolling) => {
      const cat = head('cat', 0.22) ?? Math.log2(2.3), dog = head('dog', 0.3) ?? Math.log2(1.2), d = pets?.get('dog');
      if (!rolling) { st.pullAt = null; return { fStop: 2.8, focus: 2 ** cat }; }
      if (st.pullAt === null && t >= 1.0 && ((2 ** dog < 1.6 && (d?.state === 'attend' || (d?.v ?? 0) < 0.25)) || t >= beats(5))) { st.pullAt = t; st.from = cat; }
      if (st.pullAt === null) return { fStop: 2.8, focus: 2 ** cat };
      const u = (t - st.pullAt) / 1.2;
      if (u < 1) { st.x = lerp(st.from, dog, sine(u)); st.v = 0; return { fStop: 2.8, focus: 2 ** st.x }; }
      const w = 1 / 0.25, c1 = st.x - dog, c2 = st.v + w * c1, e = Math.exp(-w * dt);
      st.x = dog + (c1 + c2 * dt) * e; st.v = (c2 - w * (c1 + c2 * dt)) * e;
      return { fStop: 2.8, focus: 2 ** st.x };
    };
  }

  // ---- title and end card (film-only DOM, over the canvas) ----
  // The address lower left, its cap height 6.5% of the frame (the reference's 6-7%), baseline at 82% of the height.
  const css = document.createElement('style');
  css.textContent = `
    #film { position:fixed; inset:0; z-index:400; pointer-events:none; font-family:Liter, "Helvetica Neue", Arial, sans-serif; font-synthesis:none; -webkit-font-smoothing:antialiased }
    #film .addr { position:absolute; left:134px; top:806px; color:#fbf8f1; opacity:0; text-shadow:0 2px 20px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.35) }
    #film .addr h1 { margin:0 0 0 -4px; font-weight:400; font-size:100px; line-height:.9; letter-spacing:-.04em }
    #film .addr .k { margin-top:18px; padding-top:14px; border-top:2px solid rgba(251,248,241,.92); font-size:38px; letter-spacing:-.01em }
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
  // dur: kept seconds. pre: pre-roll seconds (not kept; its last half second moves into the shot). slot: time of day.
  // setup(): staged state before the pre-roll. keys: the move (see path). fov: vertical field of view (vfov = 2 atan(10.125
  // / f) for a full-frame lens of f mm: 40 deg is 28 mm). ahead: the player in front of the lens (place). at: [[t, fn]]
  // events at shot-local seconds ([t, fn, when, latest]: from t on as soon as when() holds). overlay(t): title, card.
  // exposure, lens, lensSettings: applyLook, lookAt. ends: the slot of the shot's last pose for --opt ends=1 (below).
  // Speeds as the reference measures them (refs_blok7_tools/analyze.py on the take): a vertical scroll of 0.02-0.04 frame
  // heights a second, a push or pull of about 1.8% magnification a second over the whole frame (the near furniture of a
  // room magnifies faster than its far wall: the dining room's 0.10 m/s read 3.1%/s, so 0.06 m/s).
  const TOUR = OPT.tourSlot || 'noon';   // the time of day of the rooms (record.mjs --tour-slot)
  const DUSK_EV = -0.8;                  // the hook's low key, and the day's dusk end (exposure.ev)
  const ROOM_KEY = 0.4;                  // day interiors a little lower than the walkthrough's (mean luma ~0.6, windows held)
  const SHOTS = [
    {
      // 1. The hook (X autoplays muted; the first frame decides): blue hour in the back garden, facing the house's garden
      // front, the fire lit on the right third, the dog asleep by it. A slow push in; the address over it from frame 0.
      name: 'hook', dur: beats(12), pre: 2.0, slot: 'dusk', fov: 40,
      setup() { stash(); door(-0.06, -4.66, false); stage('dog', 2.25, 11.75, 'lie', 1.6, 12.3); },
      keys: [[0, 2.90, 15.60, 1.20, 190, 0, 0], [1, 2.75, 14.75, 1.20, 190, 0, 0]],
      exposure: { ev: DUSK_EV },
      overlay(t) { addr.style.opacity = clamp01((6.0 - t) / 0.6).toFixed(3); },
    },
    {
      // 2. The street front on the door's axis, a frontal elevation from inside the front garden (from the street the
      // fern bed hides the house below the eaves at any height a level camera can take): the camera sinks from the eaves
      // to eye level and arrives at the open door and its number, between the palm and the banana leaves. 5.2 m from the
      // door: 0.6 m farther, the camera sank through a leaf that swept the frame (the flicker check's pops).
      name: 'facade', dur: beats(11), pre: 1.5, slot: TOUR, fov: 37,
      setup() { stash(); door(-0.06, -4.66, true); },
      keys: [[0, -0.06, -9.9, 2.25, 0, 0, 0], [1, -0.06, -9.9, 1.50, 0, 0, 0]],
    },
    {
      // 3. The living room from behind the sofa: the camera rises over its back and the window seat, the kitchen and the
      // light on the floor open up.
      name: 'living', dur: beats(11), pre: 1.5, slot: TOUR, fov: 40, exposure: { key: ROOM_KEY },
      setup() { stash(); },
      keys: [[0, 3.40, 0.60, 0.85, 212, 0, 0], [1, 3.40, 0.60, 1.30, 212, 0, 0]],
    },
    {
      // 4. The dog at its own eye height, 50 mm: called, it walks in from the right and sits for its portrait; the cat
      // watches from the window seat. Focus on the cat, then the film's one pull to the dog. The lens creeps 2 cm. At
      // 0.36 m, with the frame shifted down a little, the sitting dog (0.4 m tall, 1.2 m away) fills the lower two
      // thirds; at the spec's 0.5 m only the top of its head reached the frame.
      name: 'dog', dur: beats(10), pre: 1.0, slot: TOUR, fov: 23, ahead: 0.4, exposure: { key: ROOM_KEY },
      setup() { stash(); stage('dog', 0.7, -2.9, 'lie', 1.9, -1.7); stage('cat', 1.2, -3.85, 'sit', 1.9, -1.7); },
      keys: [[0, 1.90, -1.70, 0.36, 207, 0, -0.08], [1, 1.88, -1.74, 0.36, 207, 0, -0.08]],
      lensSettings: { maxCoc: 0.016 }, lens: dogFocus(),
      // call at once; pet when it has sat down in front of the lens (or at the latest beat), never mid-walk
      at: [[0.15, () => { free('dog'); pets.call('dog'); }], [beats(5), () => pets.pet('dog'), () => pets.get('dog')?.state === 'attend', beats(7)]],
    },
    {
      // 5. The dining room at golden hour from the office: the lantern lit, the Wishbone chairs, the glass doors and the
      // fig; a slow push in (after the dog's stillness, before the day's pull).
      name: 'dining', dur: beats(10), pre: 1.5, slot: 'golden', fov: 44, exposure: { key: ROOM_KEY },
      setup() { stash(); },
      keys: [[0, -1.55, 2.31, 1.15, 62, 0, 0], [1, -1.23, 2.48, 1.15, 62, 0, 0]],
    },
    {
      // 6. The day in one shot, from the back garden facing the house: sunrise, noon, golden hour, blue hour (the lamps and
      // the fire come on) while the camera pulls slowly back; the end card dissolves in over the last second.
      name: 'day', dur: beats(18), pre: 2.0, slot: 'sunrise', fov: 40, ends: 'dusk',
      setup() { stash(); door(-0.06, -4.66, false); stage('dog', 3.0, 10.4, 'lie', 2.4, 15.0); },
      keys: [[0, 2.45, 14.40, 1.25, 184, 0, 0], [1, 2.519, 15.395, 1.25, 184, 0, 0]],
      at: [[1.5, () => slot('noon')], [4.0, () => slot('golden')], [6.5, () => slot('dusk')]],
      // the dusk end in the hook's low key: the compensation comes in with the blue hour's crossfade (1.5 s)
      exposure: { ev: (t) => DUSK_EV * sine((t - 6.5) / 1.5) },
      overlay(t) { end.style.opacity = clamp01((t - (beats(18) - 1.0)) / 1.0).toFixed(3); },
    },
    { name: 'card', dur: beats(5), pre: 0, slot: 'dusk', fov: 40, keys: [[0, 2.519, 15.395, 1.25, 184, 0, 0]], exposure: { ev: DUSK_EV }, overlay() { end.style.opacity = 1; } },
  ];

  // ---- checks before a take ----
  // --opt ends=1: each shot as two one-frame stills, its first and its last pose (its time of day at each), staged as the
  // shot is, with its exposure and lens: every composition of the film in a minute.
  if (OPT.ends) {
    const all = SHOTS.splice(0, SHOTS.length);
    for (const s of all) for (const [tag, u] of [['a', 0], ['b', 1]]) {
      if (s.keys.length < 2 && u === 1) continue;
      SHOTS.push({ ...s, name: `${s.name} ${tag}`, dur: 1 / (OPT.fps || 30), pre: Math.max(1.5, s.pre ?? 1), slot: u === 1 && s.ends ? s.ends : s.slot, at: [], still: { u, t: u * s.dur },
        exposure: s.exposure && { ...s.exposure, ev: typeof s.exposure.ev === 'function' ? s.exposure.ev(u * s.dur) : s.exposure.ev },
        overlay: u === 0 && s.overlay ? () => s.overlay(0) : null });
    }
  }
  // record.mjs --stills poses.json: one-frame shots for checking compositions and times of day. A still may also set the
  // lens (lens: lens.js control, e.g. { fStop, focus }, or false for none; lensSettings: lens_policy.js LENS values) and a
  // lens shift (shift: frame heights, lens_shift.js); each still starts from the defaults.
  if (OPT.stills) {
    SHOTS.length = 0;
    for (const s of OPT.stills) SHOTS.push({ name: s.name, dur: 1 / (OPT.fps || 30), pre: s.pre ?? 1.0, slot: s.slot ?? 'sunrise', fov: s.fov ?? 62, keys: [[0, s.x, s.y, s.eye ?? 1.6, s.h, s.pitch ?? 0, s.shift ?? 0]],
      lensSettings: s.lensSettings, lens: s.lens || undefined, exposure: s.exposure,
      setup() {
        stash(); A.markers.closeCard(); for (const [x, y, open] of s.doors ?? []) door(x, y, open); for (const [n, x, y, mode, lx, ly] of s.pets ?? []) stage(n, x, y, mode, lx, ly);
        if (A.lens && s.lens === false) A.lens.enabled = false;
      } });
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
            // stills: where the lens focused for the one just drawn (a readback; tools only), and (--opt probe=1) how
            // bright its highlights were as exposed, and how much of it glowed
            const still = (OPT.stills || OPT.ends) && V.i >= 0;
            const lf = still && A.lens?.enabled ? A.lens.focusDistance?.() : null;
            if (lf) V.log.push(`${only[V.i].name}: focus ${lf.focus.toFixed(2)} m (lock ${lf.lock.toFixed(2)} m) f/${lf.fStop.toFixed(1)}`);
            if (OPT.probe && V.i >= 0 && A.lens?.probed) { V.log.push(`${only[V.i].name}: probe ${JSON.stringify(A.lens.probed)}`); A.lens.probed = null; }
            if (++V.i >= only.length) { V.done = true; return { done: true }; }
            const s = only[V.i];
            V.t = 0; V.pre = s.pre ?? 1.0; V.fired = new Set();
            addr.style.opacity = 0; end.style.opacity = 0;
            A.markers.closeCard(); applyLook(s); s.setup?.(); V.fading = !!s.slot && slot(s.slot);
            s.path = path(s.keys); V.phase = V.pre > 0 ? 'pre' : 'roll';
          }
          const s = only[V.i];
          if (V.phase === 'pre') {
            // the pre-roll: its last half second runs into the shot's move at the shot's speed (the move is already
            // running on the first kept frame); it lasts until its time is up and any slot crossfade has finished, then
            // SETTLE more seconds with the volumetric light started afresh on the new slot's media
            V.pose(s, -Math.min(Math.max(V.pre, 0), 0.5), dt, false);
            if (V.fading && !A.state.bakedSlotPending) { V.fading = false; A.baked?.shafts?.reset(); V.pre = Math.max(V.pre, SETTLE); }
            if (V.pre > 0 || A.state.bakedSlotPending) { V.pre -= dt; return { save: false, shot: s.name, t: 0, pre: true }; }
            V.phase = 'roll'; if (OPT.probe && (OPT.stills || OPT.ends) && A.lens?.enabled) A.lens.probeNext = true;
          }
          if (V.t >= s.dur - 1e-6) { V.phase = 'next'; continue; }
          for (const [i, [at, fn, when, latest]] of (s.at ?? []).entries()) if (!V.fired.has(i) && V.t >= at - 1e-6 && (!when || when() || V.t >= latest - 1e-6)) { V.fired.add(i); fn(); V.log.push(`${s.name} event ${i} at ${V.t.toFixed(2)} s`); }
          V.pose(s, V.t, dt, true);
          s.overlay?.(V.t);
          const out = { save: true, shot: s.name, t: +V.t.toFixed(4), filmT: +V.filmT.toFixed(4) };
          V.t += dt; V.filmT += dt;
          return out;
        }
      } catch (e) { V.error = String(e?.stack || e); V.done = true; return { done: true, error: V.error }; }
    },
    // the shot's pose at shot time t (a still: its fixed time); every shot moves linearly in time (no easing)
    pose(s, t, dt, rolling) {
      place(s.path(s.still ? s.still.u : t / s.dur), s.fov ?? 40, s.ahead ?? 0);
      lookAt(s, s.still ? s.still.t : t, dt, rolling);
    },
    start() {
      // a slot's fade begins (and its hold ends) when the destination is fully staged: its 'transition' progress report
      const b = A.baked, setSlot = b.setSlot;
      b.setSlot = (name, cb) => setSlot(name, (f, info) => { if (info?.phase === 'transition') V.slotBegun = true; cb?.(f, info); });
      for (const k of ['rn', 'pano', 'photo']) A.markers.toggle(k, false);
      if (pets?.hearts && OPT.hearts === false) pets.hearts.spawn = () => {};
      // no film grain (it costs the encode and the reference has none); the lens at its defaults otherwise
      if (A.lighting.grade?.grain) A.lighting.grade.grain.value = 0;
    },
  };
})();
