// Furniture placement (plan coordinates, metres; +y north) and scene lights from the furniture modules.
// ry: rotation about +Y; a module's front is local +Z. ry=0 faces south, π faces north, π/2 faces east, -π/2 faces west.
import { THREE } from './kit.js';
import { MODULES } from './furniture/index.js';
import { STYLING as STYLING_LIVING } from './styling_living.js';
import { STYLING as STYLING_KITCHEN } from './styling_kitchen.js';
import { STYLING as STYLING_ROOMS } from './styling_rooms.js';
import { STYLING as STYLING_GARDEN } from './styling_garden.js';
import { STYLING as STYLING_FLOWERS } from './styling_flowers.js';
import { addAABB } from './house.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createMirror, prepareMirrors, warmMirrors, updateMirrors } from './hq.js';

const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
const d2r = (d) => THREE.MathUtils.degToRad(d);

// ---- The placement table. {m: module, i: item, x, y (plan), h (height offset), ry, n (name override), light: false to skip its light}
export const PLACEMENTS = [
  // Living room (x -0.8..3.97, y -4.6..1.7): window seat on the front wall, sofa facing it, rug and round table between
  { m: 'living', i: 'windowSeat', x: 2.17, y: -4.28, ry: N, zh: '手工窗台座', n: 'Hand-built window seat' },
  { m: 'living', i: 'rug', x: 2.17, y: -2.40, ry: 0 },
  { m: 'living', i: 'sofa', x: 2.65, y: -1.15, ry: S, zh: '皮沙发', n: 'Leather sofa' },
  { m: 'living', i: 'coffeeTable', x: 2.52, y: -2.85, ry: 0, zh: '圆茶几', n: 'Round coffee table' },
  { m: 'living', i: 'sideBench', x: 3.78, y: -2.78, ry: W, zh: '松木长凳 · 红画', n: 'Pine console & red canvas' },
  { m: 'decor', i: 'cellularShade', x: 2.17, y: -4.54, h: -0.08, ry: N, sx: 0.93 },
  { m: 'decor', i: 'trackLight', x: 3.0, y: -2.35, ry: E },
  { m: 'decor', i: 'trackLight', x: 0.2, y: -0.2, ry: E, light: false },
  { m: 'decor', i: 'thermostat', x: 3.96, y: -0.3, ry: W },
  // Kitchen (g11-g18, pano ee4635b067): fridge beside the front door, sink + dishwasher under the window, range centred on
  // the west wall (south wall → wall stub), microwave/pantry tower north of the garage door with a bridge cabinet over it
  { m: 'kitchen', i: 'fridge', x: -1.03, y: -4.21, ry: N, zh: '黑色冰箱', n: 'Fridge' },
  { m: 'kitchen', i: 'southRunB', x: -2.449, y: -4.286, ry: N, zh: '水槽 · 洗碗机', n: 'Sink & dishwasher' },
  { m: 'kitchen', i: 'westRunB', x: -3.073, y: -3.1135, ry: E, zh: '炉灶墙', n: 'Range wall' },
  { m: 'kitchen', i: 'westRunC', x: -3.063, y: -0.38025, ry: E, zh: '微波炉高柜 · 微波炉上的黑板', n: 'Microwave & pantry tower' },
  { m: 'kitchen', i: 'island', x: -1.33, y: -1.28, ry: E, zh: '中岛', n: 'Island' },   // south end -2.88: seen edge-on from the g12 camera (y -2.886)
  { m: 'kitchen', i: 'stool', x: -0.45, y: -2.43, ry: W, zh: '吧台凳', n: 'Counter stool' },
  { m: 'kitchen', i: 'stool', x: -0.45, y: -1.66, ry: W, zh: '吧台凳', n: 'Counter stool' },
  { m: 'kitchen', i: 'stool', x: -0.45, y: -0.89, ry: W, zh: '吧台凳', n: 'Counter stool' },
  { m: 'kitchen', i: 'stool', x: -0.45, y: -0.12, ry: W, zh: '吧台凳', n: 'Counter stool' },
  { m: 'kitchen', i: 'pendant', x: -1.33, y: -1.28, ry: E, zh: '橡木吊灯', n: 'Oak pendant' },
  { m: 'kitchen', i: 'counterDecor', x: -1.33, y: -0.18, h: 0.92, ry: E },
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
  { m: 'dining', i: 'bookcaseBench', x: 3.68, y: 4.66, ry: 0, sz: 0.86, zh: '书架坐凳', n: 'Built-in bookcase bench' },
  { m: 'decor', i: 'curtainSheer', x: 1.55, y: 5.2, ry: 0 },
  { m: 'decor', i: 'curtainSheer', x: 3.11, y: 5.2, ry: 0, sx: 0.25 },
  // Office / family room (x -2.17..0.42): console with the red painting on the west wall, leather chair, sling chair, sheers at the glass wall
  { m: 'dining', i: 'console', x: -1.93, y: 3.5, ry: E, zh: '旧木边柜 · 红画', n: 'Reclaimed console & red painting' },
  { m: 'dining', i: 'armchairLeather', x: -0.70, y: 3.15, ry: d2r(-125), zh: '皮单椅', n: 'Leather armchair' },
  { m: 'dining', i: 'slingChair', x: -0.08, y: 4.15, ry: d2r(-95), zh: '黑皮吊带椅', n: 'Sling chair' },
  { m: 'decor', i: 'curtainSheer', x: -1.90, y: 5.2, ry: 0, sx: 0.29 },
  { m: 'decor', i: 'curtainSheer', x: 0.3, y: 5.2, ry: 0, sx: 0.5 },
  { m: 'decor', i: 'trackLight', x: -0.9, y: 3.2, ry: 0, light: false },
  { m: 'dining', i: 'deskWhite', x: -1.05, y: 2.12, ry: N, zh: '白色书桌', n: 'White desk' },
    // Primary suite (x -5.9..-2.28, y 1.6..5.36): headboard on the east wall under the soffit, slider to the courtyard;
    // the walnut cabinet stands on the south wall beside the vestibule so the way in from the kitchen stays open
  { m: 'bedrooms', i: 'bedWhitewash', x: -3.445, y: 3.55, ry: W, zh: '自制白蜡松木床', n: 'Hand-built whitewashed bed' },
  { m: 'bedrooms', i: 'rugWhite', x: -4.35, y: 3.55, ry: E },
  { m: 'bedrooms', i: 'sideTableCarved', x: -5.55, y: 2.95, zh: '雕花边几', n: 'Carved side table' },
  { m: 'bedrooms', i: 'shelfWalnut', x: -5.37, y: 1.78, ry: N, zh: '胡桃木小柜', n: 'Walnut shelf cabinet' },
  { m: 'decor', i: 'recessedLight', x: -4.3, y: 2.6 }, { m: 'decor', i: 'recessedLight', x: -4.3, y: 4.5, light: false },
  { m: 'decor', i: 'recessedLight', x: -2.85, y: 2.45, h: -0.23, light: false }, { m: 'decor', i: 'recessedLight', x: -2.85, y: 4.65, h: -0.23, light: false },
  { m: 'decor', i: 'recessedLight', x: -4.15, y: 1.2, light: false },
  { m: 'plants', i: 'potPlant', x: -2.74, y: 5.12 },
  // Primary bath (x -7.9..-6.0, y 1.6..5.36): corner shower against the closet, toilet under the west window, double vanity on the west wall
  { m: 'bath', i: 'shower', x: -7.307, y: 2.110, ry: N, sx: 1.13, zh: '淋浴间', n: 'Shower' },
  { m: 'bath', i: 'toilet', x: -7.53, y: 2.97, ry: E, zh: '马桶', n: 'Toilet' },
  { m: 'bath', i: 'vanityDouble', x: -7.653, y: 4.47, ry: E, zh: '悬挂双盆洗手台', n: 'Floating double vanity' },
  { m: 'bath', i: 'mirrorCabinetWide', x: -7.833, y: 4.47, h: 0.15, ry: E },
  { m: 'bath', i: 'ladderRack', x: -6.31, y: 3.45, ry: W },
  // no live light (the raster walkthrough's light budget), but lamps in the baked lighting (bake/export/lights.mjs): with the
  // door shut and its one window in the WC, the primary bath has no other light at sunrise (g30 shows the cans on)
  { m: 'decor', i: 'recessedLight', x: -6.95, y: 4.4, light: false, bake: true }, { m: 'decor', i: 'recessedLight', x: -6.95, y: 2.9, light: false, bake: true },
  // Bedroom B (x 4.08..7.9, y 1.95..5.36): acacia bed on the east wall, nightstand under the window, dark console by the slider
  { m: 'bedrooms', i: 'bedAcacia', x: 6.69, y: 3.4, ry: W, zh: '相思木床', n: 'Acacia bed' },
  { m: 'bedrooms', i: 'nightstandPine', x: 7.62, y: 4.55, ry: W, zh: '松木床头柜', n: 'Pine nightstand' },
  { m: 'bedrooms', i: 'nightstandPine', x: 7.62, y: 2.25, ry: W, zh: '松木床头柜', n: 'Pine nightstand', light: false },
  { m: 'bedrooms', i: 'consoleDark', x: 4.32, y: 4.5, ry: E, zh: '深色书桌', n: 'Dark console' },
  { m: 'bedrooms', i: 'rugWhite', x: 5.7, y: 3.4, ry: E },
  { m: 'decor', i: 'recessedLight', x: 6.0, y: 3.6 }, { m: 'decor', i: 'recessedLight', x: 6.0, y: 2.5, light: false },
  // Bath B (x 5.1..7.9, y 0.31..1.84) and the hall bath (y -1.27..0.2)
  { m: 'bath', i: 'vanity', x: 6.1, y: 0.64, ry: N, zh: '悬挂洗手台', n: 'Floating vanity' }, { m: 'bath', i: 'mirrorCabinet', x: 6.1, y: 0.4, h: 0.15, ry: N },
  { m: 'bath', i: 'toilet', x: 7.52, y: 0.62, ry: W }, { m: 'bath', i: 'showerWindowB', x: 7.28, y: 1.34, ry: W },
  { m: 'bath', i: 'vanitySmall', x: 6.0, y: -0.12, ry: S }, { m: 'bath', i: 'mirrorCabinetSmall', x: 6.0, y: 0.12, h: 0.15, ry: S },
  { m: 'bath', i: 'toilet', x: 7.52, y: -0.04, ry: W }, { m: 'bath', i: 'showerWindowHall', x: 7.28, y: -0.77, ry: W },
  // Bedroom 3 (x 4.08..7.9, y -5.74..-2.14): pine spindle bed on the east wall, nightstands, dark dresser on the front wall
  { m: 'bedrooms', i: 'bedPine', x: 6.72, y: -3.95, ry: W, zh: '松木床', n: 'Pine bed' },
  { m: 'bedrooms', i: 'nightstandPine', x: 7.62, y: -2.84, ry: W }, { m: 'bedrooms', i: 'nightstandPine', x: 7.62, y: -5.06, ry: W, light: false },
  { m: 'bedrooms', i: 'dresserDark', x: 4.6, y: -5.5, ry: N, zh: '炭黑五斗柜', n: 'Charcoal dresser' },
  { m: 'bedrooms', i: 'rugCheck', x: 5.8, y: -3.95, ry: E },
  { m: 'decor', i: 'cellularShadeNarrow', x: 5.955, y: -5.68, h: -0.08, ry: N }, { m: 'decor', i: 'recessedLight', x: 6.0, y: -3.95 },
  // Front bedroom reach-in closet: white shelf, guest wardrobe and floor storage, facing south.
  { m: 'closet', i: 'fitout', x: 6.51, y: -1.70 },
  { m: 'closet', i: 'hanging', x: 6.51, y: -1.70 },
  { m: 'closet', i: 'shelf', x: 6.51, y: -1.70, h: 1.793 },
  { m: 'closet', i: 'hamper', x: 5.39, y: -1.73 },
  { m: 'closet', i: 'shoes', x: 6.62, y: -1.79 },
  { m: 'closet', i: 'travel', x: 7.65, y: -1.63, ry: W },
  { m: 'closet', i: 'yoga', x: 5.74, y: -1.53 },
  // Hallway + closets
  // windowless, between shut bath and closet doors: lamps in the baked lighting only (see the primary bath's cans)
  { m: 'decor', i: 'recessedLight', x: 4.55, y: -0.2, light: false, bake: true }, { m: 'decor', i: 'recessedLight', x: 4.55, y: 1.0, light: false, bake: true },
  // Laundry nook (x -7.9..-6.36, y 0.16..1.48, open to the garage) and garage (x -7.9..-3.51, y -5.74..0.16), g07 / g48 / g49
  { m: 'garage', i: 'laundryPlinth', x: -7.5, y: 1.07, ry: S },
  { m: 'bath', i: 'washerDryer', x: -7.5, y: 1.1, h: 0.10, ry: S, zh: '叠放洗烘机', n: 'Washer & dryer' },
  { m: 'bath', i: 'waterHeater', x: -6.75, y: 1.17, ry: S, zh: '热水器', n: 'Water heater' },
  { m: 'garage', i: 'utilitySink', x: -6.66, y: 0.56, ry: S, zh: '洗衣水槽', n: 'Utility sink' },
  // west wall, north to south (g48): panel by the nook, shutter leaning beside the console, console under the rail, side door
  { m: 'bath', i: 'electricalPanel', x: -7.89, y: -0.05, ry: E },
  { m: 'garage', i: 'leaningFrame', x: -7.903, y: -0.42, ry: E },
  { m: 'bath', i: 'consoleRustic', x: -7.66, y: -1.18, ry: E, zh: '旧木酒柜', n: 'Rustic console' },
  { m: 'garage', i: 'wallRail', x: -7.903, y: -1.25, ry: E },
  { m: 'garage', i: 'dryFlowersVase', x: -7.70, y: -0.77, h: 0.8, ry: E },
  // north wall east of the nook (g49), ping-pong table in front of it, open sectional door and shop lights
  { m: 'garage', i: 'metalShelving', x: -5.62, y: -0.1, ry: S, zh: '置物架', n: 'Steel shelving' },
  { m: 'garage', i: 'pingPongSlate', x: -5.6, y: -2.6, ry: E, zh: '乒乓球桌', n: 'Ping-pong table' },
  { m: 'garage', i: 'garageDoorOpen', x: -6.52, y: -5.8503, ry: S },
  { m: 'garage', i: 'shopLight', x: -5.7, y: -1.6, ry: E }, { m: 'garage', i: 'shopLight', x: -4.4, y: -3.6, ry: E },
  // Porch & front
  { m: 'decor', i: 'ironColumn', x: -1.15, y: -5.95, ry: 0, zh: '铁艺柱', n: 'Wrought-iron column' }, { m: 'decor', i: 'ironColumnMirror', x: 1.2, y: -5.95, ry: 0, zh: '铁艺柱', n: 'Wrought-iron column' },
  { m: 'decor', i: 'wallLightBlack', x: 0.8, y: -4.912, ry: S }, { m: 'decor', i: 'houseNumber', x: -0.95, y: -4.9, ry: S },
  { m: 'decor', i: 'ironColumn', x: 4.98, y: -5.92, h: .9, scale: .5, sx: 2.1 },
  { m: 'decor', i: 'ironColumnMirror', x: 6.93, y: -5.92, h: .9, scale: .5, sx: 2.1 },
  { m: 'outdoor', i: 'frontPallet', x: -2.45, y: -9.45, h: .22, ry: S, zh: '前院木平台', n: 'Front garden pallet platform' },
  { m: 'outdoor', i: 'frontRoundPot', x: -3.05, y: -9.45, h: .447 },
  { m: 'flowers', i: 'frontGeranium', x: -3.05, y: -9.45, h: .85, seed: 13 },
  { m: 'outdoor', i: 'frontLamp', x: -3.25, y: -10.1, h: .22, n: 'Front garden lantern' },
  { m: 'outdoor', i: 'frontFence', x: 11.25, y: -1.0 },
  { m: 'outdoor', i: 'frontCondenser', x: 8.92, y: -3.85 },
  { m: 'outdoor', i: 'frontCurb', x: -4.05, y: -9.32, ry: E, sx: 2.95 },
  { m: 'outdoor', i: 'frontCurb', x: 0.2, y: -10.8, sx: 8.5 },
  { m: 'outdoor', i: 'frontCube', x: 3.95, y: -10.48, h: .22 },
  { m: 'outdoor', i: 'frontCube', x: 4.02, y: -8.32, h: .22 },
  { m: 'plants', i: 'cordyline', x: 3.95, y: -10.48, h: .65, scale: .5, seed: 8 },
  { m: 'plants', i: 'birdPaddle', x: -2.55, y: -8.14, h: .22, seed: 2 },
  { m: 'plants', i: 'birdPaddle', x: 2.3, y: -8.15, h: .22, seed: 3 },
  { m: 'plants', i: 'birdPaddle', x: 4.55, y: -8.05, seed: 4, scale: 1.1 },
  { m: 'plants', i: 'cordyline', x: -3.6, y: -7.95, h: .22, seed: 2, scale: 1.25 },
  { m: 'plants', i: 'cordyline', x: 3.4, y: -7.98, h: .22, seed: 3, scale: 1.2 },
  { m: 'plants', i: 'cordyline', x: 8.1, y: -6.85, seed: 5, scale: .95 },
  { m: 'plants', i: 'croton', x: 1.55, y: -6.5, seed: 1, scale: .7 },
  { m: 'plants', i: 'bromeliadGreen', x: -1.35, y: -6.55, seed: 4 },
  { m: 'plants', i: 'shrubGreen', x: 4.75, y: -6.5, seed: 1, scale: 1.3 },
  { m: 'plants', i: 'shrubGreen', x: 5.75, y: -6.6, seed: 2, scale: 1.4 },
  { m: 'plants', i: 'shrubGreen', x: 6.85, y: -6.6, seed: 3, scale: 1.4 },
  { m: 'plants', i: 'shrubGreen', x: 7.9, y: -6.5, seed: 4, scale: 1.5 },
  { m: 'plants', i: 'shrubGreen', x: -9.2, y: -6.2, seed: 6, scale: 1.5 },
  { m: 'plants', i: 'shrubGreen', x: -3.65, y: -6.35, seed: 7, scale: .85 },
  { m: 'plants', i: 'muhlyFront', x: -9.6, y: -8.0, seed: 1, scale: 1.15 },
  { m: 'plants', i: 'muhlyFront', x: -9.7, y: -10.6, seed: 2, scale: 1.25 },
  { m: 'plants', i: 'muhlyFront', x: -9.4, y: -13.0, seed: 3, scale: 1.05 },
  { m: 'plants', i: 'muhlyFront', x: -13.1, y: -8.2, seed: 4, scale: 1.2 },
  { m: 'plants', i: 'muhlyFront', x: -13.15, y: -10.7, seed: 5, scale: 1.3 },
  { m: 'plants', i: 'muhlyFront', x: -13.2, y: -12.7, seed: 6, scale: 1.1 },
  { m: 'plants', i: 'muhlyFront', x: 4.95, y: -10.65, seed: 7, scale: 1.25 },
  { m: 'plants', i: 'muhlyFront', x: 6.55, y: -11.7, seed: 8, scale: 1.3 },
  { m: 'plants', i: 'muhlyFront', x: 7.85, y: -12.65, seed: 9, scale: 1.1 },
  { m: 'plants', i: 'muhlyFront', x: 3.3, y: -12.0, seed: 10, scale: 1.1 },
  { m: 'plants', i: 'muhlyFront', x: 10.1, y: -12.6, seed: 11, scale: .55 },
  { m: 'plants', i: 'muhlyFront', x: 12.15, y: -12.8, seed: 12, scale: .5 },
  { m: 'plants', i: 'arecaClump', x: -2.85, y: -12.35, seed: 1, scale: .95 },
  { m: 'plants', i: 'arecaClump', x: -2.65, y: -11.65, seed: 2, scale: .9 },
  { m: 'plants', i: 'arecaClump', x: 2.2, y: -12.3, seed: 3 },
  { m: 'plants', i: 'arecaClump', x: 3.6, y: -12.3, seed: 4, scale: 1.05 },
  { m: 'plants', i: 'arecaClump', x: 5.6, y: -12.4, seed: 5, scale: .9 },
  { m: 'plants', i: 'arecaClump', x: 5.25, y: -11.1, seed: 6, scale: 1.0 },
  { m: 'flowers', i: 'ixora', x: -1.65, y: -8.1, h: .22, seed: 3 },
  { m: 'flowers', i: 'ixora', x: 1.45, y: -8.05, h: .22, seed: 4 },
  { m: 'flowers', i: 'ixora', x: 3.8, y: -8.05, h: .22, seed: 5 },
  // Patio & courtyards (north)
  { m: 'outdoor', i: 'lounger', x: 0.4, y: 7.6, ry: N, zh: '白色躺椅', n: 'Lounge chair' }, { m: 'outdoor', i: 'lounger', x: 1.6, y: 7.9, ry: d2r(165), zh: '白色躺椅', n: 'Lounge chair' },
  { m: 'outdoor', i: 'planterBox', x: -4.8, y: 6.3, ry: 0 }, { m: 'outdoor', i: 'planterBox', x: 6.3, y: 6.3, ry: 0 },
  { m: 'flowers', i: 'guzmaniaRed', x: -5.2, y: 6.3, h: 0.35, seed: 5 }, { m: 'flowers', i: 'guzmaniaOrange', x: -4.4, y: 6.3, h: 0.35, seed: 6 }, { m: 'flowers', i: 'guzmaniaRed', x: 6.0, y: 6.3, h: 0.35, seed: 7 }, { m: 'flowers', i: 'guzmaniaOrange', x: 6.6, y: 6.3, h: 0.35, seed: 8 },
  { m: 'plants', i: 'banana', x: -4.3, y: 8.05, seed: 4 }, { m: 'plants', i: 'banana', x: 8.9, y: 9.3, seed: 5 }, { m: 'plants', i: 'palmFan', x: -5.8, y: 8.0, seed: 3 },
  { m: 'plants', i: 'coleus', x: 2.4, y: 10.6, seed: 3 }, { m: 'plants', i: 'coleus', x: 0.2, y: 10.9, seed: 4 },
  { m: 'plants', i: 'grassClump', x: -1.6, y: 10.8, seed: 6 }, { m: 'plants', i: 'grassClump', x: 4.6, y: 10.5, seed: 7 }, { m: 'plants', i: 'grassClump', x: 3.0, y: 14.5, seed: 8 }, { m: 'plants', i: 'grassClump', x: -6.5, y: 12.0, seed: 9 }, { m: 'plants', i: 'grassClump', x: 11.5, y: 10.0, seed: 10 },
  { m: 'plants', i: 'bromeliad', x: 1.0, y: 11.6, seed: 9 }, { m: 'plants', i: 'bromeliad', x: 5.6, y: 11.4, seed: 10 }, { m: 'plants', i: 'bromeliad', x: -3.6, y: 11.6, seed: 11 },
  { m: 'plants', i: 'croton', x: 6.6, y: 9.6, seed: 3 }, { m: 'plants', i: 'croton', x: -8.5, y: 10.0, seed: 4 }, { m: 'plants', i: 'shrubGreen', x: -10.0, y: 14.0, seed: 4 }, { m: 'plants', i: 'shrubGreen', x: 12.0, y: 15.5, seed: 5 }, { m: 'plants', i: 'shrubGreen', x: 0.0, y: 17.6, seed: 6 }, { m: 'plants', i: 'shrubGreen', x: -6.0, y: 17.4, seed: 7 },
  { m: 'plants', i: 'banana', x: -9.5, y: 16.5, seed: 6 }, { m: 'plants', i: 'banana', x: 5.5, y: 16.8, seed: 7 }, { m: 'plants', i: 'palmFan', x: 12.5, y: 12.5, seed: 4 },
  { m: 'plants', i: 'treeLarge', x: 12.5, y: 20.5, seed: 3 }, { m: 'plants', i: 'treeLarge', x: -12.5, y: 25.0, seed: 4 }, { m: 'plants', i: 'treePine', x: -9.0, y: 27.0 }, { m: 'plants', i: 'treeLarge', x: 18.8, y: 22.8, seed: 5 }, { m: 'plants', i: 'treeLarge', x: -24.0, y: -4.0, seed: 6 }, { m: 'plants', i: 'treeLarge', x: 26.0, y: 8.0, seed: 7 },

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


// ---- RedNote 6acbf22b00: deep wall alcove (opens west), seat tucked under the box ----
PLACEMENTS.push(
  { m: 'niche', i: 'shelfBox', x: 3.630, y: 1.254, ry: W },
  { m: 'niche', i: 'seat', x: 3.525, y: 1.36, ry: E },
);
// Keep the fig clear of the west-facing mouth; the old carved table/diffuser are no longer placed.
for (const p of STYLING_LIVING) {
  if (p.i === 'fiddleFig') Object.assign(p, { x: -0.35, y: 4.85 });
}
// ---- End alcove placements ----

// Front garden: overlapping tall/mid/low layers. Static infill shares materials and merges into 8 m cells.
const frontRnd = lcg(2513);
// Street-side palm band: per-plant height (sy) gives the row a skyline. bandRnd adds jitter without shifting frontRnd,
// so the plants seeded after the band (west strip, lot edges) keep their draws.
const bandRnd = lcg(3125);
const frontPlant = (i, x, y, scale = 1, zone = 'foundation', m = 'plants', h = 0, sy = 0) => PLACEMENTS.push({ m, i, x, y, h, scale, seed: 500 + PLACEMENTS.length, ry: frontRnd() * Math.PI * 2, zone: 'frontDense', gardenZone: zone, ...(sy && { sy }) });
for (const [x, y, s] of [[-4.4,-8.3,.8],[-2.65,-6.35,.7],[-1.6,-6.4,.65],[1.65,-6.55,1.1],[2.7,-6.6,1.2],[3.7,-6.55,1.35],[4.25,-6.6,1.3],[5.25,-6.6,1.4],[6.3,-6.55,1.45],[7.4,-6.6,1.5],[8.45,-6.8,1.35]]) frontPlant('shrubGreen',x,y,s);
for (const [x, y, s] of [[-3.35,-8.2,.75],[-1.65,-8.3,.7],[3.35,-8.25,.7],[6.15,-7.4,.65]]) frontPlant('birdPaddle',x,y,s,'foundation','plants',y < -7.85 && x < 4.45 ? .22 : 0);
for (const [x, y] of [[-4.3,-7.85],[-1.2,-8.2],[1.3,-7.9],[5.65,-7.45],[7.7,-7.5],[8.7,-6.4]]) frontPlant('cordyline',x,y,.7 + frontRnd() * .35,'foundation','plants',x > -4.05 && x < 4.45 && y < -7.85 ? .22 : 0);
for (const [x, y] of [[-4.15,-6.4],[-2.1,-6.5],[2.15,-6.85],[3.8,-7.35],[5.3,-7.5],[6.8,-7.45],[8.05,-7.65]]) frontPlant('croton',x,y,.75 + frontRnd() * .3);
for (const [x, y] of [[-3.9,-8.25],[-2.05,-8.3],[2.8,-8.3],[5.0,-7.6],[7.1,-7.6],[8.3,-7.5]]) frontPlant('ixora',x,y,.8 + frontRnd() * .35,'foundation','flowers',x > -4.05 && x < 4.45 && y < -7.85 ? .22 : 0);
for (let x = 1.7; x < 8.25; x += .62) {
  frontPlant('frontCover',x,-7.3 + frontRnd() * .2,.8 + frontRnd() * .25);
  frontPlant('frontCover',x,-6.65,.8 + frontRnd() * .2);
  if (x > 4.5) frontPlant('frontFern',x,-7.65,.85 + frontRnd() * .3,'foundation','props_garden');
}
for (const [a, b] of [[-3.8,-1.1],[1.25,4.15]]) for (let x = a; x < b; x += .55) {
  frontPlant('frontCover',x,-8.27,.75 + frontRnd() * .2,'foundation','plants',.22);
  if (Math.round(x * 10) % 2) frontPlant('frontFern',x,-8.3,.8,'foundation','props_garden',.22);
}
for (let x = -4.3; x < -1.4; x += .6) frontPlant('frontCover',x,-6.4,.75);
// Palm band: clumps of mixed size and height in a loose double row, tall ones at the back, muhly low in front.
// The centre is filled further down so the band screens the front door from the street.
for (const [x, y, s, sy] of [[-3.35,-11.4,1.15,.95],[-2.15,-12.05,.9,.75],[-3.9,-12.6,.8,.7],[1.75,-11.35,1.12,.9],[2.7,-12.4,.85,.72],[3.7,-11.65,1,.82],[4.95,-11.9,1.22,.92],[5.95,-12.8,.8,.66],[6.7,-11.45,.95,.8],[7.95,-12.15,1.1,.88],[9.6,-12.55,.8,.7]]) frontPlant('frontAreca',x,y,s,'palmBand','plants',0,sy);
frontPlant('frontQueen',-1.1,-8.22,1,'foundation','plants',.22);
frontPlant('frontQueen',7.1,-10.05,1.02,'palmBand');
for (const [x, y, s, sy] of [[-3.55,-13.1,1.2,.72],[-2.3,-13.35,.9,.58],[1.45,-13.05,1.15,.68],[2.95,-13.35,.95,.55],[4.55,-13.1,1.25,.75],[6.6,-13.3,1,.6],[8.55,-12.95,.85,.62]]) frontPlant('muhlyFront',x,y,s,'palmBand','plants',0,sy);
for (const [a, b] of [[-4.1,-1.25],[1.25,7.7]]) for (let x = a; x < b; x += .65) for (const y of [-11.3,-12.3,-13.3]) {
  frontPlant('frontCover',x + (frontRnd() - .5) * .2 + (bandRnd() - .5) * .3,y + frontRnd() * .15 - bandRnd() * .2,.9 + frontRnd() * .25,'palmBand','plants',0,.75 + bandRnd() * .45);
  if (y === -11.3) frontPlant('frontFern',x + (bandRnd() - .5) * .45,y - bandRnd() * .7,.85 + frontRnd() * .25,'palmBand','props_garden',0,.7 + bandRnd() * .5);
}
for (const [x,y] of [[-3.75,-11.3],[2.8,-11.1],[5.4,-11.45],[7.7,-12.25]]) frontPlant('croton',x,y,.8,'palmBand');
// West shell remains visible between the fuller grass drifts.
for (const x of [-9.55,-13.2]) for (let y = -7.65; y > -13.3; y -= .9) {
  frontPlant('grassClump',x + (frontRnd() - .5) * .25,y,.9 + frontRnd() * .35,'westStrip');
  frontPlant('frontCover',x,y + .28,.7 + frontRnd() * .25,'westStrip');
}
for (const [x,y] of [[-10.5,-8.4],[-12.4,-9.25],[-10.45,-11.15],[-12.35,-12.3],[-13.5,-6.5]]) frontPlant('shrubGreen',x,y,.8 + frontRnd() * .35,'westStrip');
// Hedges near the house stay on our side of the lot boundaries.
for (const x of [-13.05,13.05]) for (let y = -6.1; y < -.9; y += .88) {
  frontPlant('shrubGreen',x + (frontRnd() - .5) * .18,y,1.25 + frontRnd() * .3,'lotEdges');
  frontPlant('frontCover',x,y - .3,.9,'lotEdges');
}
// Palm band centre, in front of the door: no opening to the street; the terrace is reached from the drive and the east lawn.
for (const [x, y, s, sy] of [[-0.6,-11.5,1.15,.88],[0.6,-12.05,1.08,.85],[-0.05,-12.85,.88,.8]]) frontPlant('frontAreca',x,y,s,'palmBand','plants',0,sy);
frontPlant('muhlyFront',0.2,-13.2,1.2,'palmBand','plants',0,.66);
for (let x = -1.0; x < 1.3; x += .65) for (const y of [-11.3,-12.3,-13.3]) {
  frontPlant('frontCover',x + (frontRnd() - .5) * .2 + (bandRnd() - .5) * .3,y + frontRnd() * .15 - bandRnd() * .2,.9 + frontRnd() * .25,'palmBand','plants',0,.75 + bandRnd() * .45);
  if (y === -11.3) frontPlant('frontFern',x + (bandRnd() - .5) * .45,y - bandRnd() * .7,.85 + frontRnd() * .25,'palmBand','props_garden',0,.7 + bandRnd() * .5);
}
frontPlant('croton',0.35,-11.15,.85,'palmBand');
frontPlant('cordyline',-0.95,-11.2,1.1,'palmBand');

// --- Procedural planting: the real garden is packed (aerial g50, panos). Beds are filled with a seeded scatter,
//     layered by size: bromeliads/coleus near edges, shrubs/crotons mid, bananas/palms as accents. The ground-cover
//     carpet and the ornamental-grass drifts over the same BEDS are instanced in grass.js.
import { LOUNGE, PATIO, COURT_A, COURT_B, COURT_PAD, PORCH, WALK, DRIVE, PAD, AC_UNITS, GARDEN, SIDE_PATHS, ISLAND_BEDS, FRONT_WALK } from './house.js';
const HOUSE_KEEP = { x0: -8.36, x1: 8.36, y0: -6.16, y1: 5.8 };            // house + garage incl. stucco skin and stem wall
const STEP = { x0: PORCH.x0 + 0.2, x1: PORCH.x1 - 0.2, y0: PORCH.y0 - 0.42, y1: PORCH.y0 };
export const PAVED = [HOUSE_KEEP, PORCH, STEP, WALK, DRIVE, PAD, PATIO, COURT_A, COURT_B, COURT_PAD, AC_UNITS];   // no plant footprint on these
export const SHELL = [LOUNGE, ...SIDE_PATHS, FRONT_WALK];                                                                // walkable shell: centres stay off, leaves may spill over
// Bounding boxes of the shell polygons: a point farther than r from a box is farther than r from every edge inside it,
// so plantClearance skips the exact edge test for most polygons (that test was ~2 s of the load).
const SHELL_BOX = SHELL.map(poly => { const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
function nearShell(x, y, r) {
  for (let i = 0; i < SHELL.length; i++) {
    const b = SHELL_BOX[i];
    if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) continue;
    if (edgeDist(x, y, SHELL[i]) < r) return true;
  }
  return false;
}
export const BEDS = [   // cover: 'dense' = mulch carpeted with ground cover, 'shell' = white shell with plants and edge ground cover only
  { poly: [[-14.0, 5.62], [14.0, 5.62], [14.0, 18.95], [-14.0, 18.95]], density: 0.26, mix: 'back', cover: 'dense' },               // back garden round the lounge
  { poly: [[-14.0, 0.4], [-8.3, 0.4], [-8.3, 5.62], [-14.0, 5.62]], density: 0.26, mix: 'side', cover: 'dense' },                  // west side yard
  { poly: [[8.35, -0.78], [14.0, -0.78], [14.0, 5.62], [8.35, 5.62]], density: 0.24, mix: 'side', cover: 'dense' },               // east side yard
  { poly: [[-4.8, -7.7], [-1.0, -7.7], [-1.0, -6.3], [-4.8, -6.3]], density: .15, mix: 'front', cover: 'shell' },
  { poly: [[1.0, -7.6], [8.2, -7.6], [8.2, -6.3], [1.0, -6.3]], density: .18, mix: 'front', cover: 'shell' },

];
const rectPoly = (r) => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
export const AVOID = [...SHELL, ...PAVED.map(rectPoly)];   // nothing is centred inside these (AC units at y 0.55…2.45)
const MIX = {
  back: [['grassClump', 7], ['shrubGreen', 14], ['shrubGold', 12], ['coleus', 8], ['bromeliad', 12], ['bromeliadGreen', 8], ['croton', 12], ['banana', 9], ['palmFan', 6], ['cactusColumnar', 1]],
  side: [['grassClump', 8], ['shrubGreen', 24], ['shrubGold', 8], ['croton', 12], ['banana', 12], ['palmFan', 10], ['coleus', 6], ['bromeliad', 10]],
  front: [['bromeliadGreen', 14], ['croton', 8], ['shrubGreen', 12]],
  island: [['shrubGold', 10], ['croton', 14], ['bromeliad', 14], ['bromeliadGreen', 8], ['grassClump', 6], ['palmFan', 5], ['coleus', 6]],
};
const SPACING = { grassClump: 0.9, shrubGreen: 1.1, shrubGold: 1.1, coleus: 0.8, bromeliad: 0.55, bromeliadGreen: 0.55, croton: 0.9, banana: 1.6, palmFan: 1.9, cactusColumnar: 0.8, treeLarge: 2.0, treePine: 1.2, birdPaddle: 1.3, cordyline: .8, arecaClump: 1.8, muhlyFront: 1.3 };
export const FOOT = { grassClump: 0.35, shrubGreen: 0.45, shrubGold: 0.45, coleus: 0.5, bromeliad: 0.25, bromeliadGreen: 0.25, croton: 0.35, banana: 0.35, palmFan: 0.45, cactusColumnar: 0.2, treeLarge: 0.4, treePine: 0.3, birdPaddle: .35, cordyline: .25, arecaClump: .3, muhlyFront: .4 };   // ground footprint radius
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
export function edgeDist(x, y, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0] - ax, by = poly[i][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by || 1))); d = Math.min(d, Math.hypot(x - ax - bx * t, y - ay - by * t)); }
  return d;
}
// Can a plant with ground footprint radius r stand at (x, y)? Off paving and the house, centre off the shell, clear of the fences.
export function plantClear(x, y, r) {
  for (const b of PAVED) if (x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r) return false;
  for (const p of SHELL) if (inPoly(x, y, p) || edgeDist(x, y, p) < r * 0.5) return false;
  if (inPoly(x, y, GARDEN) && edgeDist(x, y, GARDEN) < 0.12 + r * 0.4) return false;
  return true;
}
const CANOPY = { banana: 1.0, palmFan: 0.8 };   // leaf spread that must stay outside the walls
export function generatePlanting(seed = 7) {
  const rnd = lcg(seed), out = [], placed = [];
  for (const p of PLACEMENTS) if (p.m === 'plants' && SPACING[p.i] && !inPoly(p.x, p.y, rectPoly(HOUSE_KEEP))) placed.push({ x: p.x, y: p.y, kind: p.i });
  for (const bed of BEDS) {
    const xs = bed.poly.map(p => p[0]), ys = bed.poly.map(p => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const area = (x1 - x0) * (y1 - y0), n = Math.round(area * bed.density);
    const mix = MIX[bed.mix], total = mix.reduce((a, m) => a + m[1], 0);
    let tries = 0;
    for (let k = 0; k < n && tries < n * 30; tries++) {
      const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
      let r = rnd() * total, kind = mix[0][0]; for (const [name, w] of mix) { if (r < w) { kind = name; break; } r -= w; }
      if (!inPoly(x, y, bed.poly) || !plantClear(x, y, FOOT[kind])) continue;
      const sp = SPACING[kind]; if (placed.some(q => Math.hypot(q.x - x, q.y - y) < (sp + SPACING[q.kind]) * 0.5)) continue;
      const i = CANOPY[kind] && SHELL.some(p => edgeDist(x, y, p) < CANOPY[kind]) ? 'croton' : kind;
      placed.push({ x, y, kind }); out.push({ m: 'plants', i, x: +x.toFixed(2), y: +y.toFixed(2), seed: 100 + out.length, ry: rnd() * Math.PI * 2, scale: 0.85 + rnd() * 0.4 }); k++;
    }
  }
  // tall canopy beyond the fences so the horizon reads as a leafy neighbourhood
  for (const [x, y, sd] of [[-6, 23, 1], [3, 24.5, 2], [11, 23, 3], [18, 14, 4], [-18, 12, 5], [-19, 26, 6], [17, -6, 7], [-17, -9, 8], [8, -25.5, 9], [-6, -26, 10]]) out.push({ m: 'plants', i: 'treeLarge', x, y, seed: sd, scale: 0.9 + (sd % 3) * 0.12 });
  for (const [x, y, sd] of [[-15.5, 20, 1], [15.8, 21, 2], [14, -24.5, 3], [-13.5, -25.5, 4], [16, 6, 5]]) out.push({ m: 'plants', i: 'palmFan', x, y, seed: sd, scale: 1.35 });
  return out;
}

// Keep the added foliage inside the road and lot, and outside the driveway.
function frontBounds(obj, p) {
  if (p.zone !== 'frontDense') return;
  obj.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(obj);
  let dx = Math.max(0, -14.25 - b.min.x) - Math.max(0, b.max.x - 14.25);
  if (p.gardenZone === 'palmBand' && p.x < 0) dx = Math.max(dx, -4.85 - b.min.x);
  const dy = Math.max(0, b.max.z - 14.05);
  if (dx || dy) { p.x = +(p.x + dx).toFixed(3); p.y = +(p.y + dy).toFixed(3); obj.position.set(p.x, p.h || 0, -p.y); }
}

// Foundation planting under the front bedroom windows: slide anything whose leaves cross the stucco face
// (x 3.97..8.03, y -6.0) back into the bed, with room for sway, so no foliage draws inside bedroom 3.
const BED3_FACE = { x0: 3.97, x1: 8.03, y: -6.0003 - 0.04 };
function bedroomFrontClearance(obj, p) {
  if (!['plants', 'flowers', 'props_garden'].includes(p.m) || p.y > BED3_FACE.y || p.y < -9 || p.x < 2.5 || p.x > 9.5) return;
  obj.updateMatrixWorld(true); const q = new THREE.Vector3(); let maxY = -Infinity;
  obj.traverse(m => {
    if (!m.isMesh || m.isInstancedMesh) return; const a = m.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { q.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); if (q.x > BED3_FACE.x0 && q.x < BED3_FACE.x1 && q.y < 2.7) maxY = Math.max(maxY, -q.z); }
  });
  if (maxY > BED3_FACE.y) { p.y = +(p.y - (maxY - BED3_FACE.y)).toFixed(3); obj.position.z = -p.y; }
}

