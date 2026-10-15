// CPU-only checks. No renderer, browser, GPU, fetch or scene construction.
// Run from web/: node src/webgpu/check.mjs
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'croton-webgpu-check-'));
try {
  const output = join(temporary, 'data.mjs');
  await build({ stdin: { contents: `
    export { parseUnits, relayout, matchUnits } from './assets.js';
    export { parseProbes, buildProbeVolume } from './probes.js';
    export { unpackLuts } from './agx.js';
    export { BufferGeometry, BufferAttribute, DataUtils } from 'three/webgpu';
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, outfile: output, bundle: true, platform: 'node', format: 'esm' });
  const api = await import(pathToFileURL(output));
  const { BufferGeometry, BufferAttribute } = api;
  // Seam duplication must preserve material groups, normalized attributes and UV orientation.
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setAttribute('color', new BufferAttribute(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 3, true));
  geometry.addGroup(0, 3, 2);
  for (const narrow of [false, true]) {
    const header = { atlas: [2, 2], units: [{ id: 'fixture', vc: 3, nv: 4, ni: 6, off: 0, x16: narrow, i16: narrow }] };
    const json = new TextEncoder().encode(JSON.stringify(header));
    const wide = narrow ? Uint16Array : Uint32Array;
    const parts = [new wide([0, 1, 2, 0]), new wide([0, 1, 2, 3, 1, 2]), new Uint16Array([0, 0, 65535, 0, 0, 65535, 32768, 32768])];
    const bytes = new Uint8Array(4 + json.length + parts.reduce((n, p) => n + p.byteLength, 0));
    new DataView(bytes.buffer).setUint32(0, json.length, true); bytes.set(json, 4);
    let offset = 4 + json.length;
    for (const part of parts) { bytes.set(new Uint8Array(part.buffer), offset); offset += part.byteLength; }
    const unit = api.parseUnits(bytes.buffer).units[0], result = api.relayout(geometry, unit);
    assert.equal(result.attributes.position.count, 4);
    assert.deepEqual([...result.attributes.color.array.slice(9)], [1, 2, 3]);
    assert.equal(result.attributes.color.normalized, true);
    assert.deepEqual(result.groups, [{ start: 0, count: 3, materialIndex: 2 }]);
    assert.equal(result.attributes.uv1.getY(0), 1);
    assert.equal(api.relayout(geometry, unit, false).attributes.uv1.getY(0), 0);
    assert.deepEqual([...result.index.array], [0, 1, 2, 3, 1, 2]);
    assert.throws(() => api.parseUnits(bytes.buffer.slice(0, -2)), /sidecar/);
    result.dispose();
  }
  // A sparse volume (one valid probe) must stay finite at every cell, carry signed
  // L1 coefficients, and update lamps without changing spatial weights or axes.
  const sky = new Float32Array(27), sunind = new Float32Array(27), lamps = new Float32Array(27);
  sky[0] = 1; sky[3] = -0.5; sunind[0] = 2; lamps[0] = 4;
  const volume = api.buildProbeVolume({ count: 1, valid: new Uint8Array([1]), points: [0, 1, 0], layers: { sky, sunind, lamps } }, 0.25);
  assert.deepEqual([volume.textures[0].image.width, volume.textures[0].image.height, volume.textures[0].image.depth], [51, 55, 3]);
  for (const texture of volume.textures) assert.ok(texture.image.data.every(v => Number.isFinite(api.DataUtils.fromHalfFloat(v))));
  assert.equal(api.DataUtils.fromHalfFloat(volume.textures[0].image.data[0]), 4);
  assert.equal(api.DataUtils.fromHalfFloat(volume.textures[0].image.data[1]), -0.5);
  volume.fill(0); assert.equal(api.DataUtils.fromHalfFloat(volume.textures[0].image.data[0]), 3);
  const packed = gunzipSync(await readFile(new URL('../../assets/agx/agx_lut.bin.gz', import.meta.url)));
  const buffer = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
  const luts = api.unpackLuts(buffer);
  assert.deepEqual(luts.map(t => t.image.width), [37, 57]);
  for (const lut of luts) assert.ok(lut.image.data.every(v => Number.isFinite(v) && v >= 0 && v <= 65535 / 64000));
  assert.throws(() => api.unpackLuts(buffer.slice(2)), /LUT size/);
  console.log('PASS: compact/wide UV sidecars, seam/group preservation, UV flip, truncation rejection, sparse signed SH and lamp updates, shipped AgX LUT decoding. No shaders compiled.');
} finally { await rm(temporary, { recursive: true, force: true }); }
