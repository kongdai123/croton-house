// GPU node only. Verify the browser's split-atlas texture upload preserves every encoded RGB byte and row orientation.
// usage: node validate/deployment.mjs site_deploy_src/build bakes/deploy/sunrise tools/lightmap_assets.js
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
const [site, arrays, helper] = process.argv.slice(2), root = resolve(site);
const code = await readFile(helper, 'utf8'), moduleURL = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.end('<!doctype html>'); return; }
  try { res.end(await readFile(join(root, req.url.split('?')[0]))); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for (const layer of ['slot', 'lamps']) {
    const npy = await readFile(join(arrays, `${layer}_tone.npy`));
    const v1 = npy[6] === 1, headerSize = v1 ? 10 : 12, n = v1 ? npy.readUInt16LE(8) : npy.readUInt32LE(8);
    const header = npy.subarray(headerSize, headerSize + n).toString();
    assert.match(header, /'descr':\s*'\|u1'/); assert.match(header, /'fortran_order':\s*False/);
    const [, height, width] = header.match(/'shape':\s*\((\d+),\s*(\d+),\s*3\s*,?\)/).map(Number);
    const hash = createHash('sha256'), data = npy.subarray(headerSize + n), stride = width * 3;
    for (let y = height - 1; y >= 0; y--) hash.update(data.subarray(y * stride, (y + 1) * stride));
    const expected = hash.digest('hex');
    const result = await page.evaluate(async ({ layer, moduleURL }) => {
      const { lightmapAssets, lightmapBitmap } = await import(moduleURL), base = 'assets/lightmaps', asset = await lightmapAssets(base);
      const enc = await (await fetch(asset(`${base}/v2/sunrise/encoding.json`))).json(), rows = enc.rows?.[layer];
      const urls = rows ? rows.map((_, i) => asset(`${base}/v2/sunrise/${layer}_${i}.webp`)) : asset(`${base}/v2/sunrise/${layer}.webp`);
      // upload as lightmap.js does (texSubImage2D of each ImageBitmap part into one RGBA8 texture), read it back
      const image = await lightmapBitmap(urls, rows), parts = image.parts ?? [{ bitmap: image, y: 0 }];
      const width = image.width, height = image.height, gl = new OffscreenCanvas(1, 1).getContext('webgl2');
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
      for (const { bitmap, y } of parts) { gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, gl.RGBA, gl.UNSIGNED_BYTE, bitmap); bitmap.close(); }
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const pixels = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError()) throw new Error('webgl error');
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0, j = 0; i < pixels.length; i += 4) { rgb[j++] = pixels[i]; rgb[j++] = pixels[i + 1]; rgb[j++] = pixels[i + 2]; if (pixels[i + 3] !== 255) throw new Error('atlas alpha'); }
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', rgb)), v => v.toString(16).padStart(2, '0')).join('');
      return { width, height, digest };
    }, { layer, moduleURL });
    assert.deepEqual(result, { width, height, digest: expected });
    console.log(layer, width, height, 'WebGL texture RGB bytes exact (flipped),', expected);
  }
} finally { await browser?.close(); server.close(); }
