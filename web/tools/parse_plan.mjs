// Parse Zillow floor_shape.svg (metres, +y = north) into data/house.json
// Walls are axis-aligned rectangles; doors/windows are rectangles sitting inside wall rectangles.
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync(new URL('../../source/zillow/floor_shape.svg', import.meta.url), 'utf8');
const section = (name) => { const i = svg.indexOf(`<g id="${name}">`); let d = 0; const re = /<g\b|<\/g>/g; re.lastIndex = i; let m; while ((m = re.exec(svg))) { d += m[0] === '</g>' ? -1 : 1; if (d === 0) return svg.slice(i, m.index + m[0].length); } };
const polys = (s) => [...s.matchAll(/points="([^"]+)"/g)].map(m => m[1].trim().split(/\s+/).map(p => p.split(',').map(Number)));
const rect = (pts) => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
const walls = [...section('walls').matchAll(/<g id="([^"]+)" class="wall"><polygon points="([^"]+)"/g)].map(m => { const r = rect(polys(`points="${m[2]}"`)[0]); const w = r.x1 - r.x0, h = r.y1 - r.y0; return { id: m[1], ...r, dir: w > h ? 'H' : 'V', thick: Math.min(w, h) }; });
const openings = [];
for (const [cls, kind] of [['door', 'door'], ['window', 'window']]) {
  for (const m of section(cls + 's').matchAll(new RegExp(`<g id="([0-9a-f]+)" class="${cls}">(.*?)</g>`, 'g'))) { const r = rect(polys(m[2])[0]); const w = r.x1 - r.x0, h = r.y1 - r.y0; openings.push({ id: m[1], kind, ...r, dir: w > h ? 'H' : 'V', width: Math.max(w, h) }); }
}
const rooms = [...section('roomShapes').matchAll(/<g id="([0-9a-f]+)" class="roomShape"><polygon points="([^"]+)"/g)].map(m => ({ id: m[1], pts: polys(`points="${m[2]}"`)[0] }));
const notes = [...section('notes').matchAll(/<g id="([0-9a-f]+)" class="note" data-room="([0-9a-f]*)">(.*?)<\/g><\/g>/gs)].map(m => { const t = [...m[3].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(x => x[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"')); const tr = m[3].match(/class="label" transform="translate\(([-\d.]+),([-\d.]+)\)/); const area = (m[3].match(/class="virtualSpace"><polygon points="([^"]+)"/) || [])[1]; return { id: m[1], room: m[2], label: t[0], dims: t[1] || null, at: tr ? [+tr[1], +tr[2]] : null, area: area ? area.trim().split(/\s+/).map(p => p.split(',').map(Number)) : null }; });
const footprint = polys(section('footprint'))[0];
const vb = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
// Attach openings to walls and split walls into solid pieces + lintel/sill pieces.
const CEIL = 2.44, DOOR_H = 2.06, WIN_SILL = 0.95, WIN_HEAD = 2.06;
const pieces = [];
for (const w of walls) {
  const along = w.dir === 'H' ? ['x0', 'x1'] : ['y0', 'y1'];
  const across = w.dir === 'H' ? ['y0', 'y1'] : ['x0', 'x1'];
  const ops = openings.filter(o => o.dir === w.dir && o[across[0]] < w[across[1]] - 1e-3 && o[across[1]] > w[across[0]] + 1e-3 && o[along[0]] < w[along[1]] - 1e-3 && o[along[1]] > w[along[0]] + 1e-3).sort((a, b) => a[along[0]] - b[along[0]]);
  let cur = w[along[0]];
  const push = (a, b, y0, y1, kind) => { if (b - a < 1e-3) return; const p = { wall: w.id, dir: w.dir, kind, z0: y0, z1: y1 }; if (w.dir === 'H') { p.x0 = a; p.x1 = b; p.y0 = w.y0; p.y1 = w.y1; } else { p.y0 = a; p.y1 = b; p.x0 = w.x0; p.x1 = w.x1; } pieces.push(p); };
  for (const o of ops) {
    const a = Math.max(cur, o[along[0]]), b = Math.min(w[along[1]], o[along[1]]);
    push(cur, a, 0, CEIL, 'solid');
    if (o.kind === 'door') { push(a, b, DOOR_H, CEIL, 'lintel'); o.wall = w.id; }
    else { push(a, b, 0, WIN_SILL, 'sill'); push(a, b, WIN_HEAD, CEIL, 'lintel'); o.wall = w.id; }
    cur = b;
  }
  push(cur, w[along[1]], 0, CEIL, 'solid');
}
const out = { units: 'm', up: '+y north; three.js z = -y', viewBox: vb, ceiling: CEIL, doorHeight: DOOR_H, windowSill: WIN_SILL, windowHead: WIN_HEAD, footprint, rooms, notes, walls, openings, pieces };
writeFileSync(new URL('../data/house.json', import.meta.url), JSON.stringify(out));
console.log('walls', walls.length, 'pieces', pieces.length, 'openings', openings.length, 'unattached', openings.filter(o => !o.wall).map(o => o.id + ' ' + o.kind));
