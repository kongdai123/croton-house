// Shader goldens of the baked lighting (tools/harness/shaders.mjs): per material class of the real house, the generated
// vertex / fragment text, the text resolved against three's chunks, the fragment samplers and which classes share a
// program. Any difference fails; a changed text prints its first differing lines.
//   node web/tools/test_shader_golden.mjs                   diff
//   UPDATE_GOLDEN=1 node web/tools/test_shader_golden.mjs   rewrite web/tools/golden/shaders.json + shader_texts.json.gz
//   SHOW=<class substring> node web/tools/test_shader_golden.mjs   print that class's current fragment text
import { join } from 'node:path';
import { captureShaders } from './harness/shaders.mjs';
import { readGolden, writeGolden, canon } from './harness/util.mjs';
import { GOLDEN } from './harness/capture.mjs';

const LIMIT = +(process.env.GOLDEN_LINES ?? 12), t0 = performance.now();
const fresh = await captureShaders();
const doc = { meta: { note: 'Baked shader characterisation (web/tools/harness/shaders.mjs). Texts by hash in shader_texts.json.gz.' }, summary: fresh.summary, classes: fresh.classes };
if (process.env.SHOW) {
  for (const [k, c] of Object.entries(fresh.classes)) if (k.includes(process.env.SHOW)) { console.log(`// ${k}\n// vertex\n${fresh.texts[c.vertex]}\n// fragment\n${fresh.texts[c.fragment]}`); break; }
  process.exit(0);
}
if (process.env.UPDATE_GOLDEN) {
  const used = new Set(Object.values(fresh.classes).flatMap(c => [c.vertex, c.fragment, ...(c.variants ?? [])]));
  writeGolden(join(GOLDEN, 'shaders.json'), doc);
  writeGolden(join(GOLDEN, 'shader_texts.json'), Object.fromEntries([...used].sort().map(h => [h, fresh.texts[h]])), { gzip: true });
  console.log(`shader golden updated: ${Object.keys(fresh.classes).length} classes, ${used.size} texts`);
  process.exit(0);
}
const golden = readGolden(join(GOLDEN, 'shaders.json')), goldenTexts = readGolden(join(GOLDEN, 'shader_texts.json'));
if (!golden || !goldenTexts) { console.log('FAIL no shader golden (run with UPDATE_GOLDEN=1)'); process.exit(1); }
const lines = [];
const firstDiff = (a = '', b = '') => {
  const x = a.split('\n'), y = b.split('\n'); let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return `line ${i + 1}: - ${(x[i] ?? '').trim().slice(0, 150)}\n      + ${(y[i] ?? '').trim().slice(0, 150)}`;
};
for (const k of Object.keys(golden.classes)) if (!(k in fresh.classes)) lines.push(`removed ${k}`);
for (const [k, c] of Object.entries(fresh.classes)) {
  const g = golden.classes[k];
  if (!g) { lines.push(`added   ${k}`); continue; }
  for (const f of ['vertex', 'fragment']) if (g[f] !== c[f]) lines.push(`changed ${k} ${f}: ${firstDiff(goldenTexts[g[f]], fresh.texts[c[f]])}`);
  for (const f of ['resolved', 'samplers', 'materials', 'program', 'missing', 'unstableKey', 'usedBeforeDeclared', 'planMiss', 'dropped']) if (JSON.stringify(canon(g[f] ?? null)) !== JSON.stringify(canon(c[f] ?? null)) && !(f === 'resolved' && (g.vertex !== c.vertex || g.fragment !== c.fragment))) lines.push(`changed ${k} ${f}: ${JSON.stringify(g[f])} -> ${JSON.stringify(c[f])}`);
}
if (JSON.stringify(canon(golden.summary)) !== JSON.stringify(canon(fresh.summary))) lines.push(`summary: ${JSON.stringify(golden.summary)} -> ${JSON.stringify(fresh.summary)}`);
// the invariants, independent of the golden: every chunk resolves, one key never stands for two texts
for (const [k, c] of Object.entries(fresh.classes)) {
  if (c.missing) lines.push(`unresolved includes in ${k}: ${c.missing.join(', ')}`);
  if (c.unstableKey) lines.push(`one cache key, two shader texts: ${k}`);
  if (c.usedBeforeDeclared) lines.push(`used before declared in ${k}: ${c.usedBeforeDeclared.join(', ')}`);
  if (c.planMiss) lines.push(`sampler plan ${c.planMiss[0]} but the shader uses ${c.planMiss[1]}: ${k}`);
}
for (const l of lines.slice(0, LIMIT)) console.log('  ' + l);
if (lines.length > LIMIT) console.log(`  ... ${lines.length - LIMIT} more (GOLDEN_LINES=${lines.length})`);
console.log(`${lines.length ? 'FAILED' : 'shader golden OK'}: ${Object.keys(fresh.classes).length} classes (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(lines.length ? 1 : 0);
