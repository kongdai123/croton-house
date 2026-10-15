import * as THREE from 'three/webgpu';
import { lightmapAssets, lightmapBitmap } from '../lightmap_assets.js';

export async function checkedFetch(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
}

export async function binary(url) {
  let buffer = await (await checkedFetch(url)).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    buffer = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return buffer;
}

// Same sidecar formats as lightmap.js; kept here until its CPU loaders are extracted.
export function parseUnits(buffer) {
  const length = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length)));
  const take = (offset, count, narrow) => narrow
    ? Uint32Array.from(new Uint16Array(buffer.slice(offset, offset + count * 2)))
    : new Uint32Array(buffer.slice(offset, offset + count * 4));
  for (const unit of header.units) {
    let offset = 4 + length + unit.off;
    unit.xref = take(offset, unit.nv, unit.x16); offset += unit.nv * (unit.x16 ? 2 : 4);
    unit.index = take(offset, unit.ni, unit.i16); offset += unit.ni * (unit.i16 ? 2 : 4);
    unit.uv = new Uint16Array(buffer.slice(offset, offset + unit.nv * 4));
    if (unit.xref.length !== unit.nv || unit.index.length !== unit.ni || unit.uv.length !== unit.nv * 2 ||
        unit.xref.some(i => i >= unit.vc) || unit.index.some(i => i >= unit.nv)) throw new Error('Invalid lightmap sidecar');
  }
  return header;
}

export function relayout(geometry, unit, flip = true) {
  if (Object.keys(geometry.morphAttributes).length) throw new Error('Lightmapped morph geometry is unsupported');
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (attribute.isInterleavedBufferAttribute) throw new Error('Lightmapped interleaved geometry is unsupported');
    const size = attribute.itemSize, data = new attribute.array.constructor(unit.nv * size);
    for (let i = 0; i < unit.nv; i++) for (let k = 0; k < size; k++) data[i * size + k] = attribute.array[unit.xref[i] * size + k];
    result.setAttribute(name, new THREE.BufferAttribute(data, size, attribute.normalized));
  }
  const uv = Float32Array.from(unit.uv, (value, i) => flip && i % 2 ? 1 - value / 65535 : value / 65535);
  result.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  result.setIndex(new THREE.BufferAttribute(unit.index, 1));
  for (const group of geometry.groups) result.addGroup(group.start, group.count, group.materialIndex);
  result.setDrawRange(geometry.drawRange.start, geometry.drawRange.count);
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

export function matchUnits(scene, header, flip) {
  scene.updateMatrixWorld(true);
  const byId = new Map(header.units.filter(u => u.id).map(u => [u.id, u]));
  const byCount = new Map(), used = new Set(), pairs = new Map(), meshes = [];
  for (const unit of header.units) {
    if (!byCount.has(unit.vc)) byCount.set(unit.vc, []);
    byCount.get(unit.vc).push(unit);
  }
  scene.traverse(o => {
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.geometry?.attributes.position && !o.userData.lmSkip && !o.userData.batched) meshes.push(o);
  });
  for (const mesh of meshes) {
    const unit = byId.get(mesh.userData.lmId);
    if (unit && !used.has(unit) && unit.vc === mesh.geometry.attributes.position.count) { pairs.set(mesh, unit); used.add(unit); }
  }
  const byIdCount = pairs.size, box = new THREE.Box3(), point = new THREE.Vector3();
  for (const mesh of meshes) {
    if (pairs.has(mesh)) continue;
    const candidates = byCount.get(mesh.geometry.attributes.position.count);
    if (!candidates?.some(u => !used.has(u))) continue;
    box.makeEmpty();
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
    const unit = candidates.find(u => !used.has(u) &&
      Math.abs(box.min.x - u.min[0]) + Math.abs(box.min.y - u.min[1]) + Math.abs(box.min.z - u.min[2]) +
      Math.abs(box.max.x - u.max[0]) + Math.abs(box.max.y - u.max[1]) + Math.abs(box.max.z - u.max[2]) < 0.006);
    if (unit) { pairs.set(mesh, unit); used.add(unit); }
  }
  for (const [mesh, unit] of pairs) {
    mesh.geometry = relayout(mesh.geometry, unit, flip);
    mesh.castShadow = true; mesh.receiveShadow = true;
  }
  if (!pairs.size) throw new Error('No baked units matched; check the scene/sidecar versions');
  return { meshes: new Set(pairs.keys()), stats: { units: header.units.length, matched: pairs.size, byId: byIdCount,
    byBox: pairs.size - byIdCount, unusedUnits: header.units.length - pairs.size } };
}

