// GTA-style minimap: a round, heading-up radar in the corner drawn from the Zillow vector floor plan, with blips for
// panoramas (blue), listing photos (green) and RedNote posts (red). M opens the full plan where every dot is clickable.
import { THREE } from './kit.js';
import { getLang, t } from './ui.js';
import { EXT_FP, pointInPoly, PATIO, COURT_A, COURT_B, WALK, DRIVE, PAD, PORCH, GARDEN, FRONT_BED } from './house.js';
import { BEDS, SHELL, PAVED } from './layout.js';
import { plan } from './plan.js';

const VB = plan.viewBox;   // floor_shape.svg viewBox (image y = -plan y)
const LOT = plan.lot;
// The radar's CSS size at the 1440 × 900 design size (style.css #minimap, scaled by --u on larger windows).
const MAP_CSS = 190;
export class Minimap {
  constructor(player, layout, points, tour, posts, ui, goTo) {
    this.player = player; this.layout = layout; this.points = points; this.tour = tour; this.posts = posts; this.ui = ui; this.goTo = goTo;
    this.canvas = document.getElementById('minimap'); this.ctx = this.canvas.getContext('2d');
    this.big = document.getElementById('bigmap'); this.bigCanvas = document.getElementById('bigmapCanvas'); this.bctx = this.bigCanvas.getContext('2d');
    this.img = new Image(); this.img.src = 'data/floor_shape.svg'; this.imgReady = false; this.img.onload = () => { this.imgReady = true; };
    this.radiusM = 7.5;   // metres from centre to the rim
    this.dpr = Math.min(devicePixelRatio, 2);
    // The radar's CSS size grows with large windows (style.css --u); keep its buffer at display resolution.
    const fit = () => { const w = Math.round((this.canvas.clientWidth || MAP_CSS) * this.dpr); if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = w; } };
    fit(); new ResizeObserver(fit).observe(this.canvas);
    this.blips = [];
    this.rebuildBlips();
    this.bigCanvas.addEventListener('click', (e) => this.bigClick(e));
    this.bigOpen = false;
    addEventListener('langchange', () => this.rebuildBlips());
  }
  rebuildBlips() {
    const P = this.points, toPlan = (px, py) => [VB[0] + px / 100 * VB[2], -(VB[1] + py / 100 * VB[3])];
    this.blips = [];
    if (this.targets) this.blips.push(...this.targets);
    else {
    for (const p of P.panorama) { const [x, y] = toPlan(p.x, p.y); this.blips.push({ kind: 'pano', id: p.id, x, y, title: p.title, order: p.order }); }
    for (const p of P.photo) { const [x, y] = toPlan(p.x, p.y); this.blips.push({ kind: 'photo', id: p.id, x, y, heading: p.angle, gallery: p.gallery }); }
    }
    // panos not on the plan (outdoor) + rednote posts come from the viewpoints/rednote systems
    for (const b of this.extraBlips || []) this.blips.push(b);
  }
  isVisible(kind) { return !this.markers || (this.markers.visible && this.markers.enabled[kind]); }
  setExtra(blips) { this.extraBlips = blips; this.rebuildBlips(); }
  // plan -> canvas px for the small radar (heading-up, centred on the player)
  // The plan both maps draw: the plan model's walls (the garage annex included) and its doors and windows (open-plan
  // seams have no wall to cut), as on the landing plan; room names still from house.json's notes.
  setPlan(house) {
    this.plan = { walls: plan.walls, openings: plan.openings.filter(o => o.kind !== 'open'), notes: house.notes ?? [] };
    this.site = null; this.zoomR = this.radiusM; this.zoomT = performance.now();
  }
  // The garden as plan symbols, gathered once: every planting as a circle of its spread (trees larger, as canopies),
  // garden furniture as outlined boxes.
  collectSite() {
    const plants = [], things = [], box = new THREE.Box3(), size = new THREE.Vector3();
    for (const r of this.layout?.root?.children ?? []) {
      const id = r.userData?.id; if (!id) continue;
      const x = r.position.x, y = -r.position.z;
      if (pointInPoly([x, y], EXT_FP) || x < LOT.x0 || x > LOT.x1 || y < LOT.y0 || y > LOT.y1) continue;   // our lot only
      box.setFromObject(r); if (box.isEmpty()) continue; box.getSize(size);
      if (/^(plants|flowers)-|garden-(blue|black|nursery)/.test(id)) plants.push({ cover: /front-cover|grassClump/.test(id), x, y, r: Math.min(5, Math.max(0.18, Math.max(size.x, size.z) / 2)), tree: /treeLarge|treePine|palm|banana|queen|areca|bird-paddle/.test(id) });
      else if (/^outdoor-/.test(id) && !/lamp|umbrella/.test(id)) things.push({ x0: box.min.x, x1: box.max.x, y0: -box.max.z, y1: -box.min.z });
    }
    plants.sort((p, q) => q.r - p.r);
    this.site = { plants, things };
  }
  // Draw the site (garden, paving, fences, house) with plan -> canvas functions X(x), Y(y), k px per metre, ms px per design px.
  drawSite(c, X, Y, k, ms, view) {
    if (!this.site && this.plan) this.collectSite();
    const fill = (r, col) => { c.fillStyle = col; c.fillRect(X(r.x0), Y(r.y1), (r.x1 - r.x0) * k, (r.y1 - r.y0) * k); };
    const inView = (x, y, r) => !view || (x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1);
    // paving and courts
    for (const r of [PATIO, WALK, DRIVE, PAD, PORCH]) fill(r, 'rgba(26,25,23,.08)');
    for (const r of [COURT_A, COURT_B]) fill(r, 'rgba(26,25,23,.04)');
    // lot line (dashed) and the back-garden fence (solid hairline)
    c.lineWidth = ms; c.setLineDash([4 * ms, 3 * ms]); c.strokeStyle = 'rgba(26,25,23,.4)';
    c.strokeRect(X(LOT.x0), Y(LOT.y1), (LOT.x1 - LOT.x0) * k, (LOT.y1 - LOT.y0) * k); c.setLineDash([]);
    c.strokeStyle = 'rgba(26,25,23,.55)'; c.beginPath(); GARDEN.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.closePath(); c.stroke();
    // Planting: the layout's own beds (back garden, side yards, front beds and the front planting) as one flat translucent
    // green, with the shell paths, the lounge clearing and the paving cut out. Drawn opaque offscreen, laid down once.
    const W = c.canvas.width, H = c.canvas.height;
    if (!this.bedCanvas || this.bedCanvas.width !== W || this.bedCanvas.height !== H) { this.bedCanvas = document.createElement('canvas'); this.bedCanvas.width = W; this.bedCanvas.height = H; }
    const bc = this.bedCanvas.getContext('2d'), poly = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath(); ctx.fill(); };
    bc.globalCompositeOperation = 'source-over'; bc.clearRect(0, 0, W, H); bc.fillStyle = '#3e7a55';
    for (const b of BEDS) poly(bc, b.poly);
    poly(bc, FRONT_BED);
    bc.globalCompositeOperation = 'destination-out';
    for (const sh of SHELL) poly(bc, sh);
    for (const r of PAVED) bc.fillRect(X(r.x0), Y(r.y1), (r.x1 - r.x0) * k, (r.y1 - r.y0) * k);
    bc.globalCompositeOperation = 'source-over';
    c.globalAlpha = 0.2; c.drawImage(this.bedCanvas, 0, 0); c.globalAlpha = 1;
    // the house: paper inside the footprint, then walls in ink, openings cut, windows as one glazing line
    c.fillStyle = '#f2efe7'; c.beginPath(); EXT_FP.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.closePath(); c.fill();
    if (this.plan) {
      // every wall at one even weight (the survey's thicknesses vary from 7 to 20 cm and read as noise at this scale);
      // doors and windows are cut through at the same weight, windows keep one glazing line
      const T = 0.15, even = (r, extra = 0) => {
        const w = r.x1 - r.x0, h = r.y1 - r.y0;
        if (w < h) { const m = (r.x0 + r.x1) / 2; return { x0: m - T / 2 - extra, x1: m + T / 2 + extra, y0: r.y0, y1: r.y1 }; }
        const m = (r.y0 + r.y1) / 2; return { x0: r.x0, x1: r.x1, y0: m - T / 2 - extra, y1: m + T / 2 + extra };
      };
      for (const w of this.plan.walls) fill(even(w), '#1a1917');
      for (const o of this.plan.openings) {
        fill(even(o, 0.01), '#f2efe7');
        if (o.kind !== 'window') continue;
        c.strokeStyle = '#1a1917'; c.lineWidth = Math.max(ms * 0.8, 0.035 * k); c.beginPath();
        if (o.dir === 'H') { const my = Y((o.y0 + o.y1) / 2); c.moveTo(X(o.x0), my); c.lineTo(X(o.x1), my); } else { const mx = X((o.x0 + o.x1) / 2); c.moveTo(mx, Y(o.y1)); c.lineTo(mx, Y(o.y0)); }
        c.stroke();
      }
    } else if (this.imgReady) c.drawImage(this.img, X(VB[0]), Y(-VB[1]), VB[2] * k, VB[3] * k);
  }
  // The visitor: vermilion view cone and dot.
  drawVisitor(c, x, y, ms, L = 26) {
    const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw), a = Math.atan2(fz, fx), h = 0.5, len = L * ms;
    c.fillStyle = 'rgba(191,63,43,.28)'; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a - h) * len, y + Math.sin(a - h) * len); c.lineTo(x + Math.cos(a + h) * len, y + Math.sin(a + h) * len); c.closePath(); c.fill();
    c.fillStyle = '#bf3f2b'; c.beginPath(); c.arc(x, y, 4 * ms, 0, Math.PI * 2); c.fill();
  }
  // Swiss radar, GTA-style: a square of paper, north up, centred on the visitor. Inside the house it shows 7.5 m around
  // you; step into the garden and it eases out to 15 m, so the beds, trees, terrace and fences come into view.
  draw() {
    const c = this.ctx, S = this.canvas.width, ms = S / MAP_CSS;
    const px = this.player.pos.x, py = -this.player.pos.z, now = performance.now();
    const dt = Math.min(0.2, (now - (this.zoomT ?? now)) / 1000); this.zoomT = now;
    const want = pointInPoly([px, py], EXT_FP) ? this.radiusM : 15;
    this.zoomR = (this.zoomR ?? want) + (want - (this.zoomR ?? want)) * (1 - Math.exp(-dt * 2.2));
    const k = (S / 2) / this.zoomR, X = (x) => S / 2 + (x - px) * k, Y = (y) => S / 2 - (y - py) * k;
    const view = { x0: px - this.zoomR, x1: px + this.zoomR, y0: py - this.zoomR, y1: py + this.zoomR };
    c.save(); c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(242,239,231,.9)'; c.fillRect(0, 0, S, S);
    this.drawSite(c, X, Y, k, ms, view);
    const colour = { pano: '#2c4a8a', photo: '#3e7a55', rn: '#bf3f2b' }, q = 2.4 * ms;
    for (const b of this.blips) { if (!this.isVisible(b.kind)) continue; const x = X(b.x), y = Y(b.y); if (x < -q || y < -q || x > S + q || y > S + q) continue; c.fillStyle = colour[b.kind] ?? '#1a1917'; c.fillRect(x - q, y - q, 2 * q, 2 * q); }
    this.drawVisitor(c, S / 2, S / 2, ms);
    // north mark and a scale bar that follows the zoom (2 m inside, 5 m outside)
    c.fillStyle = '#1a1917'; c.font = `${10 * ms}px Liter, "Helvetica Neue", Arial, sans-serif`; c.textBaseline = 'top'; c.textAlign = 'right';
    c.fillText('N ↑', S - 7 * ms, 6 * ms);
    const m = this.zoomR > 10 ? 5 : 2, bx = 8 * ms, byy = S - 10 * ms, bw = m * k;
    c.fillRect(bx, byy, bw, 1.6 * ms); c.fillRect(bx, byy - 3 * ms, ms, 4.6 * ms); c.fillRect(bx + bw - ms, byy - 3 * ms, ms, 4.6 * ms);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(`${m} m`, bx + bw + 4 * ms, byy + 2 * ms);
    c.strokeStyle = '#1a1917'; c.lineWidth = ms; c.strokeRect(ms / 2, ms / 2, S - ms, S - ms);
    c.restore();
  }
  toggleBig() { this.bigOpen = !this.bigOpen; this.big.classList.toggle('hidden', !this.bigOpen); if (this.bigOpen) { this.player.unlock(); this.drawBig(); this.bigTimer = setInterval(() => this.drawBig(), 250); } else { clearInterval(this.bigTimer); } }
  bigMetrics() { const r = this.bigCanvas.getBoundingClientRect(); const W = r.width * this.dpr, H = r.height * this.dpr; const k = Math.min(W / (LOT.x1 - LOT.x0 + 2), H / (LOT.y1 - LOT.y0 + 2)); const ox = W / 2 - ((LOT.x0 + LOT.x1) / 2) * k, oy = H / 2 + ((LOT.y0 + LOT.y1) / 2) * k; return { W, H, k, ox, oy, toC: (x, y) => [ox + x * k, oy - y * k] }; }
  // The full plan (M): the whole lot on paper, room names in small capitals, the gardens, pins as squares you can click,
  // the visitor's cone, a title, a legend, a scale and north. Same drawing as the radar.
  drawBig() {
    const r = this.bigCanvas.getBoundingClientRect(); this.bigCanvas.width = r.width * this.dpr; this.bigCanvas.height = r.height * this.dpr;
    const c = this.bctx, { W, H, k, toC } = this.bigMetrics(), d = this.dpr, zh = getLang() === 'zh';
    const X = (x) => toC(x, 0)[0], Y = (y) => toC(0, y)[1];
    const font = (px) => `${px * d}px Liter, "PingFang SC", "Helvetica Neue", Arial, sans-serif`;
    c.clearRect(0, 0, W, H); c.fillStyle = '#f2efe7'; c.fillRect(0, 0, W, H);
    this.drawSite(c, X, Y, k, d);
    // room names and garden areas, small capitals
    c.fillStyle = 'rgba(26,25,23,.55)'; c.font = font(10); c.textAlign = 'center'; c.textBaseline = 'middle';
    const caps = (s) => s.toUpperCase().split('').join(String.fromCharCode(8202));
    // a name of two words sets on two lines, centred on the point
    const label = (s, x, y) => { const words = s.split(' '), lh = 11 * d; words.forEach((w, i) => c.fillText(caps(w), x, y + (i - (words.length - 1) / 2) * lh)); };
    // Room names: one size for every room, centred in the room's area; Kitchen and Dining sit in their open floor
    // (their areas run into the island and the wall stub), the primary bath in its own small room.
    const NAME = { 'Primary': 'Bath', 'Bathroom': 'Bath', 'Primary Bedroom': 'Primary', 'Living Room': 'Living room', 'Dining Room': 'Dining room' };
    const AT = { 'Kitchen': [-2.1, -3.2], 'Dining Room': [2.2, 3.9], 'Primary': [-7.1, 4.6], 'Primary Bedroom': [-4.06, 3.59] };   // the bedroom's main rectangle, not its hall nub   // open floor clear of walls and the island
    c.font = font(9);
    for (const n of this.plan?.notes ?? []) {
      if (!n.label || /closet/i.test(n.label)) continue;
      const pts = n.area?.length ? n.area : [n.at], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const [cx, cy] = AT[n.label] ?? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], roomW = (Math.max(...xs) - Math.min(...xs)) * k;
      label(NAME[n.label] ?? n.label, X(cx), Y(cy));
    }
    const areas = [[-5.7, -2.6, 'Garage', '车库'], [0.9, 7.9, 'Patio', '露台'], [1.2, 12.8, 'Back garden', '后花园'], [3.5, -10.5, 'Front garden', '前院'], [-6.5, -10.5, 'Drive', '车道']];
    c.fillStyle = 'rgba(26,25,23,.55)'; c.font = font(9);   // same size as the rooms
    for (const [x, y, en, cn] of areas) { if (zh) c.fillText(cn, X(x), Y(y)); else label(en, X(x), Y(y)); }
    // pins
    this.hit = [];
    const colour = { pano: '#2c4a8a', photo: '#3e7a55', rn: '#bf3f2b' }, q = 5 * d;
    for (const b of this.blips) { if (!this.isVisible(b.kind)) continue; const x = X(b.x), y = Y(b.y); c.fillStyle = colour[b.kind] ?? '#1a1917'; c.fillRect(x - q, y - q, 2 * q, 2 * q); this.hit.push({ x, y, b }); }
    this.drawVisitor(c, X(this.player.pos.x), Y(-this.player.pos.z), d, 34);
    // title block, top left
    const m = 22 * d;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = '#1a1917';
    c.fillRect(m, m, 26 * d, 26 * d); c.fillStyle = '#bf3f2b'; c.fillRect(m, m, 26 * d, 26 * d);
    c.fillStyle = '#1a1917'; c.font = font(30); c.fillText(zh ? '平面' : 'Plan', m + 38 * d, m + 24 * d);
    c.font = font(10); c.fillStyle = 'rgba(26,25,23,.6)'; c.fillText(caps('2513 Croton Ave · Sarasota'), m + 38 * d, m + 42 * d);
    // legend, bottom left
    const legend = [['rn', zh ? '小红书' : 'RedNote'], ['pano', zh ? '全景' : 'Panoramas'], ['photo', zh ? '照片' : 'Photographs']];
    c.font = font(12);
    legend.forEach(([kind, s], i) => { const y = H - m - (legend.length - 1 - i) * 22 * d; c.globalAlpha = this.isVisible(kind) ? 1 : 0.3; c.fillStyle = colour[kind]; c.fillRect(m, y - 10 * d, 10 * d, 10 * d); c.fillStyle = '#1a1917'; c.fillText(s, m + 18 * d, y); });
    c.globalAlpha = 1;
    // scale and north, bottom right
    const bw = 5 * k, bx = W - m - bw - 70 * d, by = H - m - 4 * d;
    for (let i = 0; i < 5; i++) { c.fillStyle = '#1a1917'; if (i % 2) { c.strokeStyle = '#1a1917'; c.lineWidth = d; c.strokeRect(bx + i * k, by - 4 * d, k, 4 * d); } else c.fillRect(bx + i * k, by - 4 * d, k, 4 * d); }
    c.fillStyle = '#1a1917'; c.font = font(11); c.fillText('5 m · 16 ft', bx + bw + 8 * d, by);
    c.textAlign = 'right'; c.font = font(13); c.fillText('N ↑', W - m, m + 14 * d);
    c.strokeStyle = '#1a1917'; c.lineWidth = d; c.strokeRect(d / 2, d / 2, W - d, H - d);
  }
  bigClick(e) {
    const r = this.bigCanvas.getBoundingClientRect(); const x = (e.clientX - r.left) * this.dpr, y = (e.clientY - r.top) * this.dpr;
    let best = null, bd = 14 * this.dpr;
    for (const h of this.hit || []) { if (!this.isVisible(h.b.kind)) continue; const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.b; } }
    if (best) { this.toggleBig(); this.goTo(best); return; }
    // otherwise teleport to the clicked floor point
    const { k, ox, oy } = this.bigMetrics(); const wx = (x - ox) / k, wy = (oy - y) / k; this.toggleBig(); this.goTo({ kind: 'point', x: wx, y: wy });
  }
}
