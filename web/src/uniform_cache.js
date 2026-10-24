// Uniform arrays are sent again at every material switch: three caches the values of single uniforms per program but not
// of arrays (the reflection probes' boxes, 26 x vec3 three times; the contact casters, 16 x vec4 twice; the lamp weights),
// and a garden view switches material ~400 times a frame. Each program's float-array uniforms here keep what they last
// sent and skip a repeat: a program holds a uniform's value until it is set again, so the draws see the same values.
// (main.js; ?ucache=0 turns it off.) update() once per frame wraps the programs linked since (only linked ones: asking a
// program still compiling for its uniforms would wait for the compile).
const BLOCK = { 0x1406: 1, 0x8b50: 2, 0x8b51: 3, 0x8b52: 4, 0x8b5a: 4, 0x8b5b: 9, 0x8b5c: 16 };   // float, vec2-4, mat2-4

function wrap(u) {
  if (u.seq) { for (const s of u.seq) wrap(s); return; }   // a struct (array): its members
  const block = BLOCK[u.type];
  if (!block || !(u.size > 0) || u.arrayCache) return;
  const set = u.setValue, n = u.size * block, last = new Float32Array(n), scratch = new Float32Array(n);
  let valid = false;
  u.arrayCache = true;
  u.setValue = function (gl, v, textures) {
    let data = v, m = n;
    if (typeof v[0] !== 'number') { for (let i = 0, o = 0; i < u.size; i++, o += block) v[i].toArray(scratch, o); data = scratch; }
    else m = Math.min(n, v.length);
    let same = valid && m === n;
    for (let i = 0; i < m; i++) { const x = Math.fround(data[i]); if (last[i] !== x) { same = false; last[i] = x; } }
    if (same) return;
    valid = m === n;
    set.call(this, gl, v, textures);
  };
}

export function createUniformArrayCache(renderer) {
  const done = new WeakSet(), stats = { programs: 0, uniforms: 0 };
  let seen = -1;
  const update = () => {
    const programs = renderer.info.programs;
    if (!programs || programs.length === seen && !stats.pending) return;
    seen = programs.length; stats.pending = 0;
    for (const p of programs) {
      if (done.has(p)) continue;
      if (p.isReady && !p.isReady()) { stats.pending++; continue; }
      const uniforms = p.getUniforms?.(); if (!uniforms) continue;
      done.add(p); stats.programs++;
      for (const u of uniforms.seq) { const before = u.arrayCache; wrap(u); if (!before && u.arrayCache) stats.uniforms++; }
    }
  };
  return { update, stats };
}
