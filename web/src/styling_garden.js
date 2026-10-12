// Listing details, g05/g06 (porch), g37–g39/g43 (potted border), g47 (hose).
// Surface heights checked against the scene. Central walk and glass-door approaches stay clear.
const p = (i, x, y, h, seed=1, ry=0) => ({m:'props_garden',i,x,y,h,seed,ry});
export const STYLING = [
  // Front porch: doormat, the two small white pots against the wall, cobalt specimen pot.
  p('doormat',0,-5.31,.02),
  p('smallWhiteShrub',3.19,-5.18,.02,2),
  p('smallWhiteShrub',3.53,-5.2,.02,4),
  p('blueMimosa',2.64,-5.57,.02,3),
  p('frontFern',-4.3,-8.0,-.008,5),
  p('frontFern',-4.3,-8.65,-.008,7),
  p('frontFern',-4.3,-10.25,-.008,9),
  p('frontFern',-1.8,-7.85,.22,3),
  p('frontFern',1.35,-7.85,.22,4),
  p('frontFern',3.4,-8.0,.22,6),
  // Front garden and garage court: understated blue and black container details.
  p('nurseryAloe',-9.12,-6.78,.012,6),
  // West service garden: on the bed side of the shell path, clear of the condensers.
  p('blueGrass',-9.5,2.95,-.024,11),
  // Left courtyard, outside the main patio and the route round to the fire pit.
  p('blueFern',-3.04,6.18,0,2),
  p('blackBromeliad',-3.8,6.21,0,12),
  p('blueGrass',-2.92,8.08,0,5),
  // Right courtyard: blue fern and a small black bromeliad in front of the white box.
  p('blueFern',7.44,6.22,0,8),
  p('blackBromeliad',6.38,5.82,.012,9),
  p('blueGrass',5.72,7.78,0,10),
  // Patio edge cluster visible in g37, with space left down the middle of the terrace.
  p('blueFern',3.77,8.59,.012,4),
  p('nurseryAloe',3.85,9.13,.012,14),
  // Back seating border, inside the shell edging and away from the stools.
  p('blueGrass',4.82,13.28,-.006,16),
  p('hoseCoil',7.68,7.15,0,1,-.3),
  // Pale limestone accents from g05/g06/g37/g47, all smaller than 0.3 m high.
  p('limestone',1.38,-6.23,-.008,1),
  p('limestone',1.48,-7.82,-.008,2),
  p('limestone',-1.45,-6.34,-.008,3),
  p('limestone',-2.66,-6.04,-.008,4),
  p('limestone',4.45,-8.9,-.008,5),
  p('limestone',-2.17,7.87,.012,6),
  p('limestone',-2.17,8.88,.012,7),
  p('limestone',3.94,7.25,.012,8),
  p('limestone',4.82,12.7,-.006,9),
  p('limestone',-1.45,13.72,-.006,10),
  p('limestone',7.91,7.8,0,11),
  p('limestone',-9.52,5.52,-.024,12),
];