async function atlas(renderer, asset, dir, layer, rows) {
  const bitmap = await lightmapBitmap(rows ? rows.map((_, i) => asset(`${dir}/${layer}_${i}.webp`)) : asset(`${dir}/${layer}.webp`), rows);
  const options = { flipY: false, premultiplyAlpha: false, colorSpace: THREE.NoColorSpace, channel: 1,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true };
  if (!bitmap.parts) {
    const texture = Object.assign(new THREE.Texture(bitmap), options);
    texture.needsUpdate = true;
    // Both backends copy the bitmap synchronously on upload (copyExternalImageToTexture / texImage2D). Release the
    // decoded copy then: at full resolution each atlas holds ~140 MB of CPU-side pixels otherwise.
    const { width, height } = bitmap;
    texture.onUpdate = () => { texture.onUpdate = null; texture.image = { width, height }; bitmap.close(); };
    return texture;
  }
  // r183 common Textures skips upload when dataReady=false but allocates storage.
  // Both backends copy image textures into it and generate destination mips after each copy.
  const texture = Object.assign(new THREE.DataTexture(null, bitmap.width, bitmap.height), options);
  texture.source.dataReady = false; texture.needsUpdate = true;
  try {
    for (const part of bitmap.parts) {
      const source = Object.assign(new THREE.Texture(part.bitmap), { ...options, generateMipmaps: false, minFilter: THREE.LinearFilter });
      source.needsUpdate = true;
      try { renderer.copyTextureToTexture(source, texture, null, new THREE.Vector2(0, part.y)); }
      finally { source.dispose(); }
    }
    return texture;
  } catch (error) { texture.dispose(); throw error; }
  finally { for (const part of bitmap.parts) part.bitmap.close(); }
}

export async function loadBake(renderer, resolution) {
  const base = 'assets/lightmaps', dir = `${base}/v2/sunrise`, asset = await lightmapAssets(base);
  const encoding = await (await checkedFetch(asset(`${dir}/encoding.json`))).json();
  if (encoding.curve !== 'sqrt(x/(x+K))' || !['slot', 'lamps'].every(k => Number.isFinite(encoding.K?.[k]) && encoding.K[k] > 0)) {
    throw new Error('Expected tone-curved v2 lightmaps and positive encoding.K.slot / encoding.K.lamps');
  }
  let uvResponse = await fetch(asset(`${base}/v2/lightmap_uv2.bin.gz`));
  if (uvResponse.status === 404) uvResponse = await checkedFetch(asset(`${base}/v2/lightmap_uv.bin`));
  if (!uvResponse.ok) throw new Error(`UV sidecar: ${uvResponse.status}`);
  let uvBuffer = await uvResponse.arrayBuffer();
  if (new Uint8Array(uvBuffer)[0] === 0x1f && new Uint8Array(uvBuffer)[1] === 0x8b) {
    uvBuffer = await new Response(new Blob([uvBuffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const path = resolution === 'full' ? dir : `${dir}/${resolution}`;
  const [slot, lamps, probes] = await Promise.all([
    atlas(renderer, asset, path, 'slot', resolution === 'full' ? encoding.rows?.slot : null),
    atlas(renderer, asset, path, 'lamps', resolution === 'full' ? encoding.rows?.lamps : null),
    binary(asset(`${base}/sunrise/probes.bin`)),
  ]);
  return { header: parseUnits(uvBuffer), encoding, slot, lamps, probes, asset };
}