// Correct only geometry that crosses edging, condensers or fences, after the
// seeded scatter is complete. No RNG calls/rejections: other plants stay put.
function plantClearance(obj, p) {
  if (!inPoly(p.x, p.y, GARDEN)) return;
  obj.updateMatrixWorld(true); const samples = [], q = new THREE.Vector3();
  obj.traverse(m => {
    if (!m.isMesh) return; const a = m.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { q.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); if (q.y >= 0 && q.y < 2.7) samples.push([q.x, -q.z, q.y]); }
  });
  const clear = (dx, dy) => samples.every(([px, py, h]) => {
    const x = px + dx, y = py + dy;
    if (h < 1.95 && (x < -14.08 || x > 14.08 || y > 19.08 || (p.x > 8.3 && y < -0.88))) return false;
    if (h < 0.92 && x > AC_UNITS.x0 - .03 && x < AC_UNITS.x1 + .03 && y > AC_UNITS.y0 - .03 && y < AC_UNITS.y1 + .03) return false;
    if (h < .14 && nearShell(x, y, .055)) return false;
    if (h > 2.43 && x > -8.85 && x < 8.85 && y > -6.7 && y < 6.34) return false;
    return true;
  });
  if (clear(0, 0)) return;
  const moves = [];
  for (let x = -30; x <= 30; x++) for (let y = -30; y <= 30; y++) moves.push([x * .05, y * .05]);
  moves.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  const move = moves.find(([x, y]) => clear(x, y));
  if (move) { p.x = +(p.x + move[0]).toFixed(3); p.y = +(p.y + move[1]).toFixed(3); obj.position.set(p.x, p.h || 0, -p.y); }
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
    const planting = generatePlanting(7), generated = new Set(planting);
    const all = PLACEMENTS.concat(STYLING_LIVING, STYLING_KITCHEN, STYLING_ROOMS, STYLING_GARDEN, STYLING_FLOWERS.filter(p => p.zone !== 'front' && p.zone !== 'island'), planting);
    for (const p of all) {
      k++; if (k % 20 === 0) { progress(0.5 + (k / all.length) * 0.5, p.i); await new Promise(r => setTimeout(r)); }
      const builder = mods[p.m]?.items?.[p.i]; if (!builder) { console.warn('missing item', p.m, p.i); continue; }
      let obj;
      try { obj = p.seed !== undefined ? builder(p.seed) : builder(); } catch (e) { console.error('build failed', p.m, p.i, e); continue; }
      if (p.zone === 'frontDense' && obj.userData.animate) { obj.userData.animate(0); delete obj.userData.animate; }
      obj.position.set(p.x, p.h || 0, -p.y); obj.rotation.y = p.ry || 0; if (p.sx) obj.scale.x = p.sx; if (p.sy) obj.scale.y *= p.sy; if (p.sz) obj.scale.z = p.sz; if (p.scale) obj.scale.multiplyScalar(p.scale);
      frontBounds(obj, p); bedroomFrontClearance(obj, p);
      if (generated.has(p)) plantClearance(obj, p);
      obj.userData.placement = p; if (p.zh) obj.userData.zh = p.zh; if (p.n) obj.userData.name = p.n;
      this.root.add(obj); this.placed.push(obj);
      if (obj.userData.seats?.length || obj.userData.movable || obj.userData.toggle) { obj.userData.interactiveRoot = true; this.interactive.push(obj); }
      if (obj.userData.movable) { this.movables.push(obj); }
      else if (obj.userData.collider) this.addFixedCollider(obj);
      if (obj.userData.animate) this.animated.push(obj);
      if (obj.userData.light && p.light !== false) this.addLight(obj, obj.userData.light);
      this.addMirrors(obj);
    }
    progress(1, 'done');
  }
  addFixedCollider(obj) {
    const c = obj.userData.collider; if (c.h !== undefined && c.h < 0.25) return;   // rugs, shades
    obj.updateMatrixWorld(true);
    const ry = obj.rotation.y, q = Math.round(ry / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ry - q) < 0.02) {
      const swap = Math.abs(Math.round(ry / (Math.PI / 2))) % 2 === 1;
      const cw = c.w * Math.abs(obj.scale.x), cd = c.d * Math.abs(obj.scale.z), w = swap ? cd : cw, d = swap ? cw : cd;
      const local = new THREE.Vector3(c.x, 0, c.z).applyMatrix4(obj.matrixWorld);
      addAABB(local.x - w / 2, local.x + w / 2, local.z - d / 2, local.z + d / 2, 'furn');
    } else { // rotated: use a bounding circle
      const local = new THREE.Vector3(c.x, 0, c.z).applyMatrix4(obj.matrixWorld);
      const r = Math.hypot(c.w * obj.scale.x, c.d * obj.scale.z) / 2 * 0.8; addAABB(local.x - r, local.x + r, local.z - r, local.z + r, 'furn');
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
    l.userData.base = l.intensity; if (spec.day !== undefined) l.userData.day = spec.day; this.fixtures.add(l); this.lightCount++;
  }
  // One reflection per cabinet, preserving the door seams and round mirror outline.
  addMirrors(obj) {
    this.mirrors ??= [];
    obj.updateMatrixWorld(true);
    const faces = [], inverse = obj.matrixWorld.clone().invert(), relative = new THREE.Matrix4();
    obj.traverse(m => {
      if (!m.isMesh || !(Array.isArray(m.material) ? m.material : [m.material]).some(mat => mat?.name === 'mirror')) return;
      m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox, parameters = m.geometry.parameters;
      let face;
      if (m.geometry.type === 'CylinderGeometry') {
        face = new THREE.CircleGeometry(parameters.radiusTop * 0.995, parameters.radialSegments).rotateX(-Math.PI / 2).translate(0, b.max.y + 0.001, 0);
      } else {
        face = new THREE.PlaneGeometry(b.max.x - b.min.x, b.max.y - b.min.y).translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z + 0.001);
      }
      faces.push(face.applyMatrix4(relative.multiplyMatrices(inverse, m.matrixWorld)));
    });
    if (!faces.length) return;
    const geometry = mergeGeometries(faces); faces.forEach(g => g.dispose());
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3()); geometry.translate(-center.x, -center.y, -center.z);
    const normal = new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, 0).normalize(), align = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 0, 1));
    geometry.applyQuaternion(align); geometry.computeBoundingBox();
    const r = createMirror(geometry); r.position.copy(center); r.quaternion.copy(align).invert(); obj.add(r); this.mirrors.push(r);
  }
  updateMirrors(camera, hq, renderer) { updateMirrors(this.mirrors, camera, hq, renderer); }
  prepareMirrors() { prepareMirrors(this.scene, this.mirrors, this.house); }
  warmMirrors(renderer) { warmMirrors(renderer, this.scene, this.mirrors); }
  animate(t) { for (const o of this.animated) if (!o.userData.swayFar) o.userData.animate(t); }
}
