// Stats for nerds: a hidden, YouTube-style overlay. Open it from the right-click menu, with the ` key, or with ?stats=1.
// While it is open the renderer's counters accumulate over a whole frame (the composer renders several passes), and the
// text refreshes twice a second; while it is closed it costs nothing.
const REFRESH_MS = 500;
const BUILD = globalThis.CROTON_BUILD ?? 'dev';

const ms = (v) => (v == null || Number.isNaN(v) ? '–' : `${Math.round(v)} ms`);
const num = (v) => (v == null ? '–' : Math.round(v).toLocaleString('en-US'));

export class Stats {
  constructor({ renderer, camera, player, state, lighting, pets, canvas }) {
    Object.assign(this, { renderer, camera, player, state, lighting, pets, canvas });
    this.open = false; this.frames = 0; this.cpu = 0; this.cpuMax = 0; this.windowStart = performance.now();
    this.el = document.createElement('aside'); this.el.id = 'nerdstats'; this.el.className = 'hidden';
    this.el.setAttribute('aria-label', 'Stats for nerds');
    this.el.innerHTML = '<div class="ns-head"><b>Stats for nerds</b><button type="button" aria-label="Close">×</button></div><pre></pre>';
    this.pre = this.el.querySelector('pre');
    this.el.querySelector('button').addEventListener('click', () => this.toggle(false));
    document.body.appendChild(this.el);
  }
  toggle(on = !this.open) {
    this.open = on; this.el.classList.toggle('hidden', !on);
    this.renderer.info.autoReset = !on;
    this.frames = 0; this.cpu = 0; this.cpuMax = 0; this.windowStart = performance.now();
    if (on) this.refresh(0);
  }
  begin() { if (!this.open) return; this.renderer.info.reset(); this.t0 = performance.now(); }
  end() {
    if (!this.open) return;
    const now = performance.now(), cpu = now - this.t0;
    this.frames++; this.cpu += cpu; this.cpuMax = Math.max(this.cpuMax, cpu);
    this.last = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, points: this.renderer.info.render.points, lines: this.renderer.info.render.lines };
    const span = now - this.windowStart;
    if (span >= REFRESH_MS) { this.refresh(span); this.frames = 0; this.cpu = 0; this.cpuMax = 0; this.windowStart = now; }
  }
  refresh(span) {
    const r = this.renderer, s = this.state, info = r.info, c = this.canvas, cam = this.camera.position, p = this.player;
    const fps = span ? (this.frames * 1000) / span : 0, avg = this.frames ? this.cpu / this.frames : 0;
    const steps = s.warmupSteps ?? {}, heap = performance.memory;
    const heading = ((-(p.yaw ?? 0) * 180) / Math.PI % 360 + 360) % 360;
    const rows = [
      ['Frame', `${fps.toFixed(1)} fps · cap ${s.fpsCap ? `${s.fpsCap} fps` : 'off'}`],
      ['CPU / frame', `${avg.toFixed(2)} ms avg · ${this.cpuMax.toFixed(1)} ms max`],
      ['Draw calls', num(this.last?.calls)],
      ['Triangles', num(this.last?.triangles)],
      ['Programs', num(info.programs?.length)],
      ['Geometries', `${num(info.memory.geometries)} · textures ${num(info.memory.textures)}`],
      ['', ''],
      ['Viewport', `${c.clientWidth} × ${c.clientHeight} css · dpr ${devicePixelRatio}`],
      ['Render', `${c.width} × ${c.height} · ratio ${r.getPixelRatio().toFixed(3)}`],
      ['Quality', `${s.quality} (detected ${s.tier}, ${s.tierSource ?? '?'}) · tex ${s.texSet ?? '?'}`],
      ['GPU', String(s.gpu ?? '?')],
      ['', ''],
      ['Enter ready', ms(s.loadMs)],
      ['Warm-up', Object.entries(steps).map(([k, v]) => `${k} ${v}`).join(' · ') || '–'],
      ['Daylight', `${s.daylightSource ?? '?'} · fingerprint ${this.lighting.daylight?.fingerprint?.toString(16) ?? '?'}`],
      ['Other sky', ms(s.otherSkyMs)],
      ['', ''],
      ['Camera', `x ${cam.x.toFixed(2)} · y ${(-cam.z).toFixed(2)} · eye ${cam.y.toFixed(2)} m · heading ${heading.toFixed(0)}°`],
      ['Pets', this.pets ? 'on' : 'off'],
      ['JS heap', heap ? `${(heap.usedJSHeapSize / 1048576).toFixed(0)} / ${(heap.jsHeapSizeLimit / 1048576).toFixed(0)} MB` : '–'],
      ['Build', BUILD],
    ];
    this.pre.textContent = rows.map(([k, v]) => (k ? `${k.padEnd(12)} ${v}` : '')).join('\n');
  }
}
