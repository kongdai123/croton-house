// Small garden details observed in g05/g06, g37–g39, g43 and g47.
// All origins rest on the supporting surface; local +Z faces south.
import { THREE, box, cyl, lathe, tube, group, describe, setCollider, shadow } from '../kit.js';
import { speckle, weave } from '../proc.js';

const once = fn => { let v; return () => (v ??= fn()); };
const rng = seed => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const TAU = Math.PI * 2;
const L = {
  cobalt: once(() => { const t = speckle({ base: '#22385b', dots: '#4a5870' }); return new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.33, clearcoat: 0.3, clearcoatRoughness: 0.4, bumpMap: t, bumpScale: 0.0008 }); }),
  blackPot: once(() => new THREE.MeshStandardMaterial({ color: 0x272a29, roughness: 0.66 })),
  white: once(() => new THREE.MeshPhysicalMaterial({ color: 0xe8e5db, roughness: 0.47, clearcoat: 0.15 })),
  soil: once(() => new THREE.MeshStandardMaterial({ map: speckle({ base: '#30291e', dots: '#685c42' }), roughness: 1 })),
  leaf: once(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide })),
  stem: once(() => new THREE.MeshStandardMaterial({ color: 0x586443, roughness: 0.9 })),
  branch: once(() => new THREE.MeshStandardMaterial({ color: 0x89704b, roughness: 0.94 })),
  stone: once(() => { const t = speckle({ base: '#e2ddd0', dots: '#aeab9b' }); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 0.002, roughness: 0.98 }); }),
  rubber: once(() => new THREE.MeshStandardMaterial({ color: 0x252725, roughness: 0.95 })),
  mat: once(() => { const t = weave({ a: '#383c39', b: '#232725', scale: 0.5 }); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 0.0015, roughness: 0.98 }); }),
  brass: once(() => new THREE.MeshStandardMaterial({ color: 0x88744b, roughness: 0.48, metalness: 0.7 })),
};
function finish(root, id, name, zh, footprint) {
  describe(root, { id: `props-garden-${id}`, name, zh });
  if (footprint) setCollider(root, footprint);
  return root;
}

// Every planter has a foot, rounded lip, inner wall and recessed soil: no solid filled mouth.
function pot(radius, height, material, nursery = false) {
  const g = group(), r = radius, h = height;
  const profile = nursery
    ? [[0, 0], [.7*r, 0], [.75*r, .025*h], [.96*r, .9*h], [r, .92*h], [r, h], [.9*r, h], [.88*r, .93*h], [.85*r, .84*h], [0, .84*h]]
    : [[0, 0], [.68*r, 0], [.76*r, .018*h], [.9*r, .12*h], [.99*r, .38*h], [r, .82*h], [.97*r, .94*h], [r, .97*h], [r, h], [.91*r, h], [.88*r, .96*h], [.87*r, .86*h], [0, .86*h]];
  g.add(lathe(profile, material, { seg: 32 }));
  g.add(cyl(.87*r, .87*r, .01, L.soil(), { seg: 24, y: .89*h - .005 }));
  if (nursery) for (let i = 0; i < 18; i++) {
    const a = i / 18 * TAU;
    g.add(tube([[.77*r*Math.sin(a), .08*h, .77*r*Math.cos(a)], [.96*r*Math.sin(a), .88*h, .96*r*Math.cos(a)]], .0014, material, { seg: 1, radial: 4 }));
  }
  return g;
}

