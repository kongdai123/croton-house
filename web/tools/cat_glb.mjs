// Export the procedural cat as a riggable glTF: node tools/cat_glb.mjs [out=assets/pets/cat.glb]
// Skinned body (no fur shells) + eyes, the 31-bone armature and baked clips (walk, idle, sit, lie, jump, pet), sampled from
// the procedural rig at 30 fps into quaternion tracks. Then re-imports the file with GLTFLoader and checks bones / clips.
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const out = process.argv[2] ?? 'assets/pets/cat.glb';
const entry = `
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPet } from '../src/pets/cat.js';
window.exportCat = async () => {
  const pet = createPet({ fresh: true }), { rig, bones, skeleton, built, eyes } = pet._internal;
  // opaque copy of the fur atlas (alpha carries fur height in the app)
  const src = built.texture.image, data = new Uint8Array(src.data); for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const map = new THREE.DataTexture(data, src.width, src.height); map.colorSpace = THREE.SRGBColorSpace; map.flipY = false; map.needsUpdate = true;
  const body = new THREE.SkinnedMesh(built.exportGeo, new THREE.MeshStandardMaterial({ map, roughness: 0.9, name: 'cat_fur' })); body.name = 'cat_body';
  const eyeMesh = new THREE.SkinnedMesh(eyes.geometry, new THREE.MeshPhysicalMaterial({ map: eyes.material.map, roughness: 0.25, clearcoat: 1, name: 'cat_eyes' })); eyeMesh.name = 'cat_eyes';
  const cat = new THREE.Group(); cat.name = 'Cat'; cat.add(bones[0], body, eyeMesh); cat.updateMatrixWorld(true);
  for (const m of [body, eyeMesh]) m.bind(skeleton, new THREE.Matrix4());
  // bake the procedural rig
  const FPS = 30, clips = [], s = { mode: 'idle', speed: 0, turn: 0, t: 0, jumpT: 0, petT: 0, petLeft: 5, petN: 1, camDist: 1 };
  const bake = (name, mode, dur, set) => {
    rig.snap(mode); s.mode = mode; s.speed = mode === 'walk' ? pet.walkSpeed : 0;
    for (let i = 0; i < 60; i++) { set?.(0); s.t = -2 + i / FPS; rig.update(1 / FPS, s); }
    if (mode === 'walk') { rig.g = 1; rig.phase = 0; }
    const n = Math.round(dur * FPS) + 1, times = new Float32Array(n), q = bones.map(() => new Float32Array(n * 4)), hips = new Float32Array(n * 3), root = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const t = k / FPS; times[k] = t; set?.(t); s.t = t; rig.update(k ? 1 / FPS : 0, s);
      bones.forEach((b, i) => b.quaternion.toArray(q[i], 4 * k)); bones[1].position.toArray(hips, 3 * k); root.set([0, s.rootY ?? 0, 0], 3 * k);
    }
    const tracks = bones.map((b, i) => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, q[i]));
    tracks.push(new THREE.VectorKeyframeTrack(bones[1].name + '.position', times, hips));
    if (mode === 'jump') tracks.push(new THREE.VectorKeyframeTrack(bones[0].name + '.position', times, root));
    clips.push(new THREE.AnimationClip(name, dur, tracks));
  };
  const strideT = (0.12 + 0.48 * pet.walkSpeed) / pet.walkSpeed;
  bake('walk', 'walk', strideT);
  bake('idle', 'idle', 4);
  bake('sit', 'sit', 3);
  bake('lie', 'lie', 3);
  bake('jump', 'jump', pet.jumpDuration, (t) => { const j = t / pet.jumpDuration, u = Math.min(1, Math.max(0, (j - pet.jumpTakeoff) / (pet.jumpLand - pet.jumpTakeoff))); s.jumpT = j; s.rootY = 4 * pet.jumpHeight * u * (1 - u); });
  bake('pet', 'pet', 5, (t) => { s.petT = t; s.petLeft = 5 - t; });
  const glb = await new GLTFExporter().parseAsync(cat, { binary: true, animations: clips });
  const bytes = new Uint8Array(glb); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), clips: clips.map(c => c.name + ':' + c.duration.toFixed(2) + 's'), verts: built.exportGeo.attributes.position.count, tris: built.exportGeo.index.count / 3 };
};
window.checkCat = async (url) => {
  const g = await new GLTFLoader().loadAsync(url); let skinned = 0, bones = 0, verts = 0;
  g.scene.traverse(o => { if (o.isSkinnedMesh) { skinned++; bones = Math.max(bones, o.skeleton.bones.length); verts += o.geometry.attributes.position.count; } });
  const mixer = new THREE.AnimationMixer(g.scene), act = mixer.clipAction(g.animations.find(c => c.name === 'walk')); act.play(); mixer.update(0.3);
  return { skinnedMeshes: skinned, bones, verts, clips: g.animations.map(c => c.name + ':' + c.duration.toFixed(2) + 's (' + c.tracks.length + ' tracks)'), mixerOk: true };
};
window.__ready = true;
`;
fs.writeFileSync('tools/.cat_glb_entry.js', entry);
await esbuild.build({ entryPoints: ['tools/.cat_glb_entry.js'], bundle: true, format: 'esm', outfile: 'dist/cat_glb.js', logLevel: 'warning' });
fs.unlinkSync('tools/.cat_glb_entry.js');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8780/tools/', { waitUntil: 'load' });
await page.addScriptTag({ type: 'module', url: '/dist/cat_glb.js?' + Date.now() });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const r = await page.evaluate(() => window.exportCat());
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(out, Buffer.from(r.b64, 'base64'));
console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB', JSON.stringify({ clips: r.clips, verts: r.verts, tris: r.tris }));
const chk = await page.evaluate((u) => window.checkCat(u), '/' + out.replace(/^\.?\//, '') + '?' + Date.now());
console.log('re-import', JSON.stringify(chk));
const ok = chk.skinnedMeshes === 2 && chk.bones === 31 && ['walk', 'idle', 'sit', 'lie', 'jump', 'pet'].every(n => chk.clips.some(c => c.startsWith(n + ':')));
console.log(ok ? 'PASS' : 'FAIL');
await browser.close();
