// The baked shaders' text edits: exact-count replacement and transactional application (a three chunk changing must
// never leave half a patch installed), with the startup gate main.js checks after the warm compile.
const warned = new Set(), failures = [];
export const shaderPatchCount = () => failures.length;
export function assertShaderPatches(since) {
  if (failures.length > since) throw new Error('Baked shader patch failed: ' + failures.slice(since).map(f => f.name + ': ' + f.message).join('; '));
}
export function shaderReplace(src, from, to, name, count = 1) {
  const n = typeof from === 'string' ? src.split(from).length - 1 : [...src.matchAll(new RegExp(from.source, from.flags.includes('g') ? from.flags : from.flags + 'g'))].length;
  if (n !== count) throw new Error(`${name}: expected ${count} matches, got ${n}`);
  return typeof from === 'string' ? src.replaceAll(from, to) : src.replace(new RegExp(from.source, from.flags.includes('g') ? from.flags : from.flags + 'g'), to);
}
export function shaderPatch(sh, name, patch) {
  const next = { ...sh, uniforms: { ...sh.uniforms } };
  try { patch(next); Object.assign(sh, next); return true; }
  catch (err) { failures.push({ name, message: err.message }); if (!warned.has(name)) { warned.add(name); console.warn(`baked shader ${name}: left unpatched`, err.message); } return false; }
}
// Freeze before wrapping: three's default key reads this.onBeforeCompile, which would otherwise read the new hook.
export const shaderKey = m => m.customProgramCacheKey();
