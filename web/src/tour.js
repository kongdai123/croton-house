// Guided tour: a cinematic path through the house. Each stop flies in with ease-in-out (never parks: a slow push and drift
// during the hold), shows a bilingual caption, then moves on. T or any move key stops it.
import { THREE } from './kit.js';
import { t, getLang } from './ui.js';

const STOPS = [
  { x: 0.0, y: -11.5, heading: 0, pitch: 0.06, hold: 5, zh: '2513 Croton Ave · 1962 年的砌块房子，2025 年整体翻新', en: '2513 Croton Ave · a 1962 block house, fully renovated in 2025', drift: { yaw: 4, push: 1.2 } },
  { x: 0.0, y: -6.0, heading: 0, pitch: 0.08, hold: 4, zh: '前廊 · 两根铁艺柱，六十厘米的挑檐', en: 'The porch · two iron columns, a 60 cm eave', drift: { yaw: -6, push: 0.4 } },
  { x: 0.0, y: -3.6, heading: 0, pitch: 0.0, hold: 5, zh: '玄关 · 左手厨房，右手客厅，正前方是花园', en: 'Foyer · kitchen to the left, living room to the right, the garden straight ahead', drift: { yaw: 10, push: 0.6 } },
  { x: 0.8, y: -1.9, heading: 165, pitch: -0.03, hold: 5, zh: '手工打造的窗台座，整面松木板', en: 'The hand-built window seat in pine', drift: { yaw: -8, push: 0.5 } },
  { x: -0.3, y: -2.6, heading: 255, pitch: 0.0, hold: 5, zh: '开放式厨房 · 石英石中岛，黑色方砖，橡木吊灯', en: 'Open kitchen · quartz island, black tile, oak pendant', drift: { yaw: 12, push: 0.3 } },
  { x: 1.6, y: 0.6, heading: 5, pitch: 0.02, hold: 5, zh: '餐厅 · Y 椅与纸灯笼，书架坐凳靠墙', en: 'Dining · Wishbone chairs under the paper lantern, the bookcase bench on the wall', drift: { yaw: -10, push: 0.8 } },
  { x: -0.9, y: 2.3, heading: 350, pitch: 0.03, hold: 6, zh: '家庭室 · 三组落地玻璃门，二十英尺通长，正对后花园', en: 'Family room · three sets of glass doors, twenty feet wide, facing the garden', drift: { yaw: 6, push: 1.0 }, french: 1 },
  { x: 0.9, y: 7.4, heading: 20, pitch: 0.02, hold: 5, zh: '露台 · 无界的后花园', en: 'Patio · the borderless back garden', drift: { yaw: 25, push: 0.8 } },
  { x: 5.5, y: 11.2, heading: 70, pitch: -0.02, hold: 5, zh: '火盆与自制的木长凳', en: 'The fire pit and the lumber bench he built', drift: { yaw: -15, push: 0.5 } },
  { x: 1.0, y: 13.0, heading: 185, pitch: 0.05, hold: 6, zh: '黄昏 · 后院灯火', en: 'Dusk · backyard lights', drift: { yaw: 8, push: 0.6 }, dusk: true },
  { x: -3.9, y: 7.0, heading: 180, pitch: 0.0, hold: 4, zh: '主卧套房的小院', en: 'The primary suite courtyard', drift: { yaw: -8, push: 0.5 } },
  { x: -4.9, y: 3.5, heading: 80, pitch: -0.05, hold: 6, zh: '主卧 · 自制白蜡松木床，对着花园', en: 'Primary bedroom · the whitewashed bed he built, facing the garden', drift: { yaw: -10, push: 0.4 } },
  { x: 4.5, y: -0.2, heading: 185, pitch: 0.0, hold: 4, zh: '走廊 · 两间卧室，两个卫生间', en: 'The hall · two bedrooms, two baths', drift: { yaw: 6, push: 0.6 } },
  { x: 4.9, y: 4.8, heading: 120, pitch: -0.03, hold: 5, zh: '花园套房 B', en: 'Garden suite B', drift: { yaw: -10, push: 0.4 } },
  { x: 0.0, y: -3.0, heading: 0, pitch: 0.02, hold: 6, zh: '谢谢观看 · Studio Hu Dwelling', en: 'Thanks for visiting · Studio Hu Dwelling', drift: { yaw: 0, push: 1.2 } },
];
export class Tour {
  constructor(player, tour, points, ui, viewpoints) { this.player = player; this.ui = ui; this.viewpoints = viewpoints; this.active = false; this.i = 0; this.phase = 'idle'; this.t = 0; }
  toggle() { if (this.active) this.stop(); else this.start(); }
  start() { this.active = true; this.i = -1; this.phase = 'next'; this.t = 0; this.wasDusk = window.__app?.state.dusk; this.ui.toast(t('tourOn'), 3000); document.getElementById('btn-tour').classList.add('on'); this.next(); }
  stop() { this.active = false; this.phase = 'idle'; this.ui.setCaption(''); this.player.enabled = true; document.getElementById('btn-tour').classList.remove('on'); this.ui.toast(t('tourOff'), 1500); }
  next() {
    this.i++; if (this.i >= STOPS.length) { this.stop(); return; }
    const s = STOPS[this.i]; this.phase = 'fly';
    if (s.dusk && !window.__app.state.dusk) document.getElementById('btn-dusk').click();
    if (s.french) { const d = window.__app.scene; }
    this.viewpoints.goTo({ kind: 'tour', id: 'tour' + this.i, x: s.x, y: s.y, heading: s.heading, pitch: s.pitch }, { silent: true, duration: this.i === 0 ? 0.01 : 2.4, onDone: () => { this.phase = 'hold'; this.t = 0; this.base = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw }; this.ui.setCaption(`${getLang() === 'zh' ? s.zh : s.en}<small>${this.i + 1} / ${STOPS.length}</small>`); } });
  }
  update(dt) {
    if (!this.active) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].some(k => this.player.keys.has(k))) { this.stop(); return; }
    if (this.phase !== 'hold') return;
    const s = STOPS[this.i]; this.t += dt; const u = Math.min(1, this.t / s.hold);
    // never park: ease-in-out drift of yaw and a slow push forward
    const e = u * u * (3 - 2 * u);
    this.player.enabled = false;
    this.player.yaw = this.base.yaw + THREE.MathUtils.degToRad(s.drift.yaw) * e;
    const f = this.player.forward(); this.player.pos.x = this.base.x + f.x * s.drift.push * e; this.player.pos.z = this.base.z + f.z * s.drift.push * e;
    this.player.camera.position.set(this.player.pos.x, 1.5, this.player.pos.z); this.player.eye = 1.5;
    this.player.camera.rotation.set(0, 0, 0, 'YXZ'); this.player.camera.rotation.y = this.player.yaw; this.player.camera.rotation.x = this.player.pitch;
    if (u >= 1) { this.ui.setCaption(''); this.next(); }
  }
}
