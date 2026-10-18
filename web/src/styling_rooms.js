// Surface heights checked by downward scene raycasts and tools/pick.mjs. Plan metres, +y north.
// Existing beds already contain white shams and throws; nightstands already have rattan lamps.
const N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
const p = (i, x, y, h = 0, ry = 0, rest = {}) => ({ m: 'props_rooms', i, x, y, h, ry, ...rest });
export const STYLING = [
  // Primary: preserve the g27/g28 dried-grass vase and magazines built into shelfWalnut.
  p('shelfBooks', -5.16, 1.755, 0.82, N, { seed: 2 }),
  p('bowl', -5.13, 1.76, 1.10, N),
  p('eggLamp', -5.55, 2.95, 0.536, 0, { lamp: { plate: [-3.21, 1.834, N] } }), // g27/g52, recessed centre of carved table, not its raised rim
  // g29 pine cubbies: shelf boards are centred at 0.74/1.08, thickness 0.018.
  p('foldedLinen', -6.055, 1.32, 0.749, 0, { seed: 1 }),
  p('foldedLinen', -5.675, 1.32, 1.089, 0, { seed: 2 }),

  // Garden suite (g32/g33): quiet, asymmetrical bedside and console styling.
  p('books', 7.49, 4.39, 0.58, W, { seed: 1 }),
  p('books', 7.49, 2.08, 0.58, W, { seed: 4 }),
  p('waterSet', 7.48, 2.39, 0.58, W),
  p('linenLamp', 4.32, 4.91, 0.80, E),
  p('framedArt', 4.255, 4.47, 0.80, E, { seed: 0 }),
  p('plant', 4.35, 4.10, 0.80, E, { seed: 9 }),
  p('bowl', 4.41, 4.60, 0.80, E),
  p('basket', 4.86, 4.83, 0, 0.15, { seed: 1 }),
  p('accentPillow', 6.80, 3.18, 0.63, W, { seed: 1 }),
  p('floorPlant', 7.49, 5.11, 0, 0, { seed: 7 }),

  // Bedroom 3 (g35): keep the north-west door swing and the foot of the bed open.
  p('books', 7.49, -3.00, 0.58, W, { seed: 2 }),
  p('books', 7.49, -5.23, 0.58, W, { seed: 5 }),
  p('waterSet', 7.48, -2.70, 0.58, W),
  p('framedArt', 4.48, -5.565, 1.20, N, { seed: 1 }),
  p('plant', 4.84, -5.49, 1.20, N, { seed: 3 }),
  p('candle', 4.37, -5.34, 1.20),
  p('basket', 4.31, -4.78, 0, -0.25, { seed: 2 }),
  p('accentPillow', 6.86, -3.95, 0.54, W, { seed: 2 }),
  p('slippers', 5.68, -4.92, 0.015, 0.10), // on the existing checked rug

  // Primary bath (g30/g31): both sinks stay accessible; styling occupies the central bridge.
  p('towels', -7.48, 4.47, 0.90, E, { scale: 0.8 }),
  p('soapTray', -7.67, 4.47, 0.90),
  p('towelBar', -6.009, 4.005, 1.37, W),
  p('bathMat', -6.85, 4.45, 0, E),
  p('paperRoll', -7.903, 3.49, 0.68, E),
  p('robeHook', -6.70, 5.3565, 1.93), // north wall, outside the linen-closet door sweep

  // Bath B (g34): small side ledges and rear rim, never inside the trough basin.
  p('soapTray', 5.60, 0.62, 0.90, N),
  p('towels', 6.58, 0.61, 0.90, N, { scale: 0.85 }),
  p('plant', 6.38, 0.825, 0.90, N, { seed: 4, scale: 0.7 }),
  p('towelRing', 5.101, 1.20, 1.28, E),
  p('bathMat', 6.13, 1.30),

  // Hall bath (g36): folded towels, soap, wall towel and a low cotton mat.
  p('soapTray', 5.65, -0.12, 0.90),
  p('towels', 6.35, -0.12, 0.90),
  p('towelBar', 6.22, -1.274, 1.40, N),
  p('bathMat', 6.17, -0.72),
  p('paperRoll', 7.14, 0.1975, 0.68),

  // Second pass: twelve additions in each bedroom, three in each bath (45 total).
  // Wall coordinates = measured interior face + 3 mm toward the room.
  // Primary: art below the soffit, mirror over the carved table, and a visible cabinet vignette.
  p('wideArt', -2.2875, 3.55, 1.37, W, { seed: 0 }),
  p('wallArt', -5.34, 1.598, 1.78, N, { seed: 2, scale: .70 }),
  p('roundMirror', -5.8916, 3.04, 1.26, E),
  p('wovenHanging', -5.8916, 2.05, 1.39, E),
  p('floatingShelf', -3.42, 5.3537, 1.46, 0, { seed: 3 }),
  p('fiddleFig', -5.53, 4.04, 0, .2, { seed: 3 }),
  p('magazineStool', -5.49, 2.33, 0, .1, { seed: 5 }),
  p('linenLamp', -2.64, 2.38, .28, W),
  p('diffuser', -2.50, 4.82, .28, W),
  p('readingGlasses', -2.50, 4.40, .28, W, { seed: 5 }),
  p('openBook', -3.24, 3.00, .545, W, { seed: 1 }),
  p('cornerThrow', -3.96, 4.02, .57299, W, { seed: 1 }),

  // Garden suite: leave the east window, north slider and south bathroom door clear.
  p('wallArt', 7.9119, 4.67, 1.30, W, { seed: 1 }),
  p('wallArt', 4.58, 5.3537, 1.33, 0, { seed: 0 }),
  p('wovenHanging', 6.63, 1.9548, 1.26, N),
  p('floatingShelf', 7.04, 5.3537, 1.48, 0, { seed: 6 }),
  p('fiddleFig', 4.84, 4.05, 0, .3, { seed: 5 }),
  p('magazineStool', 6.99, 5.07, 0, -.1, { seed: 2 }),
  p('budVase', 7.75, 4.36, .58, W, { seed: 2 }),
  p('clockRadio', 4.44, 4.27, .80, E),
  p('candleTray', 7.648, 2.25, .112, W), // open slatted nightstand shelf, below the lamp
  p('diffuser', 7.76, 2.43, .58, W),
  p('openBook', 6.79, 3.59, .643, W),
  p('cornerThrow', 6.15, 3.92, .66184, W, { seed: 2 }),

  // Bedroom 3: everything on the west side stays behind x=4.9, leaving the foot approach open.
  p('wallArt', 4.61, -5.733, 1.66, N, { seed: 2 }),
  p('roundMirror', 7.9119, -2.83, 1.23, W),
  p('wovenHanging', 7.9119, -5.12, 1.35, W),
  p('floatingShelf', 4.0872, -3.83, 1.43, E, { seed: 4 }),
  p('pegTote', 4.0872, -3.12, 1.25, E),
  p('fiddleFig', 4.56, -4.23, 0, -.2, { seed: 9 }),
  p('pouf', 4.46, -3.42, 0),
  p('magazineStool', 7.20, -5.50, 0, .1, { seed: 4 }),
  p('budVase', 7.75, -5.22, .58, W, { seed: 4 }),
  p('clockRadio', 7.75, -2.68, .58, W),
  p('openBook', 7.04, -4.14, .54, W),
  p('cornerThrow', 6.09, -4.43, .58038, W, { seed: 3 }),

  // Bath props stay on solid wall panels, vanity ledges or the flat tank lids.
  p('wideArt', -7.900, 4.47, 1.96, E, { seed: 0, scale: .74 }),
  p('plant', -7.80, 2.97, .75, E, { seed: 11, scale: .75 }),
  p('diffuser', -7.45, 5.12, .90, E),
  p('wideArt', 6.10, .3152, 1.96, N, { seed: 1, scale: .70 }),
  p('towelBasket', 7.79, .62, .75, W),
  p('diffuser', 5.78, .80, .90, N),
  p('wideArt', 6.00, .1949, 1.96, 0, { seed: 2, scale: .70 }),
  p('plant', 7.80, -.04, .75, W, { seed: 12, scale: .72 }),
  p('diffuser', 6.25, -.015, .90, 0),
];
