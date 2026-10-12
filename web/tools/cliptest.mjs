// Mesh-level clipping audit. AABBs only select candidates; two independent triangle
// parity rays confirm sampled points inside both solids (or a leaf inside a solid).
// Usage: node tools/cliptest.mjs [--json=/tmp/ch/clip.json] [--filter=sofa] [--limit=100]
import { chromium } from 'playwright';
import fs from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, '').split('=')));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(`${args.url || 'http://127.0.0.1:8780'}/index.html?batch=0&pins=0&fast=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const result = await page.evaluate(({ filter }) => {
    const { THREE: T, scene, layout, getDoors } = window.__app, tol = .003;
    scene.updateMatrixWorld(true);
    const cache = new Map(), v = () => new T.Vector3(), ray = new T.Ray(), hit = v();
    const pixels = new Map();
    function visibleVertex(m, index) {
      const mat = Array.isArray(m.o.material) ? m.o.material[0] : m.o.material, uv = m.o.geometry.attributes.uv;
      if (!mat.alphaTest || !mat.map?.image || !uv) return true;
      const tex = mat.map;
      if (!pixels.has(tex)) {
        if (tex.image.data) pixels.set(tex, { w: tex.image.width, h: tex.image.height, a: tex.image.data });
        else { const c = document.createElement('canvas'); c.width = tex.image.width; c.height = tex.image.height;
          const ctx = c.getContext('2d'); ctx.drawImage(tex.image, 0, 0); pixels.set(tex, { w: c.width, h: c.height, a: ctx.getImageData(0, 0, c.width, c.height).data }); }
      }
      const p = pixels.get(tex), u = new T.Vector2(uv.getX(index), uv.getY(index)); tex.transformUv(u);
      const x = Math.min(p.w - 1, Math.max(0, Math.floor(u.x * p.w))), y = Math.min(p.h - 1, Math.max(0, Math.floor(u.y * p.h)));
      return p.a[(y * p.w + x) * 4 + 3] / 255 >= mat.alphaTest;
    }
    const directions = [new T.Vector3(1, .371, .529).normalize(), new T.Vector3(-.217, 1, .413).normalize()];
    function data(g) {
      if (cache.has(g)) return cache.get(g);
      const p = g.attributes.position, ix = g.index, tris = [], count = ix ? ix.count : p.count;
      for (let i = 0; i < count; i += 3) {
        const vs = [0, 1, 2].map(j => v().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j));
        const b = new T.Box3().setFromPoints(vs); tris.push({ vs, b, c: b.getCenter(v()) });
      }
      function tree(ts) {
        const b = new T.Box3(); for (const t of ts) b.union(t.b);
        if (ts.length <= 12) return { b, ts };
        const s = b.getSize(v()), axis = s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z';
        ts.sort((a, b) => a.c[axis] - b.c[axis]); const mid = ts.length >> 1;
        return { b, a: tree(ts.slice(0, mid)), c: tree(ts.slice(mid)) };
      }
      // Open alpha cards and uncapped tubes are surfaces, never containing volumes.
      // Weld by position so UV seams do not make a closed box appear open.
      const edges = new Map(), key = p => p.toArray().map(x => Math.round(x * 1e5)).join(',');
      for (const t of tris) {
        const ks = t.vs.map(key); if (new Set(ks).size < 3) continue;
        for (let i = 0; i < 3; i++) { const a = ks[i], b = ks[(i + 1) % 3], k = a < b ? `${a}|${b}` : `${b}|${a}`; edges.set(k, (edges.get(k) || 0) + 1); }
      }
      const closed = edges.size > 0 && [...edges.values()].every(n => n % 2 === 0);
      g.computeBoundingBox(); const d = { tree: tree(tris), p, box: g.boundingBox, closed };
      cache.set(g, d); return d;
    }
    function inside(m, world) {
      const mats = Array.isArray(m.o.material) ? m.o.material : [m.o.material];
      if (mats.some(m => m.alphaTest > 0)) return 0;
      const d = data(m.o.geometry), p = world.clone().applyMatrix4(m.inv);
      if (!d.closed) return 0;
      if (!d.box.containsPoint(p)) return 0;
      let depth = Infinity;
      for (const dir of directions) {
        ray.origin.copy(p); ray.direction.copy(dir); const hits = [];
        function visit(n) {
          if (!ray.intersectsBox(n.b)) return;
          if (n.ts) { for (const t of n.ts) if (ray.intersectTriangle(...t.vs, false, hit)) { const dist = hit.distanceTo(p); if (dist > 1e-7) hits.push(dist); } }
          else { visit(n.a); visit(n.c); }
        }
        visit(d.tree); hits.sort((a, b) => a - b);
        const unique = hits.filter((x, i) => !i || x - hits[i - 1] > 1e-5);
        if (!(unique.length % 2)) return 0;
        depth = Math.min(depth, unique[0]);
      }
      const tri = new T.Triangle(), close = v();
      function nearest(n) {
        if (n.b.distanceToPoint(p) >= depth) return;
        if (n.ts) { for (const t of n.ts) { tri.set(...t.vs).closestPointToPoint(p, close); depth = Math.min(depth, close.distanceTo(p)); } }
        else { nearest(n.a); nearest(n.c); }
      }
      nearest(d.tree); return depth * m.scale;
    }
    function meshes(root) {
      const out = []; root.traverse(o => {
        if (!o.isMesh || !o.geometry?.attributes.position || o.isReflector || !o.visible) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.every(m => m.transparent && m.opacity < .1)) return;
        o.geometry.computeBoundingBox();
        out.push({ o, b: o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld), inv: o.matrixWorld.clone().invert(), scale: o.getWorldScale(v()).minComponent?.() || Math.min(...o.getWorldScale(v()).toArray()) });
      }); return out;
    }
    const roots = layout.placed.map((o, index) => ({ o, index, p: o.userData.placement, ms: meshes(o), label: `${o.userData.placement.m}.${o.userData.placement.i}#${index}` }));
    for (const r of roots) { r.b = new T.Box3(); r.ms.forEach(m => r.b.union(m.b)); }
    const shell = { label: 'house', ms: meshes(scene.getObjectByName('house')), b: new T.Box3() }; shell.ms.forEach(m => shell.b.union(m.b));
    const findings = [], intended = [], stats = { roots: roots.length, meshes: roots.reduce((n, r) => n + r.ms.length, shell.ms.length), candidates: 0, confirmed: 0 };
    function test(a, b) {
      if (filter && !`${a.label} ${b.label}`.includes(filter)) return;
      if (!a.b.intersectsBox(b.b)) return;
      let best = null, pairs = 0;
      for (const m of a.ms) for (const n of b.ms) {
        if (!m.b.intersectsBox(n.b)) continue;
        const box = m.b.clone().intersect(n.b), size = box.getSize(v()), dims = size.toArray();
        // Thin leaves/curtains still get surface samples; ordinary support contact is ignored.
        if (Math.max(...dims) < tol || (size.y <= tol && Math.min(m.b.getSize(v()).y, n.b.getSize(v()).y) > tol)) continue;
        stats.candidates++; const pts = [];
        if (Math.min(...dims) > tol) for (const x of [.2, .5, .8]) for (const y of [.2, .5, .8]) for (const z of [.2, .5, .8]) pts.push({ p: new T.Vector3(box.min.x + x * size.x, box.min.y + y * size.y, box.min.z + z * size.z) });
        for (const own of [m, n]) {
          const p = own.o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 80));
          for (let i = 0; i < p.count; i += step) {
            if (!visibleVertex(own, i)) continue;
            const q = v().fromBufferAttribute(p, i).applyMatrix4(own.o.matrixWorld);
            if (box.containsPoint(q)) pts.push({ p: q, own });
          }
        }
        let confirmed = false;
        for (const q of pts) {
          const dm = q.own === m ? Infinity : inside(m, q.p), dn = q.own === n ? Infinity : inside(n, q.p);
          const depth = Math.min(dm, dn, ...dims.filter(x => x > tol));
          if (dm > tol && dn > tol && depth > tol) {
            const detail = m => ({ type: m.o.geometry.type, parent: m.o.parent.name, min: m.b.min.toArray(), max: m.b.max.toArray() });
            confirmed = true; if (!best || depth > best.depth) best = { depth, location: [q.p.x, -q.p.z, q.p.y], meshA: a.ms.indexOf(m), meshB: b.ms.indexOf(n), detailA: detail(m), detailB: detail(n) };
          }
        }
        if (confirmed) pairs++;
      }
      if (best) {
        stats.confirmed++;
        const f = { a: a.label, b: b.label, ...best, meshPairs: pairs, placementA: a.p, placementB: b.p };
        // Fixtures mounted in a ceiling/wall and structural garage hardware embed by design.
        const mount = /recessedLight|trackLight|shopLight|garageDoorOpen|ironColumn|wallRail|electricalPanel|leaningFrame/;
        if (b === shell && mount.test(a.p.i)) { f.reason = 'architectural mounting'; intended.push(f); }
        else findings.push(f);
      }
    }
    for (let i = 0; i < roots.length; i++) {
      test(roots[i], shell);
      for (let j = i + 1; j < roots.length; j++) test(roots[i], roots[j]);
      // Loose pillows are audited within a builder too; upholstery/frame joinery
      // and books supplied by that builder remain intentionally nested.
      const r = roots[i], parts = [...new Set(r.ms.map(m => m.o.userData.clipPart).filter(Boolean))];
      const grouped = parts.map(part => ({ ...r, label: `${r.label}.${part}`, ms: r.ms.filter(m => m.o.userData.clipPart === part) }));
      const body = { ...r, label: `${r.label}.body`, ms: r.ms.filter(m => !m.o.userData.clipPart) };
      for (let j = 0; j < grouped.length; j++) { test(grouped[j], body); for (let k = j + 1; k < grouped.length; k++) test(grouped[j], grouped[k]); }
    }
    // Sweep actual hinged leaves through their full supported travel in 7.5° steps.
    // Frames and leaves belonging to the house are intentionally excluded here.
    for (const d of getDoors().filter(d => d.pivot && d.openAngle !== undefined)) {
      const angle = d.pivot.rotation.y, start = findings.length;
      for (let k = 0; k <= 12; k++) {
        d.pivot.rotation.y = d.openAngle * k / 12; d.group.updateMatrixWorld(true);
        const door = { label: `door.${d.id}.sweep`, ms: meshes(d.pivot), b: new T.Box3() }; door.ms.forEach(m => door.b.union(m.b));
        for (const r of roots) test(r, door);
      }
      d.pivot.rotation.y = angle; d.group.updateMatrixWorld(true);
      const hits = findings.splice(start), unique = new Map();
      for (const f of hits) { const key = `${f.a}/${f.b}`; if (!unique.has(key) || unique.get(key).depth < f.depth) unique.set(key, f); }
      findings.push(...unique.values());
    }
    const support = [], caster = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
    const wallProp = /Art|print|Mirror|Hook|Hanging|towelBar|paperRoll|towelRing|floatingShelf|pegTote|robe|throwDraped/;
    for (const r of roots) {
      if (!/^props_/.test(r.p.m) || wallProp.test(r.p.i) || /limestone|hoseCoil/.test(r.p.i)) continue;
      if (filter && !r.label.includes(filter)) continue;
      const low = r.ms.filter(m => m.b.min.y <= r.b.min.y + .003), samples = [];
      for (const m of low) {
        const p = m.o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 40));
        for (let i = 0; i < p.count; i += step) { const q = v().fromBufferAttribute(p, i).applyMatrix4(m.o.matrixWorld); if (q.y <= r.b.min.y + .003) samples.push(q); }
      }
      const others = [shell, ...roots.filter(o => o !== r && o.b.min.y <= r.b.min.y && o.b.max.y >= r.b.min.y - .15 && o.b.intersectsBox(r.b.clone().expandByScalar(.15)))].flatMap(o => o.ms.map(m => m.o));
      let gap = Infinity, location;
      for (const q of samples) {
        caster.set(q.clone().add(new T.Vector3(0, .001, 0)), down); caster.far = .15;
        const hit = caster.intersectObjects(others, false)[0];
        if (hit && hit.distance - .001 < gap) { gap = hit.distance - .001; location = [q.x, -q.z, q.y]; }
      }
      if (gap > tol && gap < Infinity) support.push({ a: r.label, gap, location, placement: r.p });
    }
    findings.sort((a, b) => b.depth - a.depth);
    return { tolerance: tol, method: 'world mesh AABBs + overlap/vertex samples + two BVH triangle parity rays + nearest triangle distance; door sweeps and downward support rays; sampled estimate, not an exhaustive proof', stats, findings, intended, support, placements: roots.map(r => r.p) };
  }, { filter: args.filter || '' });
  result.errors = errors;
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.stats), `| ${result.findings.length} overlaps >3mm, ${result.intended.length} mounts, ${errors.length} console errors`);
  for (const [i, f] of result.findings.slice(0, +(args.limit || 100)).entries()) console.log(`${i + 1}. ${f.a} / ${f.b}: ${(f.depth * 1000).toFixed(1)} mm at plan ${f.location.map(x => x.toFixed(3)).join(',')} [meshes ${f.meshA}/${f.meshB}, ${f.meshPairs} pairs]`);
  for (const f of result.support) console.log(`FLOAT ${f.a}: ${(f.gap * 1000).toFixed(1)} mm at plan ${f.location.map(x => x.toFixed(3)).join(',')}`);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
} finally { await browser.close(); }
