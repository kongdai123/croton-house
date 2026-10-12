// Flower drifts: plan metres, +y north. This is evaluated once, with no Math.random.
// Occupied centres below are PLACEMENTS + generatePlanting(7), captured 2026-10-12.
// Keep this snapshot in sync if the lead changes the foliage scatter; importing
// layout.js here would create a circular dependency during its initialization.
import { LOUNGE, SIDE_PATHS, ISLAND_BEDS, PATIO, COURT_A, COURT_B, COURT_PAD,
  PORCH, WALK, DRIVE, PAD, AC_UNITS, pointInPoly } from './house.js';
import { STYLING as GARDEN_PROPS } from './styling_garden.js';

const FOLIAGE = [
  [3.6,-4.25], [-2.6,5.05], [-2.3,-7.6], [-3.6,-8.6], [5.6,-7.6], [7.6,-9.8], [-9.8,-7.9], [-1.5,-8.2], [1.6,-8.4], [2.4,-7.4], [-2.9,-10.5], [1.3,-10.5],
  [-1.6,-11.6], [5,-11], [-3.2,-12.5], [9,-6], [4.2,-6.3], [-9.2,-3], [6.8,-6], [-2,-13], [10.5,-8], [2.6,-11.2], [-2,-9.4], [11.5,-11.5],
  [-12,-12], [-5.2,6.3], [-4.4,6.3], [6,6.3], [6.6,6.3], [-4.3,8.05], [8.9,9.3], [-5.8,8], [2.4,10.6], [0.2,10.9], [-1.6,10.8], [4.6,10.5],
  [3,14.5], [-6.5,12], [11.5,10], [1,11.6], [5.6,11.4], [-3.6,11.6], [6.6,9.6], [-8.5,10], [-10,14], [12,15.5], [0,17.6], [-6,17.4],
  [-9.5,16.5], [5.5,16.8], [12.5,12.5], [12.5,20.5], [-12.5,25], [-9,27], [20,24], [-24,-4], [26,8], [0.4,9.6], [3.6,9.7], [-2.6,10.2],
  [6.3,11.6], [-1.2,9.7], [5.4,9.9], [6.6,13.6], [-3.2,13.4], [6.4,10.6], [7.2,14.8], [-3.8,12.6], [-5.2,15.5], [2.2,16.2], [9,12.2], [10.6,16],
  [-8,12.5], [2,9.5], [4.8,9.6], [-0.6,15], [7.6,12.8], [-4.8,10.9], [8.6,10.4], [11.5,13.2], [-7.6,15.2], [4.5,17.4], [-3,17.2], [12.8,17.5],
  [-1.6,12.9], [8,15.9], [-6.8,10.6], [8.5,17.3], [-0.5,17.9], [11,9], [-4,16.8], [6,15.9], [-9,6.2], [-7.31,17.8], [9.96,10.43], [7.83,11.19],
  [13.49,7.25], [-11.63,13.69], [10.48,13.96], [-12.54,9.54], [0.26,15.7], [-8.25,17.23], [-12.41,15.58], [-13.18,17.4], [11.88,16.74], [-8.71,13], [11.54,6.75], [-3.55,14.14],
  [-8.26,18.34], [-13.79,18.81], [-10.15,10.04], [-13.52,12.48], [8.68,14.85], [9.16,13.15], [13.29,5.63], [10.45,11.14], [7.36,11.81], [-5.32,11.57], [9.46,18.62], [12.19,7.95],
  [3.55,15.3], [9.35,5.87], [-8.42,11.51], [13.89,8.72], [-8.76,14.55], [-13.25,15.46], [-10.56,8.27], [-5.1,14.64], [-11.56,7.63], [13.84,10.24], [-12.92,7.4], [-11.94,17.7],
  [-7.04,13.18], [11.17,13.99], [11.48,11.77], [-10.84,9.22], [-6.26,18.57], [-8.24,16.06], [-6.96,16.56], [-8.4,13.83], [-12.4,11.06], [12.6,18.94], [5.9,18.86], [-3.45,18.55],
  [-3.25,15.34], [-9.43,18.72], [-6.72,14.4], [-12.96,14.01], [-9.6,12.19], [6.73,17.52], [10.96,18.34], [-12.16,6.09], [-6.5,15.98], [-7.65,8.1], [10.48,11.91], [2.57,18.36],
  [13.76,13.98], [1.2,18.06], [0.99,16.69], [-5.19,18.45], [-1.93,18.59], [12.2,9], [-13.47,10.11], [-12.36,18.54], [11.55,17.26], [7.32,10.04], [10.07,15.03], [10.05,17.37],
  [11.12,11.32], [-2.1,14.91], [-4.37,11.7], [-7.56,16.51], [8.17,13.8], [5.64,13.76], [13.82,13.03], [12.8,8.51], [13.08,15.92], [12.06,14.16], [9.91,16.69], [-11.03,11.81],
  [-11.05,15.43], [13.74,17.71], [-7.02,17.16], [-7.58,6.16], [-2.03,17.64], [-0.84,16.52], [-1.82,15.71], [12.68,10.94], [-4.56,13.38], [-11,16.34], [-11.87,1.06], [-12.33,3.05],
  [-13.78,4.51], [-12.84,1.26], [-11.51,4.81], [-13.87,0.51], [-9.62,3.91], [-9.72,1.5], [13.69,1.82], [9,2.28], [11.45,2.79], [12.98,3.13], [13.69,-0.6], [12.52,0.18],
  [8.95,3.17], [9.72,0.52], [8.99,4.74], [-1.11,-9.82], [-1.67,-10.03], [-2.32,-10.93], [-1.08,-7.81], [-3.22,-11.17], [-3.28,-6.91], [-3.04,-9.61], [4.15,-7.31], [4.45,-8.51],
  [6.9,-7.06], [4.89,-9.43], [2.46,-8.26], [7.59,-7.48], [3.69,-9.66], [2.8,-9.9], [7.52,-6.78], [7.17,-8.21], [3.45,-8.12], [1.59,-6.76], [5.58,-8.89], [2.87,-6.7],
  [3.36,-10.88], [6.21,-6.71], [-10.28,-12], [-10.89,-9.72], [-12.35,-10.63], [-9.47,-10.31], [-11.01,-10.73], [9.62,-7.33], [10.76,-6.84], [9.98,-6.04], [-6,23], [3,24.5],
  [11,23], [18,14], [-18,12], [-19,26], [17,-6], [-17,-9], [8,-17], [-6,-18], [-15.5,20], [15.8,21], [14,-13], [-13.5,-14.5],
  [16,6]
];
const FURNITURE = [[-2.1,-6.6,0.65],[2.55,-6.5,0.65],[3.4,-9.6,1.4],[-9.5,-6.8,0.65],[0.4,7.6,0.65],[1.6,7.9,0.65],[1.6,12.3,0.65],[0.3,11.6,0.65],[0.5,13.3,0.65],[2.7,11.2,0.65],[2.9,13.5,0.65],[4.1,12.4,0.65],[3.6,10.9,0.65],[4.4,14,0.65],[1,9.95,0.65]];
const HOUSE = {x0:-8.36,x1:8.36,y0:-6.16,y1:5.8};
const STEP = {x0:PORCH.x0+.2,x1:PORCH.x1-.2,y0:PORCH.y0-.42,y1:PORCH.y0};
const PAVED = [HOUSE, STEP, PORCH, WALK, DRIVE, PAD, PATIO, COURT_PAD, AC_UNITS];
const SHELL = [LOUNGE,...SIDE_PATHS];
const rect = r => [[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]];
const BEDS = [
  [[-14,5.62],[14,5.62],[14,18.95],[-14,18.95]],
  [[-14,.4],[-8.3,.4],[-8.3,5.62],[-14,5.62]],
  [[8.35,-.78],[14,-.78],[14,5.62],[8.35,5.62]],
  [[-3.5,-11.25],[-1,-11.3],[-.85,-6.35],[-3.5,-6.35]],
  [[.85,-11.1],[3.2,-11.05],[8.2,-9.35],[8.2,-6.3],[.85,-6.35]],
  ...ISLAND_BEDS,
];
const lcg = seed => {let s=seed>>>0;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296);};
function edgeDistance(x,y,poly) {
  let d=Infinity;
  for(let j=poly.length-1,i=0;i<poly.length;j=i++) {
    const [ax,ay]=poly[j],dx=poly[i][0]-ax,dy=poly[i][1]-ay;
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
    d=Math.min(d,Math.hypot(x-ax-t*dx,y-ay-t*dy));
  }
  return d;
}
const RADII = {birdOfParadise:.34,heliconia:.34,hibiscusCoral:.32,hibiscusRed:.32,
  hibiscusYellow:.32,firebush:.30,firespike:.27,bougainvillea:.23,
  ixora:.25,plumbago:.27,pentasRed:.22,pentasPink:.22,lantana:.23,
  guzmaniaRed:.22,guzmaniaOrange:.22,potBromeliad:.17,potPentas:.23};
