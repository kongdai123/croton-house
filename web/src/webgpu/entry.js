// Keep the experimental renderer out of the ordinary walkthrough bundle.
const query = new URLSearchParams(location.search);
if (query.has('webgpu') && query.get('webgpu') !== '0' && !query.has('legacy') && query.get('lightmap') !== '0') {
  try { await import(new URL('./webgpu.js', import.meta.url).href); }
  catch (err) { console.warn('[webgpu] bundle unavailable, using WebGL', err); await import('../main.js'); }
} else {
  await import('../main.js');
}
