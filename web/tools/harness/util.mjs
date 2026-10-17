// Shared helpers for the golden capture and its tests: stable number rounding, one-entry-per-line JSON, readable diffs.
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const r3 = v => { const x = Math.round(v * 1000) / 1000; return x === 0 ? 0 : x; };    // millimetres, no -0
export const r4 = v => { const x = Math.round(v * 10000) / 10000; return x === 0 ? 0 : x; };
export const hash8 = s => createHash('sha1').update(s).digest('hex').slice(0, 8);

// Sorted-key JSON so the files do not depend on property insertion order.
export function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]));
  return v;
}
// Top-level tables (objects whose values are all objects) get one entry per line, so a git diff of a golden shows
// exactly the entries that changed; everything else is compact JSON.
export function format(doc) {
  const out = ['{'];
  const keys = Object.keys(doc);
  keys.forEach((k, i) => {
    const v = doc[k], comma = i < keys.length - 1 ? ',' : '';
    const table = v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).length > 3 && Object.values(v).every(x => x && typeof x === 'object');
    if (table) {
      out.push(` ${JSON.stringify(k)}: {`);
      const ek = Object.keys(v);
      ek.forEach((e, j) => out.push(`  ${JSON.stringify(e)}: ${JSON.stringify(canon(v[e]))}${j < ek.length - 1 ? ',' : ''}`));
      out.push(` }${comma}`);
    } else out.push(` ${JSON.stringify(k)}: ${JSON.stringify(canon(v))}${comma}`);
  });
  out.push('}');
  return out.join('\n') + '\n';
}
export function writeGolden(path, doc, { gzip = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const text = format(doc);
  if (gzip) writeFileSync(path + '.gz', gzipSync(text, { level: 9 }));
  else writeFileSync(path, text);
  return Buffer.byteLength(text);
}
export function readGolden(path) {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  if (existsSync(path + '.gz')) return JSON.parse(gunzipSync(readFileSync(path + '.gz')).toString('utf8'));
  return null;
}

// Diff two parsed documents. Tables (object of objects) report added / removed / changed keys with the fields that
// differ; everything else is compared whole. Returns lines (all of them, the caller truncates).
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const short = v => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 120 ? s.slice(0, 117) + '...' : s; };
export function diffDocs(a, b) {
  const lines = [];
  for (const section of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[section], y = b[section];
    if (same(x, y)) continue;
    const table = v => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).length > 3 && Object.values(v).every(e => e && typeof e === 'object');
    if (table(x) && table(y)) {
      for (const k of Object.keys(x)) if (!(k in y)) lines.push(`${section}: removed ${k}  ${short(x[k])}`);
      for (const k of Object.keys(y)) if (!(k in x)) lines.push(`${section}: added   ${k}  ${short(y[k])}`);
      for (const k of Object.keys(x)) if (k in y && !same(x[k], y[k])) {
        const fields = new Set([...Object.keys(x[k]), ...Object.keys(y[k])]);
        const ch = [...fields].filter(f => !same(x[k][f], y[k][f])).map(f => `${f}: ${short(x[k][f])} -> ${short(y[k][f])}`);
        lines.push(`${section}: changed ${k}  ${ch.join('; ')}`);
      }
    } else lines.push(`${section}: ${short(x)} -> ${short(y)}`);
  }
  return lines;
}

// Import a browser module of web/src under node: bundled by esbuild (src/*.js are ES modules in a CommonJS package and
// may import JSON), loaded from a data: URL.
const WEB = fileURLToPath(new URL('../../', import.meta.url));
export async function importSrc(rel) {
  const r = await build({ entryPoints: [join(WEB, rel)], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
