// Placements for props_living.js items. Same format as PLACEMENTS in layout.js (plan metres, +y north; ry 0 faces south).
// h = height of the surface the prop rests on (measured with tools/pick.mjs): coffee table 0.30, window-seat cushion 0.54,
// its corner shelf 1.292, west-tower cubbies 0.408 / 1.543, sofa arm 0.60, carved side table 0.56, dining table 0.75,
// niche bench cushion 0.451, office console 0.80, desk 0.75.
const N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
const P = (i, x, y, h, ry, extra) => ({ m: 'props_living', i, x, y, h, ry, ...extra });

export const STYLING = [
  // Living room: coffee table (g08/g10/g51), window seat (g08/g10/g11), alcove by the hall opening (g19/g51)
  P('vaseGypsophila', 2.44, -2.74, 0.30, 0),
  P('chessBox', 2.73, -3.05, 0.30, E),
  P('seatTray', 2.25, -4.05, 0.54, N),
  P('brassMiniatures', 3.40, -4.38, 1.292, N),
  P('vesselsPair', 0.97, -4.39, 0.397, W),
  // Hallway to the bedrooms
  P('printFramed', 4.086, -1.45, 0, E, { seed: 1 }),
  P('printFramed', 4.086, -0.75, 0, E, { seed: 2 }),
  P('runnerRug', 4.535, -0.30, 0, 0),
  // Dining (g20/g23/g24): centrepiece with the long walnut tray, fig by the closet wall, a large print above the chairs
  P('vaseHeather', 1.85, 4.22, 0.75, 0),
  P('boardWalnut', 1.87, 3.93, 0.75, 0),
  P('fiddleFig', 3.02, 2.08, 0, 0.6, { seed: 1 }),
  P('printFramed', 3.347, 2.85, 0, W, { seed: 3 }),
  P('throwFolded', 3.665, 4.75, 0.451, W),
  P('books', 3.68, 4.39, 0.451, W + 0.15, { seed: 2 }),
  // Office / family room (g20–g22): wave bowl on the console, open book and a small plant on the desk
  P('waveBowl', -1.88, 3.73, 0.80, E),
  P('openBook', -0.72, 2.12, 0.75, E + 0.25),
  P('pileaPot', -1.45, 1.95, 0.75, 0.3, { seed: 1 }),
  P('mug', -1.44, 2.23, 0.75, 0.5),
  P('basketSmall', -0.76, 2.08, 0, N),
  P('snakePlant', -1.93, 2.04, 0, 0.4, { seed: 1 }),
];
