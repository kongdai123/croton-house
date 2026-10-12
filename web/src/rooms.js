// Named plan zones (metres, +y north) for labels: which room a point is in, and where a door leads.
// Interior rects are matched in order (small rooms before the ones that enclose them); anything else is outdoors.
const IN = [
  [-7.9, -6.36, 0.16, 1.48, 'Laundry', '洗衣间'],
  [-6.36, -4.82, 0.16, 1.6, 'Walk-in closet', '衣帽间'],
  [-4.82, -3.51, 0.16, 0.77, 'Closet', '壁橱'],
  [-7.9, -3.51, -5.74, 0.16, 'Garage', '车库'],
  [-6.6, -6.0, 1.6, 2.31, 'Linen closet', '储物间'],
  [-7.9, -6.0, 1.6, 5.36, 'Primary bath', '主卫'],
  [-5.9, -2.28, 1.6, 5.36, 'Primary bedroom', '主卧'],
  [-4.82, -3.5, 0.77, 1.6, 'Primary bedroom', '主卧'],
  [5.1, 7.92, 0.31, 1.84, 'Bedroom bath', '次卧卫生间'],
  [4.08, 7.92, 1.57, 5.36, 'Garden bedroom', '花园次卧'],
  [5.1, 7.92, -1.27, 0.2, 'Hall bath', '走廊卫生间'],
  [5.1, 7.92, -2.03, -1.39, 'Closet', '壁橱'],
  [3.46, 3.97, 1.82, 3.77, 'Closet', '壁橱'],
  [4.08, 7.92, -5.74, -2.14, 'Front bedroom', '前侧次卧'],
  [3.97, 5.1, -2.14, 1.57, 'Hallway', '走廊'],
  [0.42, 3.97, 1.82, 5.36, 'Dining room', '餐厅'],
  [-2.17, 0.42, 1.82, 5.36, 'Office', '书房'],
  [-3.4, -0.8, -4.61, 1.82, 'Kitchen', '厨房'],
  [-0.8, 3.97, -4.61, 1.82, 'Living room', '客厅'],
];
function outdoor(x, y) {
  if (y < -4.6) return x > -3.51 && x < 4.08 && y > -5.9 ? ['Porch', '门廊', true] : ['Front yard', '前院', true];
  if (y > 5.36) return x < 0.42 ? ['West courtyard', '西侧庭院', true] : x < 4.08 ? ['Patio', '露台', true] : ['Backyard', '后院', true];
  if (x > 7.9) return ['East garden', '东侧花园', true];
  return ['Side yard', '侧院', true];
}
export function roomAt(x, y) {
  for (const [x0, x1, y0, y1, en, zh] of IN) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { en, zh, outside: false };
  const [en, zh, outside] = outdoor(x, y); return { en, zh, outside };
}
// Name of a door as seen from plan point (px, py): the room on the far side ("Door to Front bedroom"),
// or "Front door" when the front door leads outside.
export function doorName(d, px, py, lang) {
  const { cx, cy, isH } = d.plan, side = isH ? Math.sign(py - cy) || 1 : Math.sign(px - cx) || 1;
  const r = roomAt(cx - (isH ? 0 : side * 0.45), cy - (isH ? side * 0.45 : 0));
  if (d.kind === 'front' && r.outside) return lang === 'zh' ? '入户门' : 'Front door';
  return lang === 'zh' ? `通往${r.zh}的门` : `Door to the ${r.en.toLowerCase()}`;
}
