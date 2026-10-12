// decor.js plus a few small extras composed here (keeps the modeler's file untouched).
import { THREE, M, box, plane, group, describe } from '../kit.js';
import { items as base } from './decor.js';
import * as proc from '../proc.js';
function redCanvas() {
  const g = group();
  const mat = new THREE.MeshStandardMaterial({ map: proc.redPainting(), roughness: 0.85 });
  const c = box(0.46, 0.46, 0.035, mat, { x: 0, y: 0.30 + 0.23, z: 0.02 }); c.rotation.x = -0.09; g.add(c);
  return describe(g, { id: 'decor-red-canvas', name: 'Red canvas', zh: '红色小画' });
}
export const items = { ...base, redCanvas };
