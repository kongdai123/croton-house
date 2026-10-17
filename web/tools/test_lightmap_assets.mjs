// Node-only fixtures: no DOM, browser or GPU. Check manifest fallback and odd-height row orientation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../src/lightmap_assets.js', import.meta.url), 'utf8');
const { lightmapAssets, lightmapBitmap } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const base = 'assets/lightmaps', logical = `${base}/sunrise/probes.bin`;
globalThis.fetch = async (url, opts) => {
  assert.equal(url, `${base}/manifest.json`); assert.equal(opts.cache, 'no-store');
  return { ok: true, json: async () => ({ 'sunrise/probes.bin': 'sunrise/probes.abc.bin' }) };
};
assert.equal((await lightmapAssets(base, true))(logical), `${base}/sunrise/probes.abc.bin`);
globalThis.fetch = async () => ({ ok: false });
assert.equal((await lightmapAssets(base, true))(logical), logical);
globalThis.fetch = async () => { throw new Error('offline'); };
assert.equal((await lightmapAssets(base, true))(logical), logical);

globalThis.fetch = () => { throw new Error('dev must not request a manifest'); };
assert.equal((await lightmapAssets(base))(logical), logical);

const rows = { top: [1, 2], bottom: [3, 4, 5], single: [1, 2, 3, 4, 5] }, closed = [];
globalThis.fetch = async url => ({ ok: true, blob: async () => url });
globalThis.createImageBitmap = async (url, opts) => {
  assert.deepEqual(opts, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' });
  return { width: 2, height: rows[url].length, rows: rows[url].toReversed(), close() { closed.push(url); } };
};
// the caller uploads each part at its row offset (texSubImage2D): emulate that and compare with one flipped atlas
const single = await lightmapBitmap('single'), split = await lightmapBitmap(['top', 'bottom'], [2, 3]), texture = [];
for (const { bitmap, y } of split.parts) bitmap.rows.forEach((r, i) => { texture[y + i] = r; });
assert.deepEqual({ width: split.width, height: split.height, rows: texture }, { width: single.width, height: single.height, rows: single.rows });
assert.deepEqual(closed, []);
await assert.rejects(lightmapBitmap(['top', 'bottom'], [2, 2]), /split dimensions/);
assert.deepEqual(closed, ['top', 'bottom']);
globalThis.fetch = async url => ({ ok: url === 'top', status: 404, blob: async () => url });
await assert.rejects(lightmapBitmap(['top', 'missing'], [2, 3]), /404/);
assert.deepEqual(closed, ['top', 'bottom', 'top']);
globalThis.fetch = async () => ({ ok: false, status: 404 });
await assert.rejects(lightmapBitmap('single'), /404/);
console.log('lightmap assets: manifest, fallback, odd rows, part offsets, dimensions, fetch errors OK');
