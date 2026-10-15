// Guided tour: a cinematic walk through the house. Each leg follows a collision-free route through the doorways (nav.js),
// holds with a slow push and drift (stopped short of walls), shows a bilingual caption, then moves on. T or a move key stops it.
import { THREE } from './kit.js';
import { t, getLang } from './ui.js';
import { getDoors } from './house.js';
import { setDoorOpen } from './viewpoints.js';
import { doorIsOpen } from './interact.js';
import { buildGrid, freeRun, freeSpot } from './nav.js';

const EYE = 1.58;
// Vetted at 1280 × 800, at eye height, with both ends of each hold in frame.
// Listing compositions: g04/06, g08, g15, g49, g52, g35, g33, g23, g39, g42/41, g43, g45.
// Positive drift.yaw turns LEFT (player yaw is the negative of plan heading).
// Front-yard stops are aerial (eye in metres): the planting screens the front door from the street on purpose.
const STOPS = [
  { x: -6, y: -22, heading: 22, pitch: -0.3, eye: 8, hold: 6, zh: '2513 Croton Ave · 1962 年的砌块房子，2025 年整体翻新', en: '2513 Croton Ave · a 1962 block house, fully renovated in 2025', drift: { yaw: 2, push: 1.2 } },
  { x: 4, y: -13.6, heading: 340, pitch: -0.42, eye: 6, hold: 5, zh: '前院 · 热带植物环绕抬高的露台，把入户门藏进绿意', en: 'The front garden · tropical planting around the raised terrace screens the front door', drift: { yaw: 2, push: 0.6 } },
  { x: 0.0, y: -3.8, heading: 0, pitch: -0.03, hold: 5, via: { x: 0.35, y: -9.3, heading: 0 }, zh: '玄关 · 厨房中岛与通向餐厅的开阔视线', en: 'Foyer · the kitchen island and the open view into the dining room', drift: { yaw: 1, push: 0.15 } },
  { x: 0.6, y: -1.3, heading: 151, pitch: -0.14, hold: 5, zh: '手工打造的窗台座，整面松木板', en: 'The hand-built window seat in pine', drift: { yaw: 1, push: 0.1 } },
  { x: 1.2, y: -2.8, heading: 280, pitch: -0.03, hold: 5, zh: '开放式厨房 · 石英石中岛，黑色方砖，橡木吊灯', en: 'Open kitchen · quartz island, black tile, oak pendant', drift: { yaw: 1, push: 0.1 } },
  { x: -4.2, y: -4.7, heading: 330, pitch: -0.1, hold: 5, zh: '车库 · 深巧克力色的墙，乒乓球桌，洗衣角', en: 'The garage · chocolate walls, ping-pong, the laundry nook', drift: { yaw: 1, push: 0.15 } },
  { x: -5.35, y: 4.95, heading: 125, pitch: -0.18, hold: 6, zh: '主卧 · 自制白洗松木平台床', en: 'Primary bedroom · the hand-built whitewashed pine platform bed', drift: { yaw: 1, push: 0.05 } },
  { x: 4.55, y: 1.3, heading: 180, pitch: -0.03, hold: 4, zh: '走廊 · 卧室入口与客厅里的窗台座', en: 'Hall · the bedroom doorway and a glimpse of the living-room window seat', drift: { yaw: 1, push: 0.15 } },
  { x: 6.0, y: -2.5, heading: 178, pitch: -0.22, hold: 5, zh: '卧室三 · 松木床旁的炭黑五斗柜', en: 'Bedroom three · the charcoal dresser beside the pine bed', drift: { yaw: 1, push: 0.05 } },
  { x: 4.6, y: 2.25, heading: 40, pitch: -0.12, hold: 5, zh: '花园套房 B · 相思木床，推拉门外是花园', en: 'Garden suite B · the acacia bed, the garden through the slider', drift: { yaw: 1, push: 0.05 } },
  { x: 0.65, y: 1.5, heading: 30, pitch: -0.06, hold: 5, zh: '餐厅 · Y 椅与纸灯笼，书架坐凳靠墙', en: 'Dining · Wishbone chairs under the paper lantern, the bookcase bench on the wall', drift: { yaw: 1, push: 0.05 } },
  { x: 1.17, y: 8.9, heading: 180, pitch: -0.06, hold: 6, zh: '露台回望家庭室 · 三组落地玻璃双开门', en: 'Looking back into the family room · three pairs of full-height glass doors', drift: { yaw: 0.5, push: 0 } },
  { x: 3.5, y: 6.5, heading: 350, pitch: -0.08, hold: 5, zh: '露台 · 无界的后花园', en: 'Patio · the borderless back garden', drift: { yaw: 1, push: 0.15 } },
  { x: 4.9, y: 14.5, heading: 230, pitch: -0.25, hold: 5, zh: '火盆与自制的木长凳', en: 'The fire pit and the lumber bench he built', drift: { yaw: 1, push: 0.1 } },
  { x: -1.4, y: 6.4, heading: 280, pitch: -0.3, hold: 5, zh: '主卧小院 · 石子地面、推拉门与热带植物', en: 'Primary courtyard · pebbles, the bedroom slider and tropical planting', drift: { yaw: 1, push: 0.1 } },
  { x: 3.5, y: 7.7, heading: 245, pitch: -0.06, hold: 6, zh: '黄昏 · 后院灯火', en: 'Dusk · backyard lights', bakedZh: '后院 · 晨光里的露台与花园', bakedEn: 'The backyard · the patio and garden in the morning light', drift: { yaw: 1, push: 0.1 }, dusk: true },
  { x: 0.0, y: 14.5, heading: 180, pitch: -0.02, hold: 6, zh: '谢谢观看 · Studio Hu Dwelling', en: 'Thanks for visiting · Studio Hu Dwelling', drift: { yaw: 0, push: 0.15 } },
];
export class Tour {
  constructor(player, tour, points, ui, viewpoints) {
    this.player = player; this.ui = ui; this.viewpoints = viewpoints; this.active = false; this.i = 0; this.phase = 'idle'; this.t = 0;
    // a language change mid-tour rewrites the caption on screen
    addEventListener('langchange', () => { if (this.active && this.phase === 'hold') this.showCaption(STOPS[this.i]); });
  }
  // Baked lighting keeps the tour in the morning light throughout; legacy lighting still ends at dusk.
  showCaption(s) {
    const morning = window.__app?.state.baked && s.bakedEn;
    this.ui.setCaption(`${getLang() === 'zh' ? (morning ? s.bakedZh : s.zh) : (morning ? s.bakedEn : s.en)}<small>${this.i + 1} / ${STOPS.length}</small>`);
  }
  toggle() { if (this.active) this.stop(); else this.start(); }
  start() {
    document.body.classList.add('touring'); this.ui.toggleLegends(false); this.ui.setLabel('');
    this.active = true; this.i = -1; this.phase = 'next'; this.t = 0; this.wasDusk = window.__app?.state.dusk;
    // Every door back to its resting state; flights open route doors ahead and close them behind.
    for (const d of getDoors()) if (d.kind === 'french' || d.pivot) setDoorOpen(d, !!d.openDefault);
    this.player.driven = true;
    this.ui.toast(t('tourOn'), 3000); document.getElementById('btn-tour').classList.add('on'); this.next();
  }
  stop() { document.body.classList.remove('touring'); this.ui.setLabel(''); this.active = false; this.phase = 'idle'; this.viewpoints.autoOpened?.clear(); this.ui.setCaption(''); this.player.enabled = true; this.player.driven = false; document.getElementById('btn-tour').classList.remove('on'); this.ui.toast(t('tourOff'), 1500); }
  next() {
    this.i++; if (this.i >= STOPS.length) { this.stop(); return; }
    const s = STOPS[this.i]; this.phase = 'fly';
    const st = window.__app.state;
    if (s.dusk && !st.baked && !st.dusk) this.ui.toggleDusk();   // legacy lighting keeps its dusk stop; baked stays as it is
    // `via`: come down from the previous aerial stop onto a ground spot first, then take the nav route
    if (s.via && STOPS[this.i - 1]?.eye) {
      this.viewpoints.goTo({ kind: 'tour', id: 'via' + this.i, eye: EYE, pitch: 0, ...s.via }, { silent: true, keepDriven: true, direct: true, duration: 3.4, onDone: () => { if (this.active) this.flyTo(s); } });
      return;
    }
    this.flyTo(s);
  }
  flyTo(s) {
    const spot = s.eye ? { x: s.x, z: -s.y } : freeSpot(buildGrid(this.player.extraColliders?.() ?? []), s.x, -s.y);
    this.viewpoints.goTo({ kind: 'tour', id: 'tour' + this.i, x: spot.x, y: -spot.z, heading: s.heading, pitch: s.pitch, eye: s.eye ?? EYE }, {
      silent: true, keepDriven: true, duration: this.i === 0 ? 0.01 : undefined, direct: !!s.eye,
      onDone: () => {
        if (!this.active) return;
        this.phase = 'hold'; this.t = 0;
        // drift forward only as far as the room allows
        const f = this.player.forward(), grid = buildGrid(this.player.extraColliders?.() ?? [], { doors: true });
        this.push = s.eye ? s.drift.push : freeRun(grid, this.player.pos.x, this.player.pos.z, f.x, f.z, s.drift.push, 0.25);
        this.base = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw };
        this.showCaption(s);
      },
    });
    // The route assumes fully open leaves. Give their 1.1 s swing time to finish before crossing,
    // including the garage door and the family-room doors; Viewpoints still closes them behind us.
    for (const c of this.viewpoints.fly?.doors ?? []) {
      if (!doorIsOpen(c.d)) {
        setDoorOpen(c.d, true);
        (this.viewpoints.autoOpened ??= new Set()).add(c.d);
      }
      c.opened = true;
    }
  }
  update(dt) {
    if (!this.active) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some(k => this.player.keys.has(k))) { this.stop(); return; }
    this.player.driven = true;
    if (this.phase !== 'hold') return;
    const s = STOPS[this.i]; this.t += dt; const u = Math.min(1, this.t / s.hold);
    // never park: ease-in-out drift of yaw and a slow push forward
    const e = u * u * (3 - 2 * u), p = this.player;
    p.enabled = false;
    const f0 = new THREE.Vector3(-Math.sin(this.base.yaw), 0, -Math.cos(this.base.yaw));
    p.yaw = this.base.yaw + THREE.MathUtils.degToRad(s.drift.yaw) * e;
    p.pos.x = this.base.x + f0.x * this.push * e; p.pos.z = this.base.z + f0.z * this.push * e;
    p.eye = s.eye ?? EYE;
    p.camera.position.set(p.pos.x, p.eye, p.pos.z);
    p.camera.rotation.set(0, 0, 0, 'YXZ'); p.camera.rotation.y = p.yaw; p.camera.rotation.x = p.pitch;
    if (u >= 1) { this.ui.setCaption(''); this.next(); }
  }
}