// Batched folded leaf ribbons. An actual pointed outline avoids rectangular leaf cards and alpha overdraw.
class Leaves {
  constructor() { this.p = []; this.c = []; this.indices = []; }
  add(points, width, hex, fold = .1) {
    const color = new THREE.Color(hex), n = points.length - 1, off = this.p.length / 3;
    for (let i = 0; i <= n; i++) {
      const u = i / n, w = width * Math.pow(Math.sin(Math.PI*u), .72) / 2;
      const a = points[Math.max(0, i-1)], b = points[Math.min(n, i+1)];
      const dx = b[0]-a[0], dz = b[2]-a[2], l = Math.hypot(dx,dz) || 1;
      for (const side of [-1, 0, 1]) {
        this.p.push(points[i][0] + side*w*dz/l, points[i][1] - Math.abs(side)*w*fold, points[i][2] - side*w*dx/l);
        const v = side === 0 ? 1.06 : side < 0 ? .88 : .98;
        this.c.push(color.r*v, color.g*v, color.b*v);
      }
      if (i < n) for (let j=0;j<2;j++) { const k=off+i*3+j; this.indices.push(k,k+3,k+1,k+1,k+3,k+4); }
    }
  }
  mesh() {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p,3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c,3)); g.setIndex(this.indices); g.computeVertexNormals();
    return shadow(new THREE.Mesh(g,L.leaf()));
  }
}
function fern(seed = 1) {
  const r = rng(seed*67+11), g = group(), leaves = new Leaves();
  for (let k=0;k<11;k++) {
    const a=k*2.4+r()*.3, len=.44+r()*.15, high=.25+r()*.16;
    const pts=Array.from({length:15},(_,i)=> {const t=i/14; return [Math.sin(a)*len*t, high*Math.sin(t*Math.PI*.72), Math.cos(a)*len*t];});
    g.add(tube(pts,.0016,L.stem(),{seg:14,radial:4}));
    for(let i=2;i<14;i++) for(const s of [-1,1]) {
      const p=pts[i], t=i/14, ll=(.09+Math.sin(Math.PI*t)*.055)*(1-t*.65), aa=a+s*1.15;
      leaves.add(Array.from({length:6},(_,j)=>{const u=j/5;return [p[0]+Math.sin(aa)*ll*u,p[1]+.014*Math.sin(u*Math.PI)-.02*u,p[2]+Math.cos(aa)*ll*u];}), .032*(1-t*.5), k%3 ? 0x385c28 : 0x53782e, .14);
    }
    leaves.add(pts.slice(12),.012,0x65843a);
  }
  g.add(leaves.mesh()); return g;
}
function mimosa(seed = 1, height = 1.32) {
  const r = rng(seed*79+4), g = group(), leaves = new Leaves();
  for(let k=0;k<6;k++) {
    const a=k*2.4, h=height*(.65+r()*.35), reach=.26+r()*.12;
    const start=[0,0,0], mid=[Math.sin(a)*reach*.55,h*.65,Math.cos(a)*reach*.55], end=[Math.sin(a)*reach,h,Math.cos(a)*reach];
    const branchCurve = new THREE.CatmullRomCurve3([start,mid,end].map(p=>new THREE.Vector3(...p)),false,'catmullrom',.2);
    g.add(tube([start,mid,end], .004, L.branch(), {seg:8,radial:5}));
    for(let j=0;j<7;j++) {
      const t=.32+j*.105, p=branchCurve.getPoint(t).toArray(), aa=a+j*1.8;
      const len=.27+r()*.17, e=[p[0]+Math.sin(aa)*len,p[1]+.035,p[2]+Math.cos(aa)*len];
      g.add(tube([p,e],.0014,L.stem(),{seg:1,radial:4}));
      for(let i=1;i<=9;i++)for(const side of [-1,1]) {
        const u=i/10, c=p.map((v,ix)=>v+(e[ix]-v)*u), ll=.062*(1-.35*u), ba=aa+side*1.12;
        leaves.add(Array.from({length:5},(_,j)=>{const v=j/4;return [c[0]+Math.sin(ba)*ll*v,c[1]+(.007+.022*r())*Math.sin(v*Math.PI)+side*.009*v,c[2]+Math.cos(ba)*ll*v];}), .026, k%2?0x527b37:0x385f2a);
      }
    }
  }
  g.add(leaves.mesh());
  if (height < .6) { g.scale.x = .28; g.scale.z = .28; }
  return g;
}
function rosette(seed, aloe = false) {
  const r=rng(seed*73+1), g=group(), leaves=new Leaves();
  for(let i=0;i<17;i++) {
    const a=i*2.4+r()*.16, outer=i<11, len=outer?.29+r()*.09:.22+r()*.09, spread=outer?.7:.3;
    const pts=Array.from({length:8},(_,j)=>{const t=j/7, d=len*spread*t*t;return [Math.sin(a)*d,len*(t-(aloe?.12:.45)*t*t),Math.cos(a)*d];});
    const color=aloe?(i%3?0x738669:0x93a389):i>10?0xb07b38:i%3?0x607e35:0x90a24c;
    leaves.add(pts,aloe?.06:.085,color,aloe?-.25:-.17);
  }
  g.add(leaves.mesh()); return g;
}
function potted(kind, seed=1) {
  const config={blueFern:[.2,.35,L.cobalt,fern],blueMimosa:[.22,.41,L.cobalt,mimosa],blackBromeliad:[.13,.235,L.blackPot,s=>rosette(s)],nurseryAloe:[.14,.26,L.blackPot,s=>rosette(s,true)],smallWhiteShrub:[.13,.245,L.white,s=>mimosa(s,.35)],blueGrass:[.155,.275,L.cobalt,null]}[kind];
  const [r,h,mat,build]=config, g=pot(r,h,mat(),kind==='nurseryAloe'||kind==='blackBromeliad');
  let plant;
  if(build) plant=build(seed);
  else {
    plant=group(); const leaves=new Leaves(), rand=rng(seed*43+3);
    for(let i=0;i<27;i++) { const a=i*2.4, len=.36+rand()*.24, reach=.15+rand()*.17;
      leaves.add(Array.from({length:8},(_,j)=>{const t=j/7;return [Math.sin(a)*reach*t*t,len*(t-.35*t*t),Math.cos(a)*reach*t*t];}),.01,i%4?0x6c8145:0x9c995b,.25);
    } plant.add(leaves.mesh());
  }
  plant.position.y=h*.89;g.add(plant);
  const names={blueFern:['Cobalt glazed planter with fern','蓝釉陶盆与蕨'],blueMimosa:['Cobalt glazed planter with compound-leaf shrub','蓝釉陶盆与羽叶灌木'],blackBromeliad:['Black nursery pot with bromeliad','黑色育苗盆与凤梨'],nurseryAloe:['Ribbed nursery pot with aloe','条纹育苗盆与芦荟'],smallWhiteShrub:['Small white glazed shrub planter','小白釉灌木盆'],blueGrass:['Small cobalt pot with arching grass','小蓝釉草盆']};
  return finish(g,kind,...names[kind],{w:r*2,d:r*2,h:kind==='blueMimosa'?h+1.32:h+.4});
}
const blueFern = seed => potted('blueFern',seed);
const blueMimosa = seed => potted('blueMimosa',seed);
const blackBromeliad = seed => potted('blackBromeliad',seed);
const nurseryAloe = seed => potted('nurseryAloe',seed);
const smallWhiteShrub = seed => potted('smallWhiteShrub',seed);
const blueGrass = seed => potted('blueGrass',seed);
// Foliage for the already-modelled white urns (surface = their recessed soil at 0.496 m).
function urnFern(seed=1) { return finish(fern(seed),'urnFern','Fern in existing white urn','现有白陶盆中的蕨'); }

