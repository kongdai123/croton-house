// Yield once a slice has run ~8 ms (a synchronous Safari link usually fills one alone): a nested setTimeout(0) is
// clamped to 4 ms, so yielding after every material or variant would add seconds to the load.
let sliceStart = -Infinity;
export const shaderYield = () => performance.now() - sliceStart < 8 ? Promise.resolve()
  : new Promise(resolve => setTimeout(() => { sliceStart = performance.now(); resolve(); }, 0));
export async function warmPrograms(renderer, scene, camera, target = null, entries = null, shadows = renderer.shadowMap?.enabled) {
  const parallel = renderer.getContext().getExtension('KHR_parallel_shader_compile');
  if (parallel && !entries) {
    const saved = renderer.getRenderTarget();
    try { renderer.setRenderTarget(target); return renderer.compileAsync(scene, camera); }
    finally { renderer.setRenderTarget(saved); }
  }
  const jobs = entries ?? [];
  if (!entries) scene.traverse(o => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) for (const material of [].concat(o.material ?? [])) jobs.push({ object: o, material }); });
  const seen = new Set(), linked = new Set(), pending = [];
  for (const { object, material } of jobs) {
    const g = object.geometry;
    const key = [material.uuid, !!object.isSkinnedMesh, !!object.isInstancedMesh, !!object.isBatchedMesh, !!object.isPoints, !!object.isLine,
      Object.entries(g?.attributes ?? {}).map(([k, a]) => k + a.itemSize).join(','), Object.entries(g?.morphAttributes ?? {}).map(([k, a]) => k + a.length).join(','), !!g?.morphTargetsRelative].join('|');
    if (seen.has(key)) continue; seen.add(key);
    await shaderYield();
    const saved = renderer.getRenderTarget(), savedShadow = renderer.shadowMap?.enabled, proxy = Object.create(object);
    proxy.material = material; proxy.traverse = cb => cb(proxy); proxy.traverseVisible = cb => { if (proxy.visible) cb(proxy); };   // compile gathers lights from both scenes: never count a child light twice
    try {
      if (renderer.shadowMap) renderer.shadowMap.enabled = shadows;
      renderer.setRenderTarget(target);
      if (parallel) pending.push(renderer.compileAsync(proxy, camera, scene));
      else {
        const materials = renderer.compile(proxy, camera, scene);
        for (const m of materials) for (const p of renderer.properties.get(m).programs?.values() ?? []) {
          if (linked.has(p)) continue; linked.add(p); p.getUniforms();   // force first-use linking inside this batch
        }
      }
    } finally { if (renderer.shadowMap) renderer.shadowMap.enabled = savedShadow; renderer.setRenderTarget(saved); }
  }
  await Promise.all(pending);
}
