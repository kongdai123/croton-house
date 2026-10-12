// HUD, panels, i18n (zh first), toasts, title screen, touch controls.
const DICT = {
  zh: { eyebrow: 'Studio Hu Dwelling · 小红书', sub: 'Sarasota, Florida · 花园住宅 · 3D 漫游', desc: '走进真实比例还原的 2513：客厅、厨房、卧室、后花园。可以坐在沙发和窗台上，拖动椅子，推开落地玻璃门，对照 Zillow 的照片和全景，以及小红书里的每一个取景点。', enter: '进入房子', hint: '鼠标看 · WASD 走 · 点击家具互动 · M 地图 · T 导览 · N 黄昏 · Esc 菜单', views: '取景点', rednote: '小红书', tour: '导览', dusk: '黄昏', maphint: '点击任意蓝/绿/红点传送 · M 关闭', comparehint: '拖动滑块对比实拍 · 空格 切换 · Esc 关闭', act: '互动',
    sit: '坐下', stand: '按任意方向键起身', grab: '拖动', open: '打开', close: '关上', door: '门', pano: '全景', photo: '照片', rnpost: '小红书', goto: '去这个取景点', loading: '加载中', ready: '准备好了', tourOn: '导览进行中 · 按 T 或移动结束', tourOff: '导览结束', duskOn: '黄昏 · 室内灯亮起', dayOn: '白天', locked: '点击画面开始', fly: '飞过去…', viewpointsTitle: 'Zillow 取景点', rednoteTitle: 'Studio Hu Dwelling 的小红书', 'Living room': '客厅', 'Kitchen': '厨房', 'Dining room': '餐厅', 'Office': '家庭室', 'Foyer': '玄关', 'Primary bedroom': '主卧', 'Primary bathroom': '主卫', 'Bedroom': '卧室', 'Bathroom': '卫生间', 'Hallway': '走廊', 'Patio': '露台', 'Backyard': '后花园', 'Front yard': '前院', 'Garage': '车库', seatHint: '坐下的高度 · 看看窗外' },
  en: { eyebrow: 'Studio Hu Dwelling · RedNote', sub: 'Sarasota, Florida · a garden house · 3D walkthrough', desc: 'Walk through 2513 at true scale: living room, kitchen, bedrooms, back garden. Sit on the sofa and the window seat, drag the chairs, open the glass doors, and compare every view with the Zillow photos, the 3D panoramas, and the RedNote posts.', enter: 'Enter the house', hint: 'Mouse to look · WASD to walk · click furniture · M map · T tour · N dusk · Esc menu', views: 'Viewpoints', rednote: 'RedNote', tour: 'Tour', dusk: 'Dusk', maphint: 'Click any blue/green/red dot to go there · M to close', comparehint: 'Drag to compare with the photo · Space to toggle · Esc to close', act: 'Use',
    sit: 'Sit', stand: 'Press any move key to stand', grab: 'Drag', open: 'Open', close: 'Close', door: 'Door', pano: 'Panorama', photo: 'Photo', rnpost: 'RedNote post', goto: 'Go to this viewpoint', loading: 'Loading', ready: 'Ready', tourOn: 'Tour running · T or move to stop', tourOff: 'Tour ended', duskOn: 'Dusk · lights on', dayOn: 'Daylight', locked: 'Click to look around', fly: 'Flying…', viewpointsTitle: 'Zillow viewpoints', rednoteTitle: 'Studio Hu Dwelling on RedNote', seatHint: 'Seated height · look out of the window' },
};
let lang = localStorage.getItem('croton-lang') || 'zh';
export const getLang = () => lang;
export const t = (k) => DICT[lang][k] ?? DICT.en[k] ?? k;
export function setLang(l) { lang = l; localStorage.setItem('croton-lang', l); document.documentElement.lang = l; for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n); document.getElementById('btn-lang').textContent = l === 'zh' ? 'EN' : '中文'; dispatchEvent(new Event('langchange')); }

