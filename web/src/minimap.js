// GTA-style minimap: a round, heading-up radar in the corner drawn from the Zillow vector floor plan, with blips for
// panoramas (blue), listing photos (green) and RedNote posts (red). M opens the full plan where every dot is clickable.
import { THREE } from './kit.js';
import { getLang, t } from './ui.js';

const VB = [-8.246258596094643, -5.699660161646401, 16.50411768657405, 11.778618533436845];   // svg viewBox (image y = -plan y)
const LOT = { x0: -14.5, x1: 14.5, y0: -14.2, y1: 19.5 };
export class Minimap {
  constructor(player, layout, points, tour, posts, ui, goTo) {
    this.player = player; this.layout = layout; this.points = points; this.tour = tour; this.posts = posts; this.ui = ui; this.goTo = goTo;
    this.canvas = document.getElementById('minimap'); this.ctx = this.canvas.getContext('2d');
    this.big = document.getElementById('bigmap'); this.bigCanvas = document.getElementById('bigmapCanvas'); this.bctx = this.bigCanvas.getContext('2d');
    this.img = new Image(); this.img.src = 'data/floor_shape.svg'; this.imgReady = false; this.img.onload = () => { this.imgReady = true; };
    this.radiusM = 7.5;   // metres from centre to the rim
    this.dpr = Math.min(devicePixelRatio, 2); this.canvas.width = 220 * this.dpr; this.canvas.height = 220 * this.dpr;
    this.blips = [];
    this.rebuildBlips();
    this.bigCanvas.addEventListener('click', (e) => this.bigClick(e));
    this.bigOpen = false;
    addEventListener('langchange', () => this.rebuildBlips());
  }
  rebuildBlips() {
    const P = this.points, toPlan = (px, py) => [VB[0] + px / 100 * VB[2], -(VB[1] + py / 100 * VB[3])];
    this.blips = [];
    for (const p of P.panorama) { const [x, y] = toPlan(p.x, p.y); this.blips.push({ kind: 'pano', id: p.id, x, y, title: p.title, order: p.order }); }
    for (const p of P.photo) { const [x, y] = toPlan(p.x, p.y); this.blips.push({ kind: 'photo', id: p.id, x, y, heading: p.angle, gallery: p.gallery }); }
    // panos not on the plan (outdoor) + rednote posts come from the viewpoints/rednote systems
    for (const b of this.extraBlips || []) this.blips.push(b);
  }
  setExtra(blips) { this.extraBlips = blips; this.rebuildBlips(); }
  // plan -> canvas px for the small radar (heading-up, centred on the player)
  draw() {
    const c = this.ctx, S = this.canvas.width, R = S / 2, pxPerM = R / this.radiusM;
    const px = this.player.pos.x, py = -this.player.pos.z, yaw = this.player.yaw;  // plan heading up: rotate world by heading
    c.save(); c.clearRect(0, 0, S, S);
    c.beginPath(); c.arc(R, R, R - 1, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#9fb28a'; c.fillRect(0, 0, S, S);              // lawn/garden base
    c.translate(R, R + R * 0.18); c.rotate(-(-yaw));                // heading up: the player's forward (-yaw) points up. canvas +y is down; plan north = up.
    // plan → canvas: dx = (x - px) * k, dy = -(y - py) * k   (north up before rotation). Rotation by +yaw makes forward point up (forward heading = -yaw in plan terms).
    c.rotate(0);
    const k = pxPerM;
    const toC = (x, y) => [(x - px) * k, -(y - py) * k];
    // lot + surfaces
    const rect = (x0, y0, x1, y1, fill) => { const [a, b] = toC(x0, y1), [d, e] = toC(x1, y0); c.fillStyle = fill; c.fillRect(a, b, d - a, e - b); };
    rect(LOT.x0, LOT.y0, LOT.x1, LOT.y1, '#e9e4d6');               // shell gravel lot
    rect(-14.2, -14.2, -8.4, 19.5, '#9fb28a'); rect(8.6, -14.2, 14.5, 19.5, '#9fb28a');
    rect(-2.4, 5.47, 4.2, 10.2, '#cfcfca'); rect(-0.65, -14.2, 0.65, -6.25, '#cfcfca'); rect(-7.9, -14.2, -3.9, -4.72, '#cfcfca'); rect(-11.2, -9.0, -8.3, -3.6, '#cfcfca');
    rect(-8.02, -4.72, -3.5, 0.66, '#dfe4ea');                      // garage
    // floor plan image (svg) over the house
    if (this.imgReady) { const [ix, iy] = toC(VB[0], -VB[1]); c.drawImage(this.img, ix, iy, VB[2] * k, VB[3] * k); }
    // blips
    for (const b of this.blips) { const [x, y] = toC(b.x, b.y); if (x * x + y * y > (R * 1.4) ** 2) continue; c.beginPath(); c.arc(x, y, 3.2 * this.dpr, 0, Math.PI * 2); c.fillStyle = b.kind === 'pano' ? '#2f6fe0' : b.kind === 'photo' ? '#2fa66a' : '#e0383a'; c.fill(); c.lineWidth = this.dpr; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke(); }
    // player arrow (always at centre, pointing up)
    c.restore(); c.save(); c.translate(R, R + R * 0.18);
    c.rotate(0);
    c.beginPath(); c.moveTo(0, -9 * this.dpr); c.lineTo(6.5 * this.dpr, 7 * this.dpr); c.lineTo(0, 3.5 * this.dpr); c.lineTo(-6.5 * this.dpr, 7 * this.dpr); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.stroke();
    // north tick on the rim
    c.restore(); c.save(); c.translate(R, R); c.rotate(this.player.yaw);
    c.fillStyle = '#fff'; c.font = `${11 * this.dpr}px sans-serif`; c.textAlign = 'center'; c.fillText('N', 0, -R + 14 * this.dpr);
    c.restore();
    // vignette rim
    c.save(); const g = c.createRadialGradient(R, R, R * 0.7, R, R, R); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)'); c.fillStyle = g; c.fillRect(0, 0, S, S); c.restore();
  }
  toggleBig() { this.bigOpen = !this.bigOpen; this.big.classList.toggle('hidden', !this.bigOpen); if (this.bigOpen) { this.player.unlock(); this.drawBig(); this.bigTimer = setInterval(() => this.drawBig(), 250); } else { clearInterval(this.bigTimer); } }
  bigMetrics() { const r = this.bigCanvas.getBoundingClientRect(); const W = r.width * this.dpr, H = r.height * this.dpr; const k = Math.min(W / (LOT.x1 - LOT.x0 + 2), H / (LOT.y1 - LOT.y0 + 2)); const ox = W / 2 - ((LOT.x0 + LOT.x1) / 2) * k, oy = H / 2 + ((LOT.y0 + LOT.y1) / 2) * k; return { W, H, k, ox, oy, toC: (x, y) => [ox + x * k, oy - y * k] }; }
  drawBig() {
    const r = this.bigCanvas.getBoundingClientRect(); this.bigCanvas.width = r.width * this.dpr; this.bigCanvas.height = r.height * this.dpr;
    const c = this.bctx, { W, H, k, toC } = this.bigMetrics();
    c.clearRect(0, 0, W, H); c.fillStyle = '#f3f6fb'; c.fillRect(0, 0, W, H);
    const rect = (x0, y0, x1, y1, fill) => { const [a, b] = toC(x0, y1), [d, e] = toC(x1, y0); c.fillStyle = fill; c.fillRect(a, b, d - a, e - b); };
    rect(LOT.x0, LOT.y0, LOT.x1, LOT.y1, '#ece7da'); rect(-14.2, -14.2, -8.4, 19.5, '#b7c9a0'); rect(8.6, -14.2, 14.5, 19.5, '#b7c9a0');
    rect(-2.4, 5.47, 4.2, 10.2, '#d6d6d1'); rect(-0.65, -14.2, 0.65, -6.25, '#d6d6d1'); rect(-7.9, -14.2, -3.9, -4.72, '#d6d6d1'); rect(-11.2, -9.0, -8.3, -3.6, '#d6d6d1'); rect(-8.02, -4.72, -3.5, 0.66, '#e4e8ee');
    if (this.imgReady) { const [ix, iy] = toC(VB[0], -VB[1]); c.drawImage(this.img, ix, iy, VB[2] * k, VB[3] * k); }
    c.fillStyle = '#5b6470'; c.font = `${12 * this.dpr}px sans-serif`; c.textAlign = 'center';
    const lab = (x, y, s) => { const [a, b] = toC(x, y); c.fillText(s, a, b); };
    lab(-5.9, -2.0, t('Garage')); lab(0.9, 7.8, t('Patio')); lab(5.0, 13.5, t('Backyard')); lab(0, -10.5, t('Front yard'));
    this.hit = [];
    for (const b of this.blips) { const [x, y] = toC(b.x, b.y); c.beginPath(); c.arc(x, y, 6 * this.dpr, 0, Math.PI * 2); c.fillStyle = b.kind === 'pano' ? '#2f6fe0' : b.kind === 'photo' ? '#2fa66a' : '#e0383a'; c.fill(); c.lineWidth = 1.5 * this.dpr; c.strokeStyle = '#fff'; c.stroke(); this.hit.push({ x, y, b }); if (b.heading !== undefined) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.sin(b.heading * Math.PI / 180) * 14 * this.dpr, y - Math.cos(b.heading * Math.PI / 180) * 14 * this.dpr); c.strokeStyle = 'rgba(47,166,106,.7)'; c.stroke(); } }
    // player
    const [px, py] = toC(this.player.pos.x, -this.player.pos.z); c.save(); c.translate(px, py); c.rotate(-this.player.yaw); c.beginPath(); c.moveTo(0, -10 * this.dpr); c.lineTo(7 * this.dpr, 8 * this.dpr); c.lineTo(0, 4 * this.dpr); c.lineTo(-7 * this.dpr, 8 * this.dpr); c.closePath(); c.fillStyle = '#1d1b18'; c.fill(); c.restore();
    c.fillStyle = '#1d1b18'; c.textAlign = 'left'; c.font = `${13 * this.dpr}px sans-serif`;
    const legend = [['#2f6fe0', t('pano')], ['#2fa66a', t('photo')], ['#e0383a', t('rnpost')]]; legend.forEach(([col, s], i) => { c.beginPath(); c.arc(20 * this.dpr, (20 + i * 20) * this.dpr, 6 * this.dpr, 0, 7); c.fillStyle = col; c.fill(); c.fillStyle = '#1d1b18'; c.fillText(s, 32 * this.dpr, (24 + i * 20) * this.dpr); });
  }
  bigClick(e) {
    const r = this.bigCanvas.getBoundingClientRect(); const x = (e.clientX - r.left) * this.dpr, y = (e.clientY - r.top) * this.dpr;
    let best = null, bd = 14 * this.dpr;
    for (const h of this.hit || []) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.b; } }
    if (best) { this.toggleBig(); this.goTo(best); return; }
    // otherwise teleport to the clicked floor point
    const { k, ox, oy } = this.bigMetrics(); const wx = (x - ox) / k, wy = (oy - y) / k; this.toggleBig(); this.goTo({ kind: 'point', x: wx, y: wy });
  }
}
