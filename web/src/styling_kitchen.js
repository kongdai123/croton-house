// g12–g18; plan metres, +y north, ry 0 faces south. Stone tops measured with tools/pick.mjs: h 0.92.
const N = Math.PI, E = Math.PI / 2;
const P = (i, x, y, ry = 0) => ({ m: 'props_kitchen', i, x, y, h: 0.92, ry });

export const STYLING = [
  P('flowerPitcher', -2.86, -4.18, N),
  P('whiteCrock', -3.03, -4.18, N),
  P('spiceCarousel', -3.20, -4.04, 0.12),
  P('oatsCanister', -3.23, -3.74, E),
  P('seedsCanister', -3.13, -3.56, E),
  P('oilBottle', -3.24, -3.43, E + 0.15),
  P('oilBottle', -3.24, -3.335, E - 0.1),
  P('oilBottle', -3.24, -3.24, E + 0.06),
  P('woodTray', -3.19, -1.99, E),
];
