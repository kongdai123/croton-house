// The shader goldens (web/tools/golden/shaders.json) against the current shaders, class by class, under the rewrites of
// harness/shader_equiv.mjs: which classes changed text, and whether each change is one of the documented,
// behaviour-preserving ones. A tool for reviewing a golden update, not a test.
//   node web/tools/shader_equiv.mjs [class substring]
import { join } from 'node:path';
import { captureShaders } from './harness/shaders.mjs';
import { equivalent } from './harness/shader_equiv.mjs';
import { readGolden } from './harness/util.mjs';
import { GOLDEN } from './harness/capture.mjs';

const filter = process.argv[2] ?? '';
const golden = readGolden(join(GOLDEN, 'shaders.json')), texts = readGolden(join(GOLDEN, 'shader_texts.json'));
const fresh = await captureShaders();
let same = 0, equal = 0; const differ = [], pairs = new Map();
for (const [k, c] of Object.entries(fresh.classes)) {
  const g = golden.classes[k]; if (!g || !k.includes(filter)) continue;
  if (g.vertex === c.vertex && g.fragment === c.fragment) { same++; continue; }
  for (const f of ['vertex', 'fragment']) {
    const id = g[f] + '>' + c[f];
    if (!pairs.has(id)) pairs.set(id, g[f] === c[f] ? null : equivalent(texts[g[f]], fresh.texts[c[f]]));
    const r = pairs.get(id);
    if (r) { differ.push(`${k} ${f}: ${r}`); break; }
  }
  if (!differ.length || !differ.at(-1).startsWith(k + ' ')) equal++;
  if (g.samplers !== c.samplers) differ.push(`${k}: samplers ${g.samplers} -> ${c.samplers}`);
  if (g.program !== c.program) differ.push(`${k}: program ${g.program} -> ${c.program}`);
}
console.log(`${same} classes unchanged, ${equal} changed and equivalent under the documented rewrites, ${differ.length} not (${pairs.size} distinct text pairs)`);
for (const d of differ.slice(0, +(process.env.LINES ?? 8))) console.log('  ' + d);
