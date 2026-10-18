// Headless baked lighting on the real house: applyLightmaps over the shipped bake (web/assets/lightmaps, read from disk),
// then what main.js adds before the warm compile (the visitor and the pets registered, contact shadows, the hq puddles,
// the mirrors' reflected scenes). No renderer, browser or GPU: HDR images and WebP atlases are never decoded (a WebP's
// size is read from its header, an HDR becomes a 2 x 1 texture), so the shaders and keys are the real ones and the
// light values are not. Used by the shader goldens (shaders.mjs, ../test_shader_golden.mjs).
//
//   const b = await buildBakedScene({ groups: true, slots: true });   // { world, baked, renderer, contact, mirrors, pets }
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildRealScene, WEB } from './scene.mjs';

const EXTRA = `
  export { applyLightmaps } from './src/lightmap.js';
  export { createContact } from './src/contact.js';
  export { createPet as createCat } from './src/pets/cat.js';
  export { createPet as createDog } from './src/pets/dog.js';
  export { Human } from './src/human.js';
  export * as samplerBudget from './src/sampler_budget.js';
  export { materialOptions } from './src/shaders/baked_material.js';
  export { bakedFeatures, flagsKey } from './src/shaders/features.js';
  export { samplerPlan } from './src/shaders/sampler_plan.js';`;
// HDR decoding is the one loader that would need real pixels; every panorama becomes the same 2 x 1 image.
const hdrStub = { name: 'hdr-stub', setup(b) {
  b.onLoad({ filter: /\/HDRLoader\.js$/ }, () => ({ loader: 'js', contents: `import { Texture } from 'three';
    export class HDRLoader { setDataType() { return this; } async loadAsync() { return new Texture({ width: 2, height: 1, data: new Uint16Array(8) }); } }` }));
} };

// Width and height from a WebP header (VP8L lossless, VP8 lossy, VP8X extended).
export function webpSize(buf) {
  const tag = buf.toString('ascii', 12, 16);
  if (tag === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
  if (tag === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (tag === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  throw new Error('not a WebP');
}

// fetch over the working tree; `hide` lists URL fragments answered 404 (a variant without some data)
function diskFetch(hide = []) {
  return async input => {
    const url = typeof input === 'string' ? input : input.url;
    const path = join(WEB, url.split('?')[0]);
    if (hide.some(h => url.includes(h)) || !existsSync(path)) return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
    const data = readFileSync(path);
    return { ok: true, status: 200, json: async () => JSON.parse(data.toString('utf8')), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), blob: async () => ({ path, data }) };
  };
}

// groups: the lamp-group layers (else ?lmgroups=0, the shared lamps layer); slots: all four time slots (else sunrise only)
// before(world): called just before applyLightmaps (a fresh variant: `name` keeps it apart from the cached ones)
export async function buildBakedScene({ groups = true, slots = true, tier = 'hq', name = '', before = null } = {}) {
  const variant = `baked:${groups}:${slots}:${tier}:${name}`;
  const world = await buildRealScene({ extra: EXTRA, plugins: [hdrStub], variant });
  if (world.bakedState) return world.bakedState;
  const { T, scene, layout, lighting, doors } = world;
  globalThis.fetch = diskFetch(slots ? [] : ['/v2/noon/', '/v2/golden/', '/v2/dusk/']);
  globalThis.createImageBitmap = async blob => ({ ...webpSize(blob.data), close() {} });
  globalThis.location.search = '?agx=three&autoexp=0' + (groups ? '' : '&lmgroups=0');
  const domElement = new T.EventDispatcher();
  const renderer = { capabilities: { maxTextureSize: 16384, maxTextures: 16, getMaxAnisotropy: () => 16, isWebGL2: true }, shadowMap: { enabled: true, autoUpdate: true }, domElement,
    extensions: { has: () => true }, getRenderTarget: () => null, setRenderTarget() {}, render() {}, initTexture() {}, copyTextureToTexture() {}, resetState() {},
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, getDrawingBufferSize: v => v.set(1280, 720), getCurrentViewport: v => v.set(0, 0, 1280, 720), getClearColor: c => c.set(0), getClearAlpha: () => 1,
    setClearColor() {}, clear() {}, state: { buffers: { depth: { setMask() {} } }, viewport() {} }, xr: { enabled: false }, info: { render: { calls: 0, triangles: 0 }, autoReset: true } };
  const warn = console.warn, info = console.info, warnings = [];
  console.warn = (...a) => warnings.push(a.map(String).join(' ')); console.info = () => {};
  try {
    before?.(world);
    const baked = await world.applyLightmaps({ scene, renderer, lighting, movables: layout.movables,
      dynamic: [...doors.map(d => d.group), ...layout.animated.filter(o => o.userData.toggle)], slot: 'sunrise', tier });
    // main.js: the visitor and the pets register after baking (always-hot casters), contact and the tier's features next
    const player = { pos: new T.Vector3(), yaw: 0, driven: false, enabled: true };
    const human = new world.Human(scene, player); baked.register(human.root);
    const pets = [world.createCat(), world.createDog()];
    for (const p of pets) { p.root.position.set(1, 0, 1); scene.add(p.root); baked.register(p.root); }
    const camera = new T.PerspectiveCamera();
    const contact = world.createContact({ scene, camera, lighting, movables: layout.movables, pets: { agents: pets.map(p => ({ root: p.root })) }, player, human });
    baked.setFeatures(tier);
    // the mirrors' reflected scenes (hq.js prepareMirrors: merged static geometry, clones of the baked materials)
    layout.prepareMirrors();
    const state = { world, baked, renderer, contact, pets, human, mirrors: layout.mirrors, warnings, variant };
    world.bakedState = state;
    return state;
  } finally { console.warn = warn; console.info = info; }
}
