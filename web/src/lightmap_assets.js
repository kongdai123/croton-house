// Manifest only in packaged builds; plain bake names keep the dev server working.
export async function lightmapAssets(base) {
  const manifest = await fetch(`${base}/manifest.json`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const asset = url => { const name = url.slice(base.length + 1); return manifest?.[name] ? `${base}/${manifest[name]}` : url; };
  asset.manifest = manifest; return asset;
}

// Lossless WebP layers hold encoded light, not display colour: decode without colour conversion or premultiplication,
// rows flipped (bottom-up) like the HDR files were. A split layer (top half first in the file list, the odd row in the
// bottom half) comes back as its flipped parts with the texture row each starts at: the bottom half first, so the
// texture holds the same rows as one flipped atlas. The caller uploads each part with texSubImage2D into one texture
// (no 2D canvas: it would colour-manage and hold a second full-size copy) and closes the parts.
export async function lightmapBitmap(url, rows) {
  const urls = Array.isArray(url) ? url : [url];
  const results = await Promise.allSettled(urls.map(async u => {
    const r = await fetch(u); if (!r.ok) throw new Error(`lightmap ${r.status}: ${u}`);
    return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' });
  }));
  if (results.some(r => r.status === 'rejected')) {
    for (const r of results) if (r.status === 'fulfilled') r.value.close();
    throw results.find(r => r.status === 'rejected').reason;
  }
  const maps = results.map(r => r.value);
  if (!rows) return maps[0];
  if (maps.length !== 2 || rows.length !== 2 || maps.some((m, i) => m.height !== rows[i] || m.width !== maps[0].width)) {
    maps.forEach(m => m.close()); throw new Error('lightmap split dimensions');
  }
  return { width: maps[0].width, height: rows[0] + rows[1], parts: [{ bitmap: maps[1], y: 0 }, { bitmap: maps[0], y: rows[1] }] };
}
