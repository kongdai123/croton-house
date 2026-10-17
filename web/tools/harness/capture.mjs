// Golden capture of today's behaviour on the real, headless scene.
//   node web/tools/harness/capture.mjs            write web/tools/golden/{objects,classify,spatial}.json
// The golden test (web/tools/test_scene_golden.mjs) imports captureAll() and diffs it against those files.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildRealScene } from './scene.mjs';
import { indexScene, captureObjects } from './objects.mjs';
import { captureClassify } from './classify.mjs';
import { captureSpatialJS, captureSpatialPython, GRID } from './spatial.mjs';
import { writeGolden } from './util.mjs';

export const GOLDEN = fileURLToPath(new URL('../golden/', import.meta.url));

export async function captureAll() {
  const w = await buildRealScene(), ix = indexScene(w);
  const objects = captureObjects(w, ix);
  const classify = captureClassify(w, ix);
  const py = captureSpatialPython(Object.values(objects.bakeSwitches));
  const spatial = { meta: { note: 'Room / inside classifiers sampled on a 5 cm plan lattice (plan frame, +y north); see web/tools/golden/README.md.', grid: GRID, lattice: 'x = (x0 + i * step) / 1000, y = (y0 + j * step) / 1000; rows are y, runs are [labelIndex, length] along x' },
    classifiers: { ...captureSpatialJS(w), ...py.classifiers }, lampGroups: py.lampGroups, order: py.order };
  return { world: w, index: ix, objects, classify, spatial };
}

export function writeAll({ objects, classify, spatial }) {
  const sizes = {};
  sizes['objects.json'] = writeGolden(join(GOLDEN, 'objects.json'), objects);
  sizes['classify.json'] = writeGolden(join(GOLDEN, 'classify.json'), classify);
  sizes['spatial.json'] = writeGolden(join(GOLDEN, 'spatial.json'), spatial);
  return sizes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = performance.now();
  const all = await captureAll();
  const sizes = writeAll(all);
  console.log(`captured in ${((performance.now() - t) / 1000).toFixed(1)} s:`, Object.entries(sizes).map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)} MB`).join(', '));
}