export class UI {
  constructor(state) {
    this.state = state; this.title = document.getElementById('title'); this.enterBtn = document.getElementById('enter'); this.enterBtn.disabled = true;
    this.label = document.getElementById('label'); this.toastEl = document.getElementById('toast'); this.panel = document.getElementById('panel'); this.panelTitle = document.getElementById('panelTitle'); this.panelBody = document.getElementById('panelBody');
    this.caption = document.getElementById('caption');
    setLang(lang);
    document.getElementById('btn-lang').onclick = () => setLang(lang === 'zh' ? 'en' : 'zh');
    document.getElementById('panelClose').onclick = () => this.closePanel();
    this.toastTimer = 0;
  }
  progress(p, msg) { document.getElementById('loadbar').style.width = `${Math.round(p * 100)}%`; document.getElementById('loadtext').textContent = `${t('loading')} · ${msg} ${Math.round(p * 100)}%`; }
  ready() { this.enterBtn.disabled = false; document.getElementById('loadtext').textContent = t('ready'); }
  bind({ player, viewpoints, rednote, tour, minimap, toggleDusk, toggleQuality }) {
    this.player = player;
    const coarse = matchMedia('(pointer:coarse)').matches;
    this.enterBtn.onclick = () => { this.title.classList.add('hidden'); if (!coarse) player.lock(); };
    this.state.onLock = (locked) => { if (!locked && !this.panelOpen && !document.getElementById('bigmap').classList.contains('hidden') === false && !this.suppressTitle) { /* keep hud */ } };
    document.getElementById('btn-views').onclick = () => viewpoints.togglePanel();
    document.getElementById('btn-rednote').onclick = () => rednote.togglePanel();
    document.getElementById('btn-tour').onclick = () => tour.toggle();
    document.getElementById('btn-dusk').onclick = () => toggleDusk();
    document.getElementById('btn-quality').onclick = () => toggleQuality();
    document.getElementById('minimap').onclick = () => minimap.toggleBig();
    addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT') return;
      if (e.code === 'KeyM') minimap.toggleBig();
      if (e.code === 'KeyT') tour.toggle();
      if (e.code === 'KeyN') toggleDusk();
      if (e.code === 'KeyV') viewpoints.togglePanel();
      if (e.code === 'KeyR') rednote.togglePanel();
      if (e.code === 'KeyH') toggleQuality();
      if (e.code === 'Escape') { if (viewpoints.compareOpen) viewpoints.closeCompare(); else if (this.panelOpen) this.closePanel(); else if (!document.getElementById('bigmap').classList.contains('hidden')) minimap.toggleBig(); }
      if (e.code === 'Space') { e.preventDefault(); viewpoints.toggleCompare(); }
    });
    // click on canvas re-locks the pointer when a panel isn't open
    document.getElementById('gl').addEventListener('click', () => { if (!coarse && !this.title.classList.contains('hidden') === false && !player.locked && !viewpoints.compareOpen) player.lock(); });
    if (coarse) this.touchControls(player);
  }
  setLabel(text) { if (!text) { this.label.classList.remove('show'); return; } this.label.textContent = text; this.label.classList.add('show'); }
  toast(text, ms = 2200) { this.toastEl.textContent = text; this.toastEl.classList.add('show'); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms); }
  openPanel(title, bodyEl) { this.panelTitle.textContent = title; this.panelBody.replaceChildren(bodyEl); this.panel.classList.remove('hidden'); this.panelOpen = true; this.player?.unlock(); }
  closePanel() { this.panel.classList.add('hidden'); this.panelOpen = false; }
  setCaption(html) { if (!html) { this.caption.classList.add('hidden'); return; } this.caption.innerHTML = html; this.caption.classList.remove('hidden'); }
  touchControls(player) {
    const stick = document.getElementById('stick'), knob = document.getElementById('knob'), pad = document.getElementById('lookpad');
    let sid = null, sx = 0, sy = 0;
    stick.addEventListener('touchstart', (e) => { const tch = e.changedTouches[0]; sid = tch.identifier; sx = tch.clientX; sy = tch.clientY; }, { passive: true });
    stick.addEventListener('touchmove', (e) => { for (const tch of e.changedTouches) if (tch.identifier === sid) { const dx = (tch.clientX - sx) / 45, dy = (tch.clientY - sy) / 45; const l = Math.hypot(dx, dy) || 1, k = Math.min(1, l); player.touch = { x: dx / l * k, y: -dy / l * k }; knob.style.transform = `translate(${dx / l * k * 40}px, ${dy / l * k * 40}px)`; } }, { passive: true });
    const end = (e) => { for (const tch of e.changedTouches) if (tch.identifier === sid) { sid = null; player.touch = null; knob.style.transform = ''; } };
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
    let lid = null, lx = 0, ly = 0;
    pad.addEventListener('touchstart', (e) => { const tch = e.changedTouches[0]; lid = tch.identifier; lx = tch.clientX; ly = tch.clientY; }, { passive: true });
    pad.addEventListener('touchmove', (e) => { for (const tch of e.changedTouches) if (tch.identifier === lid) { player.yaw -= (tch.clientX - lx) * 0.005; player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch - (tch.clientY - ly) * 0.005)); lx = tch.clientX; ly = tch.clientY; } }, { passive: true });
    const lend = (e) => { for (const tch of e.changedTouches) if (tch.identifier === lid) lid = null; }; pad.addEventListener('touchend', lend); pad.addEventListener('touchcancel', lend);
    document.getElementById('touchAct').onclick = () => dispatchEvent(new CustomEvent('touchact'));
  }
}
