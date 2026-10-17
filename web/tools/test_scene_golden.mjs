// Golden snapshots of today's scene: rebuilds the real house headless (tools/harness/scene.mjs), re-captures objects /
// classifier answers / room classifiers and diffs them against web/tools/golden/*.json. Any difference fails.
//   node web/tools/test_scene_golden.mjs                 diff
//   UPDATE_GOLDEN=1 node web/tools/test_scene_golden.mjs  rewrite the goldens (review the git diff, then commit)
//   GOLDEN_LINES=50 ...                                  differences printed per file (default 12)
import { captureAll, writeAll, GOLDEN } from './harness/capture.mjs';
import { readGolden, diffDocs } from './harness/util.mjs';
import { diffSpatial } from './harness/spatial.mjs';
import { join } from 'node:path';

const LIMIT = +(process.env.GOLDEN_LINES ?? 12);
const t0 = performance.now();
const all = await captureAll();
if (process.env.UPDATE_GOLDEN) {
  const sizes = writeAll(all);
  console.log('golden updated:', Object.entries(sizes).map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)} MB`).join(', '));
  process.exit(0);
}
let failed = 0;
for (const name of ['objects', 'classify', 'spatial']) {
  const golden = readGolden(join(GOLDEN, name + '.json'));
  if (!golden) { console.log(`FAIL ${name}.json: no golden (run with UPDATE_GOLDEN=1)`); failed++; continue; }
  const fresh = JSON.parse(JSON.stringify(all[name]));   // same normalisation as the file (undefined dropped)
  let lines;
  if (name === 'spatial') {
    const { classifiers: ga, ...restA } = golden, { classifiers: gb, ...restB } = fresh;
    lines = [...diffSpatial(ga, gb), ...diffDocs(restA, restB)];
  } else lines = diffDocs(golden, fresh);
  if (!lines.length) { console.log(`ok   ${name}.json`); continue; }
  failed++;
  console.log(`FAIL ${name}.json: ${lines.length} difference${lines.length === 1 ? '' : 's'}`);
  for (const l of lines.slice(0, LIMIT)) console.log('  ' + l);
  if (lines.length > LIMIT) console.log(`  ... ${lines.length - LIMIT} more (GOLDEN_LINES=${lines.length} to see all)`);
}
console.log(`${failed ? 'FAILED' : 'scene golden OK'} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
