// Furniture placement (plan coordinates, metres; +y north) and scene lights from the furniture modules.
// ry: rotation about +Y; a module's front is local +Z. ry=0 faces south, π faces north, π/2 faces east, -π/2 faces west.
import { THREE } from './kit.js';
import { MODULES } from './furniture/index.js';
import { addAABB } from './house.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
const d2r = (d) => THREE.MathUtils.degToRad(d);

// ---- The placement table. {m: module, i: item, x, y (plan), h (height offset), ry, n (name override), light: false to skip its light}
export const PLACEMENTS = [
  // Living room (x -0.8..3.97, y -4.6..1.7): window seat on the front wall, sofa facing it, rug and round table between
  { m: 'living', i: 'windowSeat', x: 2.17, y: -4.29, ry: N, zh: '手工窗台座', n: 'Hand-built window seat' },
  { m: 'living', i: 'rug', x: 2.55, y: -1.45, ry: E },
  { m: 'living', i: 'sofa', x: 3.47, y: -0.95, ry: W, zh: '皮沙发', n: 'Leather sofa' },
  { m: 'living', i: 'coffeeTable', x: 2.35, y: -1.5, ry: 0, zh: '圆茶几', n: 'Round coffee table' },
  { m: 'living', i: 'sideBench', x: 3.75, y: -2.9, ry: W, zh: '小木凳 · 红画', n: 'Wood bench & red canvas' },
  { m: 'decor', i: 'redCanvas', x: 3.93, y: -2.9, h: 0.0, ry: W },
  { m: 'living', i: 'throwPillows', x: 1.4, y: -4.25, h: 0.54, ry: N },
  { m: 'decor', i: 'cellularShade', x: 2.17, y: -4.58, ry: N },
  { m: 'decor', i: 'cellularShadeNarrow', x: -1.855, y: -4.58, ry: N },
  { m: 'decor', i: 'trackLight', x: 2.1, y: -2.0, ry: 0 },
  { m: 'decor', i: 'trackLight', x: 0.2, y: -0.2, ry: E, light: false },
  { m: 'decor', i: 'thermostat', x: 3.96, y: -0.3, ry: W },
  { m: 'decor', i: 'bookStack', x: 2.4, y: -1.6, h: 0.36, ry: 0.4 },
  { m: 'decor', i: 'bowlWood', x: 2.1, y: -1.35, h: 0.36 },
  { m: 'plants', i: 'pampasVase', x: 3.6, y: -4.25, ry: 0 },
  // Kitchen (x -3.45..-0.79): fridge beside the front door, sink under the window, range west of it, tall oven column on the side wall
  { m: 'kitchen', i: 'fridge', x: -1.03, y: -4.21, ry: N, zh: '黑色冰箱', n: 'Fridge' },
  { m: 'kitchen', i: 'southRunB', x: -2.45, y: -4.29, ry: N, sx: -1, zh: '厨房操作台', n: 'Kitchen counter' },
  { m: 'kitchen', i: 'westRunB', x: -3.14, y: -2.72, ry: E, zh: '炉灶 · 烤箱柜 · 微波炉上的黑板', n: 'Range, oven column & chalkboard' },
  { m: 'kitchen', i: 'island', x: -1.33, y: -1.4, ry: E, zh: '中岛', n: 'Island' },
  { m: 'kitchen', i: 'stool', x: -0.45, y: -2.55, ry: W, zh: '吧台凳', n: 'Counter stool' },
  { m: 'kitchen', i: 'stool', x: -0.45, y: -1.78, ry: W, zh: '吧台凳', n: 'Counter stool' },
  { m: 'kitchen', i: 'stool', x: -0.45, y: -1.01, ry: W, zh: '吧台凳', n: 'Counter stool' },
  { m: 'kitchen', i: 'stool', x: -0.45, y: -0.24, ry: W, zh: '吧台凳', n: 'Counter stool' },
  { m: 'kitchen', i: 'pendant', x: -1.33, y: -1.4, ry: E, zh: '橡木吊灯', n: 'Oak pendant' },
  { m: 'kitchen', i: 'counterDecor', x: -1.33, y: -0.3, h: 0.92, ry: E },
  { m: 'decor', i: 'trackLight', x: -1.33, y: -3.0, ry: E, light: false },
  // Dining (x 0.42..3.35, y 1.82..5.36): ash table N-S, six Wishbone chairs, lantern, built-in bookcase bench on the east wall
  { m: 'dining', i: 'table', x: 1.85, y: 3.5, ry: E, zh: '白蜡木餐桌', n: 'Ash dining table' },
  { m: 'dining', i: 'wishboneChair', x: 1.12, y: 2.78, ry: E, zh: 'Y 椅', n: 'Wishbone chair' },
  { m: 'dining', i: 'wishboneChair', x: 1.12, y: 3.5, ry: E, zh: 'Y 椅', n: 'Wishbone chair' },
  { m: 'dining', i: 'wishboneChair', x: 1.12, y: 4.22, ry: E, zh: 'Y 椅', n: 'Wishbone chair' },
  { m: 'dining', i: 'wishboneChair', x: 2.58, y: 2.78, ry: W, zh: 'Y 椅', n: 'Wishbone chair' },
  { m: 'dining', i: 'wishboneChair', x: 2.58, y: 3.5, ry: W, zh: 'Y 椅', n: 'Wishbone chair' },
  { m: 'dining', i: 'wishboneChair', x: 2.58, y: 4.22, ry: W, zh: 'Y 椅', n: 'Wishbone chair' },
  { m: 'dining', i: 'lantern', x: 1.85, y: 3.5, zh: '纸灯笼', n: 'Paper lantern' },
  { m: 'dining', i: 'bookcaseBench', x: 3.68, y: 4.6, ry: 0, zh: '书架坐凳', n: 'Built-in bookcase bench' },
    { m: 'decor', i: 'trayWood', x: 1.85, y: 2.9, h: 0.75, ry: E },
  { m: 'decor', i: 'curtainSheer', x: 1.55, y: 5.2, ry: 0 },
  { m: 'decor', i: 'curtainSheer', x: 3.85, y: 5.2, ry: 0, sx: 0.4 },
  // Office / family room (x -2.17..0.42): console with the red painting on the west wall, leather chair, sling chair, sheers at the glass wall
  { m: 'dining', i: 'console', x: -1.93, y: 3.5, ry: E, zh: '旧木边柜 · 红画', n: 'Reclaimed console & red painting' },
  { m: 'dining', i: 'armchairLeather', x: -0.5, y: 3.15, ry: d2r(-125), zh: '皮单椅', n: 'Leather armchair' },
  { m: 'dining', i: 'slingChair', x: 0.0, y: 3.6, ry: d2r(-95), zh: '黑皮吊带椅', n: 'Sling chair' },
  { m: 'decor', i: 'curtainSheer', x: -1.95, y: 5.2, ry: 0 },
  { m: 'decor', i: 'curtainSheer', x: 0.3, y: 5.2, ry: 0, sx: 0.5 },
  { m: 'decor', i: 'trackLight', x: -0.9, y: 3.2, ry: 0, light: false },
  { m: 'dining', i: 'deskWhite', x: -1.05, y: 2.08, ry: N, zh: '白色书桌', n: 'White desk' },
    // Primary suite A (x -5.9..-2.28, y 1.6..5.36): the whitewashed platform bed, headboard on the east wall, slider to the courtyard
  { m: 'bedrooms', i: 'bedWhitewash', x: -3.43, y: 3.55, ry: W, zh: '自制白蜡松木床', n: 'Hand-built whitewashed bed' },
  { m: 'bedrooms', i: 'rugWhite', x: -4.6, y: 3.55, ry: E },
  { m: 'bedrooms', i: 'sideTableCarved', x: -5.55, y: 2.75, zh: '雕花边几', n: 'Carved side table' },
  { m: 'bedrooms', i: 'shelfWalnut', x: -4.9, y: 2.0, ry: N, zh: '胡桃木小柜', n: 'Walnut shelf cabinet' },
  { m: 'decor', i: 'recessedLight', x: -4.0, y: 2.6 }, { m: 'decor', i: 'recessedLight', x: -4.0, y: 4.4, light: false }, { m: 'decor', i: 'recessedLight', x: -2.9, y: 3.5, light: false },
  { m: 'plants', i: 'potPlant', x: -2.6, y: 5.0 },
  // Primary bath (x -7.9..-6.0): shower behind the partition, vanity on the east wall, toilet under the window, ladder
  { m: 'bath', i: 'shower', x: -7.4, y: 3.1, ry: E, zh: '淋浴间', n: 'Shower' },
  { m: 'bath', i: 'vanity', x: -7.58, y: 4.3, ry: E, zh: '悬挂双盆洗手台', n: 'Floating vanity' },
  { m: 'bath', i: 'mirrorCabinet', x: -7.83, y: 4.3, ry: E },
  { m: 'bath', i: 'toilet', x: -7.2, y: 4.95, ry: S, zh: '马桶', n: 'Toilet' },
  { m: 'bath', i: 'ladderRack', x: -6.2, y: 3.3, ry: W },
  { m: 'decor', i: 'recessedLight', x: -6.9, y: 4.4, light: false },
  // Bedroom B (x 4.08..7.9, y 1.95..5.36): acacia bed on the east wall, nightstand under the window, dark console by the slider
  { m: 'bedrooms', i: 'bedAcacia', x: 6.8, y: 3.4, ry: W, zh: '相思木床', n: 'Acacia bed' },
  { m: 'bedrooms', i: 'nightstandPine', x: 7.62, y: 4.55, ry: W, zh: '松木床头柜', n: 'Pine nightstand' },
  { m: 'bedrooms', i: 'nightstandPine', x: 7.62, y: 2.25, ry: W, zh: '松木床头柜', n: 'Pine nightstand', light: false },
  { m: 'bedrooms', i: 'consoleDark', x: 4.32, y: 4.5, ry: E, zh: '深色书桌', n: 'Dark console' },
  { m: 'bedrooms', i: 'rugWhite', x: 5.7, y: 3.4, ry: E },
  { m: 'decor', i: 'recessedLight', x: 6.0, y: 3.6 }, { m: 'decor', i: 'recessedLight', x: 6.0, y: 2.5, light: false },
  // Bath B (x 5.1..7.9, y 0.31..1.84) and the hall bath (y -1.27..0.2)
  { m: 'bath', i: 'vanity', x: 6.1, y: 0.64, ry: N, zh: '悬挂洗手台', n: 'Floating vanity' }, { m: 'bath', i: 'mirrorCabinet', x: 6.1, y: 0.4, ry: N },
  { m: 'bath', i: 'toilet', x: 7.52, y: 0.62, ry: W }, { m: 'bath', i: 'shower', x: 7.4, y: 1.34, ry: W },
  { m: 'bath', i: 'vanitySmall', x: 6.0, y: -0.12, ry: S }, { m: 'bath', i: 'mirrorCabinetSmall', x: 6.0, y: 0.12, ry: S },
  { m: 'bath', i: 'toilet', x: 7.52, y: -0.04, ry: W }, { m: 'bath', i: 'shower', x: 7.4, y: -0.77, ry: W },
  // Bedroom 3 (x 4.08..7.9, y -5.74..-2.14): pine spindle bed on the east wall, nightstands, dark dresser on the front wall
  { m: 'bedrooms', i: 'bedPine', x: 6.83, y: -3.95, ry: W, zh: '松木床', n: 'Pine bed' },
  { m: 'bedrooms', i: 'nightstandPine', x: 7.62, y: -2.84, ry: W }, { m: 'bedrooms', i: 'nightstandPine', x: 7.62, y: -5.06, ry: W, light: false },
  { m: 'bedrooms', i: 'dresserDark', x: 4.6, y: -5.5, ry: N, zh: '炭黑五斗柜', n: 'Charcoal dresser' },
  { m: 'bedrooms', i: 'rugCheck', x: 5.8, y: -3.95, ry: E },
  { m: 'decor', i: 'cellularShadeNarrow', x: 5.95, y: -5.72, ry: N }, { m: 'decor', i: 'recessedLight', x: 6.0, y: -3.95 },
  // Hallway + closets
  { m: 'decor', i: 'recessedLight', x: 4.55, y: -0.2, light: false }, { m: 'decor', i: 'recessedLight', x: 4.55, y: 1.0, light: false },
  // Laundry closet (x -4.93..-3.5, y -1.53..0.66) and garage
  { m: 'bath', i: 'washerDryer', x: -4.2, y: 0.28, ry: S, zh: '叠放洗烘机', n: 'Washer & dryer' },
  { m: 'bath', i: 'waterHeater', x: -4.5, y: -1.1, ry: E },
  { m: 'bath', i: 'wireShelving', x: -6.6, y: 0.42, ry: S, zh: '置物架', n: 'Wire shelving' },
  { m: 'bath', i: 'pingPongTable', x: -6.1, y: -2.3, ry: E, zh: '乒乓球桌', n: 'Ping-pong table' },
  { m: 'bath', i: 'consoleRustic', x: -7.4, y: -4.47, ry: N, zh: '旧木酒柜', n: 'Rustic console' },
  { m: 'bath', i: 'electricalPanel', x: -7.95, y: -1.0, ry: E },
  // Porch & front
  { m: 'decor', i: 'ironColumn', x: -1.15, y: -5.95, ry: 0, zh: '铁艺柱', n: 'Wrought-iron column' }, { m: 'decor', i: 'ironColumnMirror', x: 1.2, y: -5.95, ry: 0, zh: '铁艺柱', n: 'Wrought-iron column' },
  { m: 'decor', i: 'wallLightBlack', x: 0.8, y: -4.9, ry: S }, { m: 'decor', i: 'houseNumber', x: -0.95, y: -4.9, ry: S },
  { m: 'outdoor', i: 'potWhiteLarge', x: -2.1, y: -6.6 }, { m: 'outdoor', i: 'potWhiteLarge', x: 2.55, y: -6.5 },
  { m: 'outdoor', i: 'plantersBench', x: 3.4, y: -9.6, ry: S, zh: '前院木凳', n: 'Front-yard bench' },
  { m: 'outdoor', i: 'potWhiteSmall', x: -9.5, y: -6.8 },
  { m: 'plants', i: 'cactusColumnar', x: -2.3, y: -7.6 }, { m: 'plants', i: 'banana', x: -3.6, y: -8.6, seed: 2 }, { m: 'plants', i: 'banana', x: 5.6, y: -7.6, seed: 3 },
  { m: 'plants', i: 'palmFan', x: 7.6, y: -9.8, seed: 1 }, { m: 'plants', i: 'palmFan', x: -9.8, y: -7.9, seed: 2 },
  { m: 'plants', i: 'bromeliad', x: -1.5, y: -8.2, seed: 1 }, { m: 'plants', i: 'bromeliad', x: 1.6, y: -8.4, seed: 2 }, { m: 'plants', i: 'bromeliad', x: 2.4, y: -7.4, seed: 3 }, { m: 'plants', i: 'bromeliad', x: -2.9, y: -10.5, seed: 4 },
  { m: 'plants', i: 'grassClump', x: 1.3, y: -10.5, seed: 1 }, { m: 'plants', i: 'grassClump', x: -1.6, y: -11.6, seed: 2 }, { m: 'plants', i: 'grassClump', x: 5.0, y: -11.0, seed: 3 }, { m: 'plants', i: 'grassClump', x: -3.2, y: -12.5, seed: 4 }, { m: 'plants', i: 'grassClump', x: 9.0, y: -6.0, seed: 5 },
  { m: 'plants', i: 'croton', x: 4.2, y: -6.3, seed: 1 }, { m: 'plants', i: 'croton', x: -9.2, y: -3.0, seed: 2 }, { m: 'plants', i: 'shrubGreen', x: 6.8, y: -6.0, seed: 1 }, { m: 'plants', i: 'shrubGreen', x: -2.0, y: -13.0, seed: 2 }, { m: 'plants', i: 'shrubGreen', x: 10.5, y: -8.0, seed: 3 },
  { m: 'plants', i: 'coleus', x: 2.6, y: -11.2, seed: 1 }, { m: 'plants', i: 'coleus', x: -2.0, y: -9.4, seed: 2 },
  { m: 'plants', i: 'treeLarge', x: 11.5, y: -11.5, seed: 1 }, { m: 'plants', i: 'treeLarge', x: -12.0, y: -12.0, seed: 2 },
  // Patio & courtyards (north)
  { m: 'outdoor', i: 'lounger', x: 0.4, y: 7.6, ry: N, zh: '白色躺椅', n: 'Lounge chair' }, { m: 'outdoor', i: 'lounger', x: 1.6, y: 7.9, ry: d2r(165), zh: '白色躺椅', n: 'Lounge chair' },
  { m: 'outdoor', i: 'planterBox', x: -4.8, y: 6.3, ry: 0 }, { m: 'outdoor', i: 'planterBox', x: 6.3, y: 6.3, ry: 0 },
  { m: 'plants', i: 'bromeliad', x: -5.2, y: 6.3, h: 0.38, seed: 5 }, { m: 'plants', i: 'bromeliad', x: -4.4, y: 6.3, h: 0.38, seed: 6 }, { m: 'plants', i: 'bromeliad', x: 6.0, y: 6.3, h: 0.38, seed: 7 }, { m: 'plants', i: 'bromeliad', x: 6.6, y: 6.3, h: 0.38, seed: 8 },
  { m: 'plants', i: 'banana', x: -3.3, y: 7.6, seed: 4 }, { m: 'plants', i: 'banana', x: 7.5, y: 7.9, seed: 5 }, { m: 'plants', i: 'palmFan', x: -5.8, y: 8.0, seed: 3 },
  { m: 'plants', i: 'coleus', x: 2.4, y: 10.6, seed: 3 }, { m: 'plants', i: 'coleus', x: 0.2, y: 10.9, seed: 4 },
  { m: 'plants', i: 'grassClump', x: -1.6, y: 10.8, seed: 6 }, { m: 'plants', i: 'grassClump', x: 4.6, y: 10.5, seed: 7 }, { m: 'plants', i: 'grassClump', x: 3.0, y: 14.5, seed: 8 }, { m: 'plants', i: 'grassClump', x: -6.5, y: 12.0, seed: 9 }, { m: 'plants', i: 'grassClump', x: 11.5, y: 10.0, seed: 10 },
  { m: 'plants', i: 'bromeliad', x: 1.0, y: 11.6, seed: 9 }, { m: 'plants', i: 'bromeliad', x: 5.6, y: 11.4, seed: 10 }, { m: 'plants', i: 'bromeliad', x: -3.6, y: 11.6, seed: 11 },
  { m: 'plants', i: 'croton', x: 6.6, y: 9.6, seed: 3 }, { m: 'plants', i: 'croton', x: -8.5, y: 10.0, seed: 4 }, { m: 'plants', i: 'shrubGreen', x: -10.0, y: 14.0, seed: 4 }, { m: 'plants', i: 'shrubGreen', x: 12.0, y: 15.5, seed: 5 }, { m: 'plants', i: 'shrubGreen', x: 0.0, y: 17.6, seed: 6 }, { m: 'plants', i: 'shrubGreen', x: -6.0, y: 17.4, seed: 7 },
  { m: 'plants', i: 'banana', x: -9.5, y: 16.5, seed: 6 }, { m: 'plants', i: 'banana', x: 5.5, y: 16.8, seed: 7 }, { m: 'plants', i: 'palmFan', x: 12.5, y: 12.5, seed: 4 },
  { m: 'plants', i: 'treeLarge', x: 12.5, y: 20.5, seed: 3 }, { m: 'plants', i: 'treeLarge', x: -12.5, y: 25.0, seed: 4 }, { m: 'plants', i: 'treePine', x: -9.0, y: 27.0 }, { m: 'plants', i: 'treeLarge', x: 20.0, y: 24.0, seed: 5 }, { m: 'plants', i: 'treeLarge', x: -24.0, y: -4.0, seed: 6 }, { m: 'plants', i: 'treeLarge', x: 26.0, y: 8.0, seed: 7 },

  // back-garden planting, dense and layered as in the panoramas (mulch beds around the shell lounge)
  { m: 'plants', i: 'shrubGold', x: 0.4, y: 9.6, seed: 1 }, { m: 'plants', i: 'shrubGold', x: 3.6, y: 9.7, seed: 2 }, { m: 'plants', i: 'shrubGold', x: -2.6, y: 10.2, seed: 3 }, { m: 'plants', i: 'shrubGold', x: 6.3, y: 11.6, seed: 4 },
  { m: 'plants', i: 'coleus', x: -1.2, y: 9.7, seed: 5 }, { m: 'plants', i: 'coleus', x: 5.4, y: 9.9, seed: 6 }, { m: 'plants', i: 'coleus', x: 6.6, y: 13.6, seed: 7 }, { m: 'plants', i: 'coleus', x: -3.2, y: 13.4, seed: 8 },
  { m: 'plants', i: 'grassClump', x: 6.4, y: 10.6, seed: 11 }, { m: 'plants', i: 'grassClump', x: 7.2, y: 14.8, seed: 12 }, { m: 'plants', i: 'grassClump', x: -3.8, y: 12.6, seed: 13 }, { m: 'plants', i: 'grassClump', x: -5.2, y: 15.5, seed: 14 }, { m: 'plants', i: 'grassClump', x: 2.2, y: 16.2, seed: 15 }, { m: 'plants', i: 'grassClump', x: 9.0, y: 12.2, seed: 16 }, { m: 'plants', i: 'grassClump', x: 10.6, y: 16.0, seed: 17 }, { m: 'plants', i: 'grassClump', x: -8.0, y: 12.5, seed: 18 },
  { m: 'plants', i: 'bromeliadGreen', x: 2.0, y: 9.5, seed: 12 }, { m: 'plants', i: 'bromeliad', x: 4.8, y: 9.6, seed: 13 }, { m: 'plants', i: 'bromeliadGreen', x: -0.6, y: 15.0, seed: 14 }, { m: 'plants', i: 'bromeliad', x: 7.6, y: 12.8, seed: 15 }, { m: 'plants', i: 'bromeliad', x: -4.8, y: 10.9, seed: 16 },
  { m: 'plants', i: 'shrubGreen', x: 8.6, y: 10.4, seed: 8 }, { m: 'plants', i: 'shrubGreen', x: 11.5, y: 13.2, seed: 9 }, { m: 'plants', i: 'shrubGreen', x: -7.6, y: 15.2, seed: 10 }, { m: 'plants', i: 'shrubGreen', x: 4.5, y: 17.4, seed: 11 }, { m: 'plants', i: 'shrubGreen', x: -3.0, y: 17.2, seed: 12 }, { m: 'plants', i: 'shrubGreen', x: 12.8, y: 17.5, seed: 13 },
  { m: 'plants', i: 'croton', x: -1.6, y: 12.9, seed: 5 }, { m: 'plants', i: 'croton', x: 8.0, y: 15.9, seed: 6 }, { m: 'plants', i: 'croton', x: -6.8, y: 10.6, seed: 7 },
  { m: 'plants', i: 'banana', x: 8.5, y: 17.3, seed: 8 }, { m: 'plants', i: 'banana', x: -0.5, y: 17.9, seed: 9 }, { m: 'plants', i: 'banana', x: 11.0, y: 9.0, seed: 10 }, { m: 'plants', i: 'palmFan', x: -4.0, y: 16.8, seed: 5 }, { m: 'plants', i: 'palmFan', x: 6.0, y: 15.9, seed: 6 },
  { m: 'plants', i: 'treeLarge', x: -9.0, y: 6.2, seed: 8 },
  // Back garden lounge: fire pit, wicker chairs and poufs, the lumber bench, stools, umbrella (NE corner, by the fence)
  { m: 'outdoor', i: 'firePit', x: 1.6, y: 12.3, zh: '火盆', n: 'Fire pit' },
  { m: 'outdoor', i: 'wickerChair', x: 0.3, y: 11.6, ry: d2r(60), zh: '藤编圆椅', n: 'Wicker chair' }, { m: 'outdoor', i: 'wickerChair', x: 0.5, y: 13.3, ry: d2r(125), zh: '藤编圆椅', n: 'Wicker chair' },
  { m: 'outdoor', i: 'wickerOttoman', x: 2.7, y: 11.2, zh: '藤编坐墩', n: 'Wicker pouf' }, { m: 'outdoor', i: 'wickerOttoman', x: 2.9, y: 13.5, zh: '藤编坐墩', n: 'Wicker pouf' },
  { m: 'outdoor', i: 'benchTable', x: 4.1, y: 12.4, ry: E, zh: '自制木长凳', n: 'Hand-built lumber bench' },
  { m: 'outdoor', i: 'stoolLumber', x: 3.6, y: 10.9, zh: '木墩', n: 'Lumber stool' }, { m: 'outdoor', i: 'stoolLumber', x: 4.4, y: 14.0, ry: 0.5, zh: '木墩', n: 'Lumber stool' },
  { m: 'outdoor', i: 'umbrella', x: 1.0, y: 9.95 },
];