function limestone(seed=1) {
  const r=rng(seed*47+9), g=new THREE.IcosahedronGeometry(1,1), p=g.attributes.position;
  const w=.22+r()*.13, h=.12+r()*.09, d=.18+r()*.12;let min=Infinity;
  for(let i=0;i<p.count;i++) {const x=p.getX(i), y=p.getY(i), z=p.getZ(i), k=1+.16*Math.sin(x*7+z*5+seed)+.09*Math.cos(y*9-x*4);
    const yy=Math.max(-.65,y)*h*.56*k; p.setXYZ(i,x*w*.5*k,yy,z*d*.5*k);min=Math.min(min,yy); }
  for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)-min);g.computeVertexNormals();
  return finish(group(shadow(new THREE.Mesh(g,L.stone()))),'limestone','Pale limestone garden accent','浅色石灰岩点景');
}
function doormat() {
  const g=group(box(.78,.009,.43,L.rubber(),{r:.005,y:.0045,seg:1}),box(.72,.003,.37,L.mat(),{y:.0105,r:.003,seg:1}));
  // Low embossed interlocking lozenges, like the black mat in g06.
  for(let x=-.3;x<=.3;x+=.1)for(let z=-.125;z<=.125;z+=.063) {
    const pts=[[x-.045,.014,z],[x,.014,z+.026],[x+.045,.014,z],[x,.014,z-.026]];
    g.add(tube(pts,.0018,L.rubber(),{seg:4,radial:4,closed:true}));
  }
  return finish(g,'doormat','Charcoal rubber entry mat (g06)','炭灰色入户脚垫');
}
function hoseCoil() {
  const g=group(), pts=[];
  for(let i=0;i<=150;i++) {const t=i/150,a=t*TAU*3.4,r=.22-.065*t;pts.push([Math.sin(a)*r,.011+.012*t,Math.cos(a)*r*.8]);}
  g.add(tube(pts,.0085,L.rubber(),{seg:150,radial:6}));
  const end=pts.at(-1);g.add(tube([end,[.17,.018,-.07],[.32,.012,-.14],[.38,.012,-.08]],.0085,L.rubber(),{seg:12,radial:6}));
  g.add(cyl(.014,.014,.04,L.brass(),{x:.38,y:.014,z:-.065,rx:Math.PI/2,seg:12}));
  const nozzle=group(box(.028,.07,.035,L.rubber(),{r:.004,y:.05}),cyl(.02,.016,.05,L.brass(),{y:.085,rx:Math.PI/2,seg:12}));
  nozzle.rotation.z=-Math.PI/2;nozzle.position.set(-.28,.025,.04);g.add(nozzle);
  return finish(g,'hoseCoil','Coiled dark garden hose and brass nozzle (g47)','卷起的花园水管与黄铜喷头');
}
function frontFern(seed = 1) { return fern(seed); }
export const items = { frontFern, blueFern, blueMimosa, blackBromeliad, nurseryAloe, smallWhiteShrub, blueGrass, urnFern, limestone, doormat, hoseCoil };
