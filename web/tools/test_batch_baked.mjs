// Runtime merges of the baked walkthrough (batch_baked.js, plant_clusters.js): what the walkthrough camera draws is the
// same triangles, in the same world places, with the same materials, before and after, through every pose of the
// toggles and animations; fewer draws; undo restores. CPU only (no WebGL, browser or GPU).
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-batch2-'));
try {
  const built = await build({ stdin: { contents: `export * as T from 'three'; export { batchBaked, rigidParts } from './src/batch_baked.js';
    export { createPlantClusters, mainLayersTest } from './src/plant_clusters.js'; export { classifyLighting } from './src/lighting_roles.js';
    export { createRestClusters } from './src/rest_clusters.js'; export { fastPicks } from './src/pick_bvh.js';
    export { stillParts, batchStatic, updateSwayLod } from './src/batch.js';
    export { items as decor } from './src/furniture/decor.js'; export { items as outdoor } from './src/furniture/outdoor.js';
    export { items as garage } from './src/furniture/garage.js';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  globalThis.location = { search: '' };
  const deep = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : deep, set: () => true, apply: () => deep });
  const element = () => ({ getContext: () => deep, addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} });
  globalThis.document = { createElement: element, createElementNS: element };
  const { T, batchBaked, createPlantClusters, createRestClusters, mainLayersTest, classifyLighting, stillParts, batchStatic, updateSwayLod, fastPicks, decor, outdoor, garage } = await import(pathToFileURL(file));

  // what a camera on `layers` draws: per material, the world triangles (vertices to 0.01 mm), and the draw count
  const v = new T.Vector3();
  function drawn(scene, layers = new T.Layers()) {
    scene.updateMatrixWorld(true);
    const out = new Map(); let draws = 0;
    const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    scene.traverse(o => {
      if (!o.isMesh || !shown(o) || !o.layers.test(layers)) return;
      const g = o.geometry, idx = g.index, pos = g.attributes.position, ms = [].concat(o.material);
      const range = g.drawRange, n = idx ? idx.count : pos.count, start = range.start, end = Math.min(n, range.start + range.count);
      const parts = Array.isArray(o.material) ? g.groups.map(gr => [gr.start, gr.start + gr.count, ms[gr.materialIndex]]) : [[start, end, o.material]];
      for (const [a, b, m] of parts) {
        if (!m || m.visible === false) continue;
        draws++;
        const list = out.get(m) ?? []; out.set(m, list);
        for (let i = a; i + 2 < b + 1 && i < Math.min(b, end); i += 3) {
          const tri = [];
          for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld); tri.push(v.toArray()); }
          tri.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]); list.push(tri);
        }
      }
    });
    return { out, draws };
  }
  // the same triangles: matched one to one, every vertex within 1e-5 m (float32 rounding of a transform done once on the
  // CPU instead of per vertex on the GPU)
  const TOL = 1e-5, key = t => t.map(p => p.map(x => Math.round(x * 100)).join(',')).join(' ');
  const near = (p, q) => { for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) if (Math.abs(p[k][c] - q[k][c]) > TOL) return false; return true; };
  const same = (a, b, what) => {
    assert.equal(a.out.size, b.out.size, `${what}: the same materials draw`);
    for (const [m, list] of a.out) {
      const other = b.out.get(m); assert.ok(other, `${what}: material ${m.name || m.type} still draws`);
      assert.equal(other.length, list.length, `${what}: ${m.name || m.type} draws as many triangles`);
      const buckets = new Map(); for (const t of other) { const k = key(t); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(t); }
      let missing = 0;
      for (const t of list) {
        let bucket = buckets.get(key(t)), hit = bucket ? bucket.findIndex(q => near(t, q)) : -1;
        if (hit < 0) for (const bk of buckets.values()) { const i = bk.findIndex(q => near(t, q)); if (i >= 0) { bucket = bk; hit = i; break; } }
        if (hit < 0) { missing++; continue; }
        bucket.splice(hit, 1);
      }
      assert.equal(missing, 0, `${what}: ${m.name || m.type} draws the same triangles (${missing} of ${list.length} unmatched)`);
    }
  };

  // toggles and animated furniture: every pose draws the same before and after
  const cases = { cellularShade: decor.cellularShade, curtainSheer: decor.curtainSheer, umbrella: outdoor.umbrella, firePit: outdoor.firePit, garageDoorOpen: garage.garageDoorOpen };
  const report = {};
  for (const [name, make] of Object.entries(cases)) {
    if (!make) continue;
    const scene = new T.Scene(), root = make(); root.position.set(3, 0, -2); root.rotation.y = 0.7; scene.add(root);
    classifyLighting(scene, { stillParts });
    const t = root.userData.toggle, animate = root.userData.animate;
    const poses = [() => { t?.set(false, true); animate?.(0); }, () => { t?.set(true, true); animate?.(1.7); }, () => { t?.set(false, true); t?.set(true); animate?.(0.05); animate?.(0.45); }, () => { t?.set(false, true); animate?.(4.2); }];
    const before = poses.map(p => { p(); return drawn(scene); });
    poses[0]();
    const b = batchBaked({ roots: [root], moving: [root] });
    const after = poses.map(p => { p(); return drawn(scene); });
    before.forEach((d, i) => same(d, after[i], `${name} pose ${i}`));
    report[name] = `${before[0].draws} -> ${after[0].draws} draws`;
    assert.ok(after[0].draws <= before[0].draws, `${name}: no more draws`);
    if (name === 'cellularShade') assert.ok(after[0].draws <= 6, `${name}: the pleats draw as one (${after[0].draws})`);
    b.undo(); poses[0]();
    same(before[0], drawn(scene), `${name} undone`);
    let merged = 0; scene.traverse(o => { if (o.userData.batch2) merged++; }); assert.equal(merged, 0, `${name}: undo removes the merged meshes`);
  }

  // multi-material meshes (a shelf of books: six faces, three materials each) split per material and merged; no tint
  {
    const scene = new T.Scene(), shelf = new T.Group(); scene.add(shelf); shelf.position.set(-1, 0.5, 2);
    const cover = new T.MeshStandardMaterial({ color: 0x223344 }), pages = new T.MeshStandardMaterial({ color: 0xeeeedd }), spine = new T.MeshStandardMaterial({ color: 0x884422 });
    for (let i = 0; i < 12; i++) { const b = new T.Mesh(new T.BoxGeometry(0.03, 0.22, 0.16), [spine, cover, pages, pages, cover, cover]); b.position.set(i * 0.035, 0.11, 0); b.rotation.z = (i % 3) * 0.05; shelf.add(b); }
    const odd = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), new T.MeshStandardMaterial({ transparent: true, opacity: 0.5 })); shelf.add(odd);
    classifyLighting(scene);
    const before = drawn(scene), b = batchBaked({ roots: [shelf] }), after = drawn(scene);
    same(before, after, 'books');
    assert.equal(before.draws, 12 * 6 + 1); assert.equal(after.draws, 3 + 1, 'books: one draw per material (and the transparent box alone)');
    assert.ok(odd.visible && !odd.userData.batched, 'a transparent mesh is left alone');
    for (const m of b.merged) assert.ok(m.userData.noHighlight && m.userData.batch2 && m.raycast !== T.Mesh.prototype.raycast, 'merged pieces: no hover tint, no raycast');
    let hidden = 0; shelf.traverse(o => { if (o.isMesh && !o.visible && o.userData.batched) hidden++; }); assert.equal(hidden, 12, 'the books stay in the graph, hidden (raycasts)');
    report.books = `${before.draws} -> ${after.draws} draws`;
  }

  // far plants: the walkthrough camera draws the merged mesh, the frozen copies for everyone else; near plants drop out
  {
    const scene = new T.Scene(), main = new T.PerspectiveCamera(), other = new T.Layers(), group = new T.Group(); scene.add(group, main);
    const leaf = new T.MeshStandardMaterial({ color: 0x336633 }), bark = new T.MeshStandardMaterial({ color: 0x664422 });
    const lod = [];
    for (let i = 0; i < 4; i++) {
      const root = new T.Group(); root.position.set(i * 1.5, 0, 1); root.rotation.y = i; scene.add(root);
      const frozen = new T.Group(); frozen.name = 'frozen'; frozen.userData.batch = true; root.add(frozen);
      for (const m of [leaf, bark]) {
        const g = new T.IcosahedronGeometry(0.4 + i * 0.1, 1); g.setAttribute('foliage', new T.BufferAttribute(new Uint8Array(g.attributes.position.count * 3).fill(10 + i), 3, true));
        const mesh = new T.Mesh(g, m); mesh.userData.batch = true; frozen.add(mesh);
      }
      lod.push({ root, frozen, parts: [], far: true });
    }
    scene.updateMatrixWorld(true);
    const beforeMain = drawn(scene, main.layers), beforeOther = drawn(scene, other);
    const pc = createPlantClusters({ lod, camera: main, parent: group });
    assert.equal(pc.stats.clusters, 2, 'one merged mesh per material in the cell');
    same(beforeMain, drawn(scene, main.layers), 'far plants, walkthrough camera');
    same(beforeOther, drawn(scene, other), 'far plants, other views (shadows, reflections)');
    assert.equal(drawn(scene, main.layers).draws, 2);
    lod[1].frozen.visible = false; lod[2].frozen.visible = false; pc.update();
    const nearMain = drawn(scene, main.layers), nearOther = drawn(scene, other);
    pc.dispose(); const plain = drawn(scene, main.layers); same(plain, nearMain, 'two plants near: the merged mesh drops them'); same(nearOther, drawn(scene, other), 'other views unchanged');
    // the foliage bake's crossfade writes the frozen copies' attributes: the merged arrays follow, and upload
    const pc2 = createPlantClusters({ lod, camera: main, parent: group }), cl = pc2.clusters[0], merged = cl.mesh.geometry.attributes.foliage;
    const a = cl.members[1].mesh.geometry.attributes.foliage, version = merged.version;
    a.array.fill(200); a.needsUpdate = true;
    assert.ok(merged.version > version, 'a write to a frozen copy marks the merged attribute for upload');
    const n0 = cl.members[0].mesh.geometry.attributes.position.count;
    assert.equal(merged.array[n0 * 3], 200, 'the merged array holds the write'); assert.equal(merged.array[0], 10 + (lod.indexOf(cl.members[0].e)), 'its neighbour is untouched');
    pc2.dispose(); assert.equal(a.array[0], 200, 'dispose keeps the frozen copy\'s data'); assert.ok(a.array.buffer !== merged.array.buffer, 'and gives it its own array back');
    // the layer test: the walkthrough camera is refused the frozen copies and alone draws the merged meshes
    const test = mainLayersTest(main.layers), l = new T.Layers(); l.test = test;
    assert.ok(l.test(main.layers) && l.test(other)); l.mainOff = true; assert.ok(!l.test(main.layers) && l.test(other)); l.mainOff = false; l.mainOnly = true; assert.ok(l.test(main.layers) && !l.test(other));
    report.plants = '8 frozen draws -> 2';
  }
  // doors, toggles and carried pieces at rest: merged for the walkthrough camera; a moving, hidden or tinted member draws
  // itself; back at rest (in a new pose: re-copied) it rejoins
  {
    const scene = new T.Scene(), main = new T.PerspectiveCamera(), other = new T.Layers(), group = new T.Group(); scene.add(group, main);
    const wood = new T.MeshStandardMaterial({ color: 0x886644 }), metal = new T.MeshStandardMaterial({ color: 0x999999 });
    const chairs = [];
    for (let i = 0; i < 3; i++) {
      const chair = new T.Group(); chair.position.set(i * 0.8, 0, 2); chair.rotation.y = i * 0.4; scene.add(chair);
      const seat = new T.Mesh(new T.BoxGeometry(0.45, 0.05, 0.45), wood); seat.position.y = 0.45; chair.add(seat);
      const leg = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.45), metal); leg.position.set(0.2, 0.22, 0.2); chair.add(leg);
      chairs.push(chair);
    }
    const curtain = new T.Group(), cloth = new T.Mesh(new T.PlaneGeometry(1, 2), wood), cloth2 = cloth.clone(); curtain.add(cloth, cloth2); cloth2.position.x = 1; scene.add(curtain);
    curtain.userData.animate = t => { cloth.rotation.x = 0.01 * Math.sin(t); };
    scene.updateMatrixWorld(true);
    const before = drawn(scene, main.layers), beforeOther = drawn(scene, other);
    const rc = createRestClusters({ roots: [...chairs, curtain], camera: main, parent: group });
    assert.equal(rc.stats.clusters, 2, 'one merged mesh per material (the billowing curtain is never at rest)');
    same(before, drawn(scene, main.layers), 'at rest, walkthrough camera'); same(beforeOther, drawn(scene, other), 'at rest, other views');
    assert.equal(drawn(scene, main.layers).draws, 2 + 2);
    // carried: the chair draws itself at once, in its new pose; held still, it rejoins re-copied
    chairs[1].position.x += 0.5; chairs[1].updateMatrixWorld(true); rc.update();
    const plain = () => { rc.dispose(); const d = drawn(scene, main.layers); return d; };
    const moving = drawn(scene, main.layers); assert.equal(rc.stats.live, 2);
    for (let i = 0; i < 25; i++) rc.update();
    assert.equal(rc.stats.live, 0); assert.equal(rc.stats.recaptures, 2);
    const rested = drawn(scene, main.layers);
    // the hover tint: another material object on the member's mesh
    const tint = wood.clone(); chairs[2].children[0].material = tint; rc.update();
    const tinted = drawn(scene, main.layers); assert.ok(tinted.out.has(tint), 'the tinted seat draws itself');
    chairs[2].children[0].material = wood; for (let i = 0; i < 25; i++) rc.update();
    const back = drawn(scene, main.layers), reference = plain();
    same(reference, moving, 'a moving chair'); same(reference, rested, 'the chair at rest in its new pose'); same(reference, back, 'tint gone');
    assert.equal(tinted.out.get(tint).length, 12, 'the tinted seat alone');
    // carried out of the merged mesh's bounds (room culling measured its footprint once): it draws itself from then on
    const rc2 = createRestClusters({ roots: [...chairs, curtain], camera: main, parent: group });
    chairs[0].position.x += 10; chairs[0].updateMatrixWorld(true); for (let i = 0; i < 30; i++) rc2.update();
    assert.equal(rc2.stats.live, 2, 'carried away: live'); const away = drawn(scene, main.layers); rc2.dispose(); same(drawn(scene, main.layers), away, 'carried away');
    report.rest = `${before.draws} draws -> 4`;
  }
  // the sway LOD hides a far plant's branches whole: the same meshes show as when each part was hidden one by one
  {
    const scene = new T.Scene(), layoutRoot = new T.Group(); scene.add(layoutRoot);
    const leaf = new T.MeshStandardMaterial(), bark = new T.MeshStandardMaterial(), pot = new T.MeshStandardMaterial();
    const plant = new T.Group(); plant.position.set(20, 0, 0); layoutRoot.add(plant);
    const sw = [];
    for (let i = 0; i < 3; i++) { const pv = new T.Group(), inner = new T.Group(); pv.add(inner); plant.add(pv); inner.add(new T.Mesh(new T.BoxGeometry(0.1, 1, 0.1), bark), new T.Mesh(new T.PlaneGeometry(0.5, 0.5), leaf)); sw.push(pv); }
    plant.add(new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 1), bark), new T.Mesh(new T.CylinderGeometry(0.3, 0.2, 0.4), pot));
    plant.userData.animate = t => { sw.forEach((p, i) => { p.rotation.z = 0.05 * Math.sin(t + i); }); };
    classifyLighting(scene, { stillParts });
    const b = batchStatic([layoutRoot], { animated: [plant] }), e = b.lod[0];
    const inside = (o, g) => { for (let p = o; p; p = p.parent) if (p === g) return true; return false; };
    const shownMeshes = () => { const out = []; scene.traverseVisible(o => { if (o.isMesh && inside(o, plant)) out.push(o.uuid); }); return out.sort(); };
    const expected = far => { const out = []; plant.traverse(o => { if (o.isMesh && (inside(o, e.frozen) ? far : !far || !e.parts.includes(o))) out.push(o.uuid); }); return out.sort(); };
    for (const far of [true, false, true]) {
      updateSwayLod(b.lod, new T.Vector3(far ? 0 : 20, 1.6, 0));
      assert.deepEqual(shownMeshes(), expected(far), `sway LOD (far ${far}): the same meshes show`);
    }
    assert.ok(e.hide.length < e.parts.length, 'branches hide whole');
    report.swayLod = `${e.parts.length} parts, ${e.hide.length} hidden objects`;
  }
  // the aim ray through a bounding volume hierarchy on heavy meshes (pick_bvh.js): the same hits as three's own raycast
  {
    const root = new T.Group(), plain = new T.Group(), single = new T.MeshStandardMaterial({ side: T.FrontSide }), twoSided = new T.MeshStandardMaterial({ side: T.DoubleSide });
    const make = (parent, list) => {
      const knot = new T.Mesh(new T.TorusKnotGeometry(0.4, 0.12, 128, 16), single); knot.position.set(0.3, 1, -2); knot.rotation.set(0.3, 0.7, 0.1); knot.scale.set(1, 1.2, 0.9);
      const box = new T.Mesh(new T.BoxGeometry(1, 1, 1, 24, 24, 24), [single, twoSided, single, twoSided, single, twoSided]); box.position.set(-0.8, 0.8, -3);
      const small = new T.Mesh(new T.BoxGeometry(0.2, 0.2, 0.2), twoSided); small.position.set(0, 1.2, -1.5);
      parent.add(knot, box, small); parent.updateMatrixWorld(true); list.push(knot, box, small);
    };
    const a = [], b = []; make(root, a); make(plain, b);
    assert.equal(fastPicks([root]), 2, 'the two heavy meshes take the hierarchy, the small box keeps three\'s raycast');
    const ray = new T.Raycaster(); let rays = 0, hits = 0;
    for (let i = 0; i < 400; i++) {
      const o = new T.Vector3(Math.sin(i) * 0.7, 1 + Math.cos(i * 1.7) * 0.5, 0.5), d = new T.Vector3(Math.sin(i * 2.3) * 0.5, Math.cos(i * 0.9) * 0.3, -1).normalize();
      ray.set(o, d); ray.far = i % 3 ? 4 : 2.6;
      const ha = ray.intersectObject(root, true), hb = ray.intersectObject(plain, true); rays++; hits += ha.length;
      assert.equal(ha.length, hb.length, `ray ${i}: as many hits`);
      ha.forEach((h, k) => { assert.ok(Math.abs(h.distance - hb[k].distance) < 1e-9 && h.point.distanceTo(hb[k].point) < 1e-9, `ray ${i}: hit ${k} at the same place`); assert.equal(a.indexOf(h.object), b.indexOf(hb[k].object)); });
    }
    assert.ok(hits > 100, 'the rays hit something');
    report.aim = `${rays} rays, ${hits} hits, all the same`;
  }
  console.log('batch_baked / plant_clusters / rest_clusters / sway LOD / aim BVH: same triangles, materials and places in every pose;', JSON.stringify(report));
} finally { await rm(dir, { recursive: true, force: true }); }