// --- Procedural planting: the real garden is packed (aerial g50, panos). Beds are filled with a seeded scatter,
//     layered by size: ground cover and bromeliads near edges, grasses/shrubs/crotons mid, bananas/palms as accents.
const BEDS = [
  { poly: [[-14, 9.3], [-3.0, 9.3], [-3.0, 14.6], [2.0, 15.4], [5.6, 14.8], [5.9, 9.3], [14, 9.3], [14, 18.6], [-14, 18.6]], density: 0.34, mix: 'back' },  // back garden (around the shell lounge)
  { poly: [[-14, -1.2], [-8.6, -1.2], [-8.6, 9.3], [-14, 9.3]], density: 0.22, mix: 'side' },           // west side yard
  { poly: [[8.5, 2.0], [14, 2.0], [14, 9.3], [8.5, 9.3]], density: 0.2, mix: 'side' },                   // east side yard (north part)
  { poly: [[-3.6, -11.4], [-1.0, -11.4], [-0.9, -6.3], [-3.6, -6.3]], density: 0.5, mix: 'front' },       // front bed west of the walk
  { poly: [[0.9, -11.2], [8.3, -9.4], [8.3, -5.0], [0.9, -6.3]], density: 0.45, mix: 'front' },           // front bed east of the walk
  { poly: [[-12.5, -11.8], [-8.2, -11.8], [-8.2, -9.2], [-12.5, -9.2]], density: 0.3, mix: 'front' },     // in front of the parking pad
];
const AVOID = [ // polygons plants must stay out of (plan coords)
  [[-2.6, 9.3], [5.2, 9.3], [5.6, 11.0], [5.3, 14.6], [2.0, 15.2], [-1.8, 14.4], [-2.9, 12.0]],   // shell lounge
  [[-2.4, 5.4], [4.2, 5.4], [4.2, 10.3], [-2.4, 10.3]], [[-9.3, -1.1], [-8.2, -1.1], [-8.2, 1.1], [-9.3, 1.1]],
];
const MIX = {
  back: [['grassClump', 22], ['shrubGreen', 14], ['shrubGold', 10], ['coleus', 12], ['bromeliad', 10], ['bromeliadGreen', 6], ['croton', 10], ['banana', 8], ['palmFan', 5], ['cactusColumnar', 1]],
  side: [['grassClump', 20], ['shrubGreen', 25], ['croton', 10], ['banana', 12], ['palmFan', 10], ['coleus', 8], ['bromeliad', 10]],
  front: [['grassClump', 24], ['bromeliad', 16], ['bromeliadGreen', 8], ['croton', 12], ['coleus', 12], ['shrubGold', 8], ['banana', 8], ['palmFan', 6], ['shrubGreen', 6]],
};
const SPACING = { grassClump: 0.9, shrubGreen: 1.1, shrubGold: 1.1, coleus: 0.8, bromeliad: 0.55, bromeliadGreen: 0.55, croton: 0.9, banana: 1.6, palmFan: 1.9, cactusColumnar: 0.8 };
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
export function generatePlanting(seed = 7) {
  const rnd = lcg(seed), out = [], placed = [];
  for (const bed of BEDS) {
    const xs = bed.poly.map(p => p[0]), ys = bed.poly.map(p => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const area = (x1 - x0) * (y1 - y0), n = Math.round(area * bed.density);
    const mix = MIX[bed.mix], total = mix.reduce((a, m) => a + m[1], 0);
    let tries = 0;
    for (let k = 0; k < n && tries < n * 30; tries++) {
      const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
      if (!inPoly(x, y, bed.poly) || AVOID.some(a => inPoly(x, y, a))) continue;
      let r = rnd() * total, kind = mix[0][0]; for (const [name, w] of mix) { if (r < w) { kind = name; break; } r -= w; }
      const sp = SPACING[kind]; if (placed.some(q => Math.hypot(q.x - x, q.y - y) < (sp + SPACING[q.kind]) * 0.5)) continue;
      placed.push({ x, y, kind }); out.push({ m: 'plants', i: kind, x: +x.toFixed(2), y: +y.toFixed(2), seed: 100 + out.length, ry: rnd() * Math.PI * 2, scale: 0.85 + rnd() * 0.4 }); k++;
    }
  }
  // tall canopy beyond the fences so the horizon reads as a leafy neighbourhood
  for (const [x, y, sd] of [[-6, 23, 1], [3, 24.5, 2], [11, 23, 3], [18, 14, 4], [-18, 12, 5], [-19, 26, 6], [17, -6, 7], [-17, -9, 8], [8, -17, 9], [-6, -18, 10]]) out.push({ m: 'plants', i: 'treeLarge', x, y, seed: sd, scale: 0.9 + (sd % 3) * 0.12 });
  for (const [x, y, sd] of [[-15.5, 20, 1], [15.8, 21, 2], [14, -13, 3], [-13.5, -14.5, 4], [16, 6, 5]]) out.push({ m: 'plants', i: 'palmFan', x, y, seed: sd, scale: 1.35 });
  return out;
}

export class Layout {
  constructor(scene, fixtures, house, points) {
    this.scene = scene; this.fixtures = fixtures; this.house = house; this.points = points;
    this.root = new THREE.Group(); this.root.name = 'furniture'; scene.add(this.root);
    this.interactive = []; this.movables = []; this.animated = []; this.placed = [];
    this.cache = new Map();
    RectAreaLightUniformsLib.init();
    this.lightCount = 0;
  }
  async build(progress) {
    const mods = {}; const names = Object.keys(MODULES);
    for (let i = 0; i < names.length; i++) { progress(i / names.length * 0.5, names[i]); try { mods[names[i]] = await MODULES[names[i]](); } catch (e) { console.error('module failed', names[i], e); mods[names[i]] = { items: {} }; } }
    let k = 0;
    const all = PLACEMENTS.concat(generatePlanting(7));
    for (const p of all) {
      k++; if (k % 20 === 0) { progress(0.5 + (k / all.length) * 0.5, p.i); await new Promise(r => setTimeout(r)); }
      const builder = mods[p.m]?.items?.[p.i]; if (!builder) { console.warn('missing item', p.m, p.i); continue; }
      let obj;
      try { obj = p.seed !== undefined ? builder(p.seed) : builder(); } catch (e) { console.error('build failed', p.m, p.i, e); continue; }
      obj.position.set(p.x, p.h || 0, -p.y); obj.rotation.y = p.ry || 0; if (p.sx) obj.scale.x = p.sx; if (p.scale) obj.scale.multiplyScalar(p.scale);
      obj.userData.placement = p; if (p.zh) obj.userData.zh = p.zh; if (p.n) obj.userData.name = p.n;
      this.root.add(obj); this.placed.push(obj);
      if (obj.userData.seats?.length || obj.userData.movable) { obj.userData.interactiveRoot = true; this.interactive.push(obj); }
      if (obj.userData.movable) { this.movables.push(obj); }
      else if (obj.userData.collider) this.addFixedCollider(obj);
      if (obj.userData.animate) this.animated.push(obj);
      if (obj.userData.light && p.light !== false) this.addLight(obj, obj.userData.light);
      if (/mirror/i.test(p.i)) this.addMirrors(obj);
    }
    progress(1, 'done');
  }
  addFixedCollider(obj) {
    const c = obj.userData.collider; if (c.h !== undefined && c.h < 0.25) return;   // rugs, shades
    obj.updateMatrixWorld(true);
    const ry = obj.rotation.y, q = Math.round(ry / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ry - q) < 0.02) {
      const swap = Math.abs(Math.round(ry / (Math.PI / 2))) % 2 === 1;
      const w = swap ? c.d : c.w, d = swap ? c.w : c.d;
      const local = new THREE.Vector3(c.x, 0, c.z).applyMatrix4(obj.matrixWorld);
      addAABB(local.x - w / 2, local.x + w / 2, local.z - d / 2, local.z + d / 2, 'furn');
    } else { // rotated: use a bounding circle
      const local = new THREE.Vector3(c.x, 0, c.z).applyMatrix4(obj.matrixWorld);
      const r = Math.hypot(c.w, c.d) / 2 * 0.8; addAABB(local.x - r, local.x + r, local.z - r, local.z + r, 'furn');
    }
  }
  movableColliders(exclude) { return this.movables.filter(m => m !== exclude).map(m => { const r = m.userData.movable.radius; return { circle: true, x: m.position.x, z: m.position.z, r }; }); }
  addLight(obj, spec) {
    if (this.lightCount >= 16) return;
    obj.updateMatrixWorld(true);
    const wp = new THREE.Vector3(0, spec.y ?? 2.3, 0).applyMatrix4(obj.matrixWorld);
    let l;
    if (spec.type === 'spot') { l = new THREE.SpotLight(spec.color ?? 0xfff1dc, spec.intensity ?? 2, spec.distance ?? 7, spec.angle ?? 0.6, 0.5, 1.2); l.position.copy(wp); l.target.position.set(wp.x, 0, wp.z); this.fixtures.add(l.target); }
    else if (spec.type === 'rect') { l = new THREE.RectAreaLight(spec.color ?? 0xfff1dc, spec.intensity ?? 5, spec.w ?? 1, spec.h ?? 0.1); l.position.copy(wp); l.rotation.copy(obj.rotation); l.rotateX(-Math.PI / 2); }
    else { l = new THREE.PointLight(spec.color ?? 0xffe7c0, spec.intensity ?? 1, spec.distance ?? 6, 1.6); l.position.copy(wp); }
    l.userData.base = l.intensity; this.fixtures.add(l); this.lightCount++;
  }
  // Planar reflections for mirror faces: a Reflector plane over each mesh that uses the shared 'mirror' material.
  addMirrors(obj) {
    this.mirrors ??= [];
    obj.traverse(m => {
      if (!m.isMesh || m.material?.name !== 'mirror') return;
      m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
      const big = Math.max(w, h, d), axis = d < w && d < h ? 'z' : (w < h && w < d ? 'x' : 'y'); if (axis === 'y') return;
      const pw = axis === 'z' ? w : d, ph = h;
      const r = new Reflector(new THREE.PlaneGeometry(pw * 0.985, ph * 0.985), { textureWidth: 1024, textureHeight: 1024, color: 0xd8d8d8, clipBias: 0.003 });
      r.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      if (axis === 'z') { r.position.z = b.max.z + 0.002; } else { r.position.x = b.max.x + 0.002; r.rotation.y = Math.PI / 2; }
      m.parent.add(r); r.visible = false; this.mirrors.push(r);
    });
  }
  // enable mirrors only when the viewer is close (each one is an extra scene render)
  updateMirrors(camPos) { if (!this.mirrors) return; for (const r of this.mirrors) { const wp = new THREE.Vector3(); r.getWorldPosition(wp); r.visible = wp.distanceTo(camPos) < 4.5; } }
  animate(t) { for (const o of this.animated) o.userData.animate(t); }
}
