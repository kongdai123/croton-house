// Equivalence of two baked shader texts under the rewrites the composed shader made (docs/architecture-lighting.md
// step 4), each of which preserves what the shader computes:
//   world     vProbeWorld / vWetWorld / vReflWorld / vContactWorld -> vBakedWorld: every one was assigned the same
//             expression (modelMatrix * batching * instancing * transformed) in the vertex stage; the repeated
//             assignment blocks collapse into one (assigning a varying the same value twice is idempotent).
//   probe     probeIrradiance( p, n ) == probeEval( probeFetch( p ), n ) and probeIrradiance( p, n, side ) ==
//             probeEval( probeFetch( probeSidePoint( p, n, side ) ), n ), foliageScale( p ) == foliageScale(
//             probeFetch( p ) ): the old functions' bodies are the new ones' operations in the same order (probe.glsl.js,
//             foliage.glsl.js); the old definitions and the new ones are set aside, every other definition must match.
//   fetch     `BakedProbe bakedProbe = E;` hoisted once per pixel: E reads only varyings and uniforms, so every use of
//             bakedProbe is replaced by E (the old shaders evaluated E at each use).
//   nW        inside a reflection block `{ vec3 nW = E, ... }` nW is E (both texts), so a lookup written with E where the
//             old one wrote nW compares equal.
//   order     declarations outside main() compared as a set (the old patches prepended at the top or before main, the
//             composer writes them in one block before main; none depends on its position among the others), main()
//             and every function body compared as text.
//   lightmap  (lightmap path, added with it) see the rewrites listed in lightmapRewrites below.
// equivalent(a, b) -> null when equal under these rewrites, else the first difference.
const ws = s => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\s*([(),;{}=*+\-/<>?:[\]])\s*/g, '$1').trim();

// the argument list of the call starting at `open` (the index of its '('): [args, end index after ')']
function args(s, open) {
  const out = []; let depth = 0, start = open + 1;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { out.push(s.slice(start, i).trim()); return [out, i + 1]; } }
    else if (c === ',' && depth === 1) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  throw new Error('unbalanced call');
}
function rewriteCalls(s, name, fn) {
  const re = new RegExp(`\\b${name}\\s*\\(`, 'g'); let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1, [a, end] = args(s, open), rep = fn(a);
    if (rep === null) continue;
    out += s.slice(last, m.index) + rep; last = end; re.lastIndex = end;
  }
  return out + s.slice(last);
}
// top-level items of the text outside main(): preprocessor lines, declarations, function / struct definitions; main()
// is the template's last function. Braces count in the first branch of a preprocessor conditional only (three's
// lights_physical_pars_fragment opens a function header in both branches of an #ifdef).
function split(src) {
  const at = src.indexOf('void main() {'), pre = at < 0 ? src : src.slice(0, at), main = at < 0 ? '' : src.slice(at);
  const items = [], branch = []; let depth = 0, start = 0;
  const lines = pre.split('\n'); let pos = 0;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#')) {
      if (/^#\s*if/.test(t)) branch.push(false); else if (/^#\s*(else|elif)/.test(t)) branch[branch.length - 1] = true; else if (/^#\s*endif/.test(t)) branch.pop();
      if (depth === 0) { items.push(t); start = pos + line.length + 1; }
    } else if (!branch.includes(true)) {
      for (let j = 0; j < line.length; j++) {
        const c = line[j], k = pos + j;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { const semi = pre[k + 1] === ';'; items.push(pre.slice(start, k + 1 + semi).trim()); start = k + 1 + semi; } }
        else if (c === ';' && depth === 0 && k >= start) { items.push(pre.slice(start, k + 1).trim()); start = k + 1; }
      }
    }
    pos += line.length + 1;
  }
  return { items: items.filter(Boolean), main };
}
const OLD_DEFS = [/^vec3 probeIrradiance\(/, /^float foliageScale\(vec3 p\)/];
const NEW_DEFS = [/^struct BakedProbe\{/, /^BakedProbe probeFetch\(/, /^vec3 probeEval\(/, /^vec3 probeSidePoint\(/, /^float foliageScale\(BakedProbe s\)/];

export function canonical(text, isNew) {
  let t = text.replace(/\/\/[^\n]*/g, '');
  if (!isNew) {
    t = t.replace(/\bv(Probe|Wet|Refl|Contact)World\b/g, 'vBakedWorld').replace(/\b(probe|wet|refl|contact)Position\b/g, 'bakedPosition');
    t = rewriteCalls(t, 'probeIrradiance', a => /^vec3 /.test(a[0]) ? null : a.length === 3 ? `probeEval( probeFetch( probeSidePoint( ${a[0]}, ${a[1]}, ${a[2]} ) ), ${a[1]} )` : `probeEval( probeFetch( ${a[0]} ), ${a[1]} )`);
    t = rewriteCalls(t, 'foliageScale', a => /^vec3 /.test(a[0]) ? null : `foliageScale( probeFetch( ${a[0]} ) )`);
  } else {
    const m = /BakedProbe bakedProbe = ([^;]*);/.exec(t);
    // E is a call (a primary expression): substituted without parentheses
    if (m) { t = t.replace(m[0], ''); t = t.replace(/\bbakedProbe\b/g, m[1]); }
  }
  // nW in a reflection block is its initialiser
  t = t.replace(/\{\s*vec3 nW = (inverseTransformDirection\( geometry(?:Clearcoat)?Normal, viewMatrix \)),([^}]*)\}/g, (all, e, body) => `{ vec3 nW = ${e},${body.replace(/\bnW\b/g, e)}}`);
  // the same value assigned to the same varying again: keep the first assignment block
  const block = /vec4 bakedPosition = vec4\( transformed, 1\.0 \);\s*#ifdef USE_BATCHING\s*bakedPosition = batchingMatrix \* bakedPosition;\s*#endif\s*#ifdef USE_INSTANCING\s*bakedPosition = instanceMatrix \* bakedPosition;\s*#endif\s*vBakedWorld = \( modelMatrix \* bakedPosition \)\.xyz;/g;
  let seen = false; t = t.replace(block, b => { if (seen) return ''; seen = true; return b; });
  const { items, main } = split(t);
  const defs = isNew ? NEW_DEFS : OLD_DEFS;
  return { items: new Set(items.map(ws).filter(s => !defs.some(d => d.test(s)))), main: ws(main) };
}

export function equivalent(a, b) {
  const x = canonical(a, false), y = canonical(b, true);
  for (const i of x.items) if (!y.items.has(i)) return `only in the old text: ${i.slice(0, 200)}`;
  for (const i of y.items) if (!x.items.has(i)) return `only in the new text: ${i.slice(0, 200)}`;
  if (x.main !== y.main) {
    let k = 0; while (k < x.main.length && x.main[k] === y.main[k]) k++;
    return `main() differs at ${k}:\n  old ${x.main.slice(Math.max(0, k - 120), k + 160)}\n  new ${y.main.slice(Math.max(0, k - 120), k + 160)}`;
  }
  return null;
}