const occupied = FOLIAGE.map(([x,y])=>({x,y,r:.5})).concat(
  FURNITURE.map(([x,y,r])=>({x,y,r})),
  GARDEN_PROPS.filter(p=>p.i!=='doormat').map(p=>({x:p.x,y:p.y,r:p.i==='limestone'?.27:.55})),
  // Existing white planter boxes and their end walls, not just the foliage centres.
  [{x:-4.8,y:6.3,r:.68},{x:6.3,y:6.3,r:.68}]);
export const STYLING = [];
function clear(x,y,r,courtyard=false) {
  if(x < -13.75+r || x > 13.75-r || y > 18.75-r) return false;
  if(PAVED.some(b=>x>b.x0-r&&x<b.x1+r&&y>b.y0-r&&y<b.y1+r)) return false;
  if(SHELL.some(p=>pointInPoly([x,y],p)||edgeDistance(x,y,p)<r*.8)) return false;
  if(courtyard) {
    // The planting perimeter is an intentional exception to the courtyard's
    // pebble clearance. Door -> east patio route remains 0.9 m wide or more.
    if(pointInPoly([x,y],rect(COURT_A))) {
      if(x-r<COURT_A.x0+.19||y+r>COURT_A.y1-.19) return false;
      if(x>-5.55&&x<-3.65&&y<7.35) return false;
      if(x>-3.7&&y<7.1) return false;
    }
    if(pointInPoly([x,y],rect(COURT_B))&&x+r>COURT_B.x1-.19) return false;
  } else if([COURT_A,COURT_B].some(b=>x>b.x0-r&&x<b.x1+r&&y>b.y0-r&&y<b.y1+r)) return false;
  if(occupied.some(q=>Math.hypot(x-q.x,y-q.y)<q.r)) return false;
  if(STYLING.some(p=>Math.hypot(x-p.x,y-p.y)<Math.max(.48,(RADII[p.i]*(p.scale||1)+r)*.9))) return false;
  return true;
}
function place(i,x,y,zone,seed,scale=1) {
  const h=zone==='front'?-.008:zone==='island'?-.02:zone.startsWith('court')?0:-.024;
  STYLING.push({m:'flowers',i,x:+x.toFixed(3),y:+y.toFixed(3),h,seed,scale,
    ry:lcg(seed*811+7)()*Math.PI*2,zone});
}
// First place the deliberately composed courtyard perimeter. The tall orange
// flower stalks sit behind the path, not in front of the bedroom glass door.
const COURTYARD = [
  ['guzmaniaOrange',-5.685,6.06],['guzmaniaRed',-5.70,6.64],
  ['pentasPink',-5.62,7.28,.60],['birdOfParadise',-5.12,7.49],
  ['birdOfParadise',-4.55,7.50],['guzmaniaOrange',-3.93,7.51],
  ['potBromeliad',-3.48,8.00],['potPentas',-5.10,8.00,.68],
  ['guzmaniaRed',6.86,7.20],['birdOfParadise',6.35,7.77],
  ['guzmaniaOrange',7.89,6.56,.55],['pentasRed',7.84,7.34],
  ['pentasPink',4.75,7.85],['guzmaniaOrange',5.20,7.54],
  ['hibiscusYellow',6.95,8.03,.85],
];
// Compact border specimens keep the actual leaf tips inside the low walls.
COURTYARD.forEach(([i,x,y,scale=.9],k)=>{
  if(clear(x,y,RADII[i]*scale,true))place(i,x,y,x<0?'courtA':'courtB',400+k,scale);
});
// Species, drift centre, number, search radius, zone. Each search grows a loose
// group of 3–7 plants; rejected centres never spill onto shell/paving or turf.
const DRIFTS = [
  ['pentasRed',-1.27,-10.0,5,1.2,'front'],['guzmaniaOrange',-2.6,-8.6,4,1.3,'front'],
  ['ixora',-2.3,-6.8,4,1.0,'front'],['pentasPink',1.3,-10.0,5,1.2,'front'],
  ['lantana',3.8,-9.7,5,1.3,'front'],['ixora',2.8,-7.0,5,1.4,'front'],
  ['hibiscusCoral',6.7,-7.4,3,1.1,'front'],['guzmaniaRed',5.0,-8.8,4,1.3,'front'],
  ['plumbago',7.0,-8.7,4,1.0,'front'],
  ['lantana',-10.8,-10.2,5,1.5,'island'],['pentasPink',-11.5,-11.3,4,1.0,'island'],
  ['ixora',10.4,-6.7,4,1.1,'island'],['lantana',11.5,-11.5,3,.8,'island'],
  ['birdOfParadise',-3.8,9.0,3,1.0,'back'],['pentasRed',-6.1,7.0,5,1.8,'back'],
  ['plumbago',-7.5,7.4,5,1.5,'back'],['heliconia',-8.5,11.2,3,1.3,'back'],
  ['pentasPink',-5.0,12.0,5,1.4,'back'],['ixora',-4.6,14.3,5,1.4,'back'],
  ['hibiscusYellow',-6.9,13.7,3,1.4,'back'],['guzmaniaOrange',-6.4,10.8,5,1.6,'back'],
  ['plumbago',-1.4,16.3,5,1.2,'back'],['pentasRed',1.5,15.8,5,1.2,'back'],
  ['lantana',3.8,15.4,5,1.1,'back'],['firebush',5.2,16.8,4,1.5,'back'],
  ['birdOfParadise',5.9,9.0,3,1.0,'back'],['guzmaniaRed',6.4,12.6,5,1.5,'back'],
  ['pentasPink',7.4,11.2,5,1.7,'back'],['hibiscusRed',8.0,13.1,3,1.4,'back'],
  ['plumbago',8.3,8.8,5,1.4,'back'],['lantana',9.0,14.7,5,1.3,'back'],
  ['firespike',11.7,17.5,4,1.3,'back'],['firebush',-11.4,17.8,4,1.2,'back'],
  ['pentasPink',11.7,11.0,5,1.3,'back'],['ixora',-11.8,11.3,5,1.3,'back'],
  ['hibiscusCoral',-12.6,6.5,3,1.2,'back'],['heliconia',12.5,8.5,3,1.2,'back'],
  ['ixora',-12.8,2.2,5,1.1,'side'],['plumbago',-9.0,4.2,5,1.0,'side'],
  ['firespike',-12.7,4.7,3,1.1,'side'],['guzmaniaOrange',-9.3,3.1,4,.9,'side'],
  ['firebush',12.5,1.0,4,1.2,'side'],['plumbago',9.0,3.7,4,1.0,'side'],
  ['pentasRed',12.3,4.0,5,1.2,'side'],['hibiscusYellow',9.0,.6,3,.9,'side'],
];
const rnd=lcg(2513);
DRIFTS.forEach(([i,cx,cy,n,spread,zone],drift)=>{
  let made=0;
  for(let t=0;t<700&&made<n;t++) {
    const a=rnd()*Math.PI*2,rad=Math.sqrt(rnd())*spread;
    const x=cx+Math.sin(a)*rad,y=cy+Math.cos(a)*rad,scale=.85+rnd()*.24;
    const allowed=zone==='front'?BEDS.slice(3,5):zone==='island'?ISLAND_BEDS:zone==='side'?BEDS.slice(1,3):BEDS.slice(0,1);
    if(!allowed.some(p=>pointInPoly([x,y],p))||!clear(x,y,RADII[i]*scale))continue;
    place(i,x,y,zone,500+drift*13+made,scale);made++;
  }
});
// The climbers are held close to the perimeter fence, their canes face the fence.
for(const [x,y,ry] of [[-12.7,18.40,Math.PI],[10.0,18.40,Math.PI],[13.40,6.8,Math.PI/2]]) {
  if(clear(x,y,.23)) {place('bougainvillea',x,y,'back',1100+STYLING.length,.95);STYLING.at(-1).ry=ry;}
}
