// HUD, panels, i18n (zh first), toasts, title screen, touch controls.
const DICT = {
  zh: { compareAction: 'C · 对比实拍', panoAction: 'C · 进入全景', panos: '全景', photos: '照片', posts: '小红书', mapLegends: '地图图例', shown: '显示', hidden: '隐藏', showAll: '全部显示', hideAll: '全部隐藏', on: '开启', off: '关闭', highQuality: '高画质', petHelp: 'G 叫狗狗 · K 叫猫咪', touchPetHelp: '点「叫狗狗」或「叫猫咪」呼唤宠物', jump: '跳跃', controlsTitle: '教程', controlsFoot: '? 或 / 显示或收起 · Esc 关闭', photoCard: '点击卡片或按 C 对比实拍', panoCard: '点击卡片或按 C 进入 / 离开全景',
    lookHelp: '鼠标移动看四周 · 点击画面开始', walkHelp: 'WASD / 方向键行走 · Shift 快走', jumpHelp: '空格跳跃 · 坐下时按空格起身', useHelp: '点击 / E / F 互动：家具坐下，灯、窗帘、门等开关', dragHelp: '按住拖动家具 · 右键放回原处', pinsHelp: 'H 显示或隐藏全部图例 · 点击红 / 蓝 / 绿标记到取景点 · 在「地图图例」中开关', mapHelp: 'M 地图', tourHelp: 'T 导览 · 方向键退出', duskHelp: 'N 黄昏 / 白天', qualityHelp: 'J 画质', musicHelp: '♪ 背景音乐，两首轮流播放', musicCredit: '音乐：Oak Studios《Tuscany》。AIR《Mike Mills》原声版，由 Guillaume Edouard 分享并允许使用', compareHelp: 'C 对比照片 / 进入全景 · Q 退出', panelHelp: 'V 小红书标记 · R 小红书 · Esc 菜单 / 关闭',
    touchLookHelp: '右侧滑动看四周', touchWalkHelp: '左侧摇杆行走', touchJumpHelp: '点「跳跃」跳起 · 坐下时起身', touchUseHelp: '点「互动」坐下或切换灯、窗帘、门等', touchDragHelp: '对准标记或卡片，点「互动」查看实拍', touchMenuHelp: '点「地图图例」切换标记、黄昏和画质 · 顶栏导览和语言 · 点地图展开',
 place: '萨拉索塔 · 佛罗里达', lede: '以原有建筑为基础，不大拆大建：重组空间，重塑室内与室外的关系，让一座老住宅拥有新的生活。', figure: '书房 · 向庭院敞开的玻璃门',
    p1t: '光与白', p1: '白色、自然光、细格栅，与通透的空间界面。', p2t: '花园', p2: '庭院、露台与室内相连，花园成为生活的一部分。', p3t: '克制', p3: '有限的投入，更有辨识度的空间品质。', plan: '平面', credit: '由王天夫和朋友们制作', measure: '住宅尺度', enter: '进入住宅', warming: '正在准备房间…', warmCount: '光线与材质', warmingSub: '正在布置光线与材质，首次进入需要几秒钟。', fsKicker: '佛罗里达 萨拉索塔 · Studio Hu', fsI1: '一座 1962 年的砌块住宅，保留，而非推倒重来。', fsI2: '二十英尺的折叠玻璃门。打开，花园便成了客厅。', fsI3: '屋檐悬挑六十厘米，只为让树影照进来。', fsI4: '床、窗台、台面：松木与橡木，亲手制作。', fsSign: '三间卧室，一间书房，一座花园。地块 95 × 110 英尺。设计与建造：Studio Hu。', fsTitle: '第一步', fsLook: '移动鼠标，环顾四周', fsWalk: '走动', fsTour: '开始导览', fsViews: '显示视点：照片、全景、小红书', fsStart: '点击任意处开始 · 按 I 重新打开介绍 · 按 ? 查看全部操作', introHelp: 'I 打开或关闭介绍', introTip: '介绍 · I', statsForNerds: '详细统计信息', panoLoading: '全景加载中', panoDecoding: '全景准备中…', panoFailed: '全景加载失败，请重试', fsLookTouch: '右侧滑动 · 环顾四周', fsWalkTouch: '左下摇杆 · 走动', fsTourTouch: '点「导览」· 开始导览', fsViewsTouch: '在「地图图例」中显示视点', fsStartTouch: '点击任意处开始', hint: '鼠标看 · WASD 走 · 空格跳跃 · 点击互动 · ? 教程', views: '标记', rednote: '小红书', tour: '导览', dusk: '黄昏', maphint: '点击任意蓝/绿/红点传送 · M 关闭', comparehint: '拖动滑块对比实拍 · C 切换 · Q 退出', panoExit: '全景 · 按 Q 退出', compareExit: '实拍对比 · 按 Q 退出', quit: '退出', act: '互动',
    sitOrDrag: '点击坐下 · 按住拖动', putBack: '放回原处', putAll: '全部放回', nothingMoved: '还没有移动过任何家具', rightBack: '右键放回',
    sit: '坐下', stand: '按方向键或空格起身', grab: '拖动', open: '打开', close: '关上', door: '门', pano: '全景', photo: '照片', rnpost: '小红书', goto: '去这个取景点', loading: '加载中', ready: '准备好了', tourOn: '导览进行中 · 按 T 或移动结束', tourOff: '导览结束', duskOn: '黄昏 · 室内灯亮起', dayOn: '白天', locked: '点击画面开始', fly: '飞过去…', viewpointsTitle: '全景', rednoteTitle: 'Studio Hu Dwelling 的小红书', 'Living room': '客厅', 'Kitchen': '厨房', 'Dining room': '餐厅', 'Office': '家庭室', 'Foyer': '玄关', 'Primary bedroom': '主卧', 'Primary bathroom': '主卫', 'Bedroom': '卧室', 'Bathroom': '卫生间', 'Hallway': '走廊', 'Patio': '露台', 'Backyard': '后花园', 'Front yard': '前院', 'Garage': '车库', seatHint: '坐下的高度 · 看看窗外',
    callDog: '叫狗狗', callCat: '叫猫咪', petDog: '摸摸狗狗', petCat: '摸摸猫咪', dogNoReach: '狗狗过不来，从那边到不了你这里', catNoReach: '猫咪过不来，从那边到不了你这里', dogNoReachDoor: '狗狗过不来——有扇门关着', catNoReachDoor: '猫咪过不来——有扇门关着' },
  en: { compareAction: 'C · Compare photo', panoAction: 'C · Enter panorama', panos: 'Panoramas', photos: 'Photos', posts: 'RedNote', mapLegends: 'Map legends', shown: 'On', hidden: 'Off', showAll: 'Show all', hideAll: 'Hide all', on: 'On', off: 'Off', highQuality: 'High quality', petHelp: 'G call the dog · K call the cat', touchPetHelp: 'Tap Call the dog or Call the cat to summon a pet', jump: 'Jump', controlsTitle: 'Tutorial', controlsFoot: '? or / to show or hide · Esc to close', photoCard: 'Click the card or press C to compare', panoCard: 'Click the card or press C to enter / leave pano',
    lookHelp: 'Move the mouse to look · click the scene to start', walkHelp: 'WASD / arrows to walk · Shift to walk faster', jumpHelp: 'Space to jump · Space while seated to stand', useHelp: 'Click / E / F to use: sit on furniture, toggle lights, curtains, doors', dragHelp: 'Drag furniture to move · right-click to put it back', pinsHelp: 'H show or hide all legends · click red / blue / green pins to visit · toggle them in Map legends', mapHelp: 'M map', tourHelp: 'T tour · move to exit', duskHelp: 'N dusk / daylight', qualityHelp: 'J quality', musicHelp: '♪ background music, two songs in turn', musicCredit: 'Music: “Tuscany” by Oak Studios. AIR, “Mike Mills” (acoustic), shared for use by Guillaume Edouard', compareHelp: 'C compare photo / enter panorama · Q to exit', panelHelp: 'V RedNote pins · R RedNote · Esc menu / close',
    touchLookHelp: 'Swipe on the right to look', touchWalkHelp: 'Use the left joystick to walk', touchJumpHelp: 'Tap Jump to jump · stand when seated', touchUseHelp: 'Tap Use to sit or toggle lights, curtains, doors', touchDragHelp: 'Aim at a pin or card and tap Use to view the photo', touchMenuHelp: 'Use Map legends for pins, dusk and quality · top bar for tour and language · tap the map to expand',
 place: 'Sarasota, Florida', lede: 'Built on the house that was already there. Nothing torn down for its own sake: rooms reorganised, inside and outside reconnected, an old house given a new way of living.', figure: 'The office, glass doors open to the courtyard',
    p1t: 'Light & white', p1: 'White walls, daylight, fine mullions and open thresholds.', p2t: 'Garden', p2: 'Courtyard and terrace open from the rooms; the garden becomes part of the house.', p3t: 'Restraint', p3: 'Modest means, a distinct quality of space.', plan: 'Plan', credit: 'Made by Tianfu Wang and friends', measure: 'Measures of the house', enter: 'Enter the house', warming: 'Preparing the rooms…', warmCount: 'Light and materials', warmingSub: 'Setting up the light and materials. The first visit takes a few seconds.', fsKicker: 'Sarasota, Florida · Studio Hu', fsI1: 'A 1962 block house, kept rather than replaced.', fsI2: 'Twenty feet of folding glass. Opened, the garden becomes the living room.', fsI3: 'The overhang reaches out sixty centimetres, to let the shadows of the trees in.', fsI4: 'Bed, window seat, counters: pine and oak, made by hand.', fsSign: 'Three bedrooms, an office, a garden. Lot 95 × 110 ft. Design and build: Studio Hu.', fsTitle: 'First steps', fsLook: 'Look around with the mouse', fsWalk: 'Walk around', fsTour: 'Take the guided tour', fsViews: 'Show viewpoints: photos, panoramas, RedNote', fsStart: 'Click anywhere to start · I for this introduction · ? for all controls', introHelp: 'I show or hide the introduction', introTip: 'Introduction · I', statsForNerds: 'Stats for nerds', panoLoading: 'Loading panorama', panoDecoding: 'Preparing panorama…', panoFailed: 'The panorama did not load. Please try again.', fsLookTouch: 'Swipe on the right to look around', fsWalkTouch: 'Use the stick, bottom left, to walk', fsTourTouch: 'Tap Tour for the guided tour', fsViewsTouch: 'Show viewpoints from Map legends', fsStartTouch: 'Tap anywhere to start', hint: 'Mouse to look · WASD to walk · Space to jump · click to interact · ? tutorial', views: 'Pins', rednote: 'RedNote', tour: 'Tour', dusk: 'Dusk', maphint: 'Click any blue/green/red dot to go there · M to close', comparehint: 'Drag to compare with the photo · C to toggle · Q to exit', panoExit: 'Panorama · press Q to exit', compareExit: 'Photo comparison · press Q to exit', quit: 'Exit', act: 'Use',
    sitOrDrag: 'Click to sit · drag to move', putBack: 'Put back', putAll: 'Put everything back', nothingMoved: 'Nothing has been moved', rightBack: 'right-click to put back',
    sit: 'Sit', stand: 'Move or press Space to stand', grab: 'Drag', open: 'Open', close: 'Close', door: 'Door', pano: 'Panorama', photo: 'Photo', rnpost: 'RedNote post', goto: 'Go to this viewpoint', loading: 'Loading', ready: 'Ready', tourOn: 'Tour running · T or move to stop', tourOff: 'Tour ended', duskOn: 'Dusk · lights on', dayOn: 'Daylight', locked: 'Click to look around', fly: 'Flying…', viewpointsTitle: 'Pano', rednoteTitle: 'Studio Hu Dwelling on RedNote', seatHint: 'Seated height · look out of the window',
    callDog: 'Call the dog', callCat: 'Call the cat', petDog: 'Pet the dog', petCat: 'Pet the cat', dogNoReach: "The dog can't reach you from there", catNoReach: "The cat can't reach you from there", dogNoReachDoor: "The dog can't reach you — a door is closed", catNoReachDoor: "The cat can't reach you — a door is closed" },
};
let lang = localStorage.getItem('croton-lang') || 'en';
export const getLang = () => lang;
export const t = (k) => DICT[lang][k] ?? DICT.en[k] ?? k;
export function setLang(l) { lang = l; localStorage.setItem('croton-lang', l); document.documentElement.lang = l; for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n); for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle); document.getElementById('btn-lang').textContent = l === 'zh' ? 'EN' : '中文'; for (const b of document.querySelectorAll('[data-lang]')) b.classList.toggle('on', b.dataset.lang === l); dispatchEvent(new Event('langchange')); }
// Landing plan drawing: walls solid, openings cut out, windows as a single glazing line; scale bar and north mark.
function drawPlan(h) {
  const svg = document.getElementById('lcPlan'); if (!svg) return;
  const [vx, vy, vw, vh] = h.viewBox, p = 0.3;
  svg.setAttribute('viewBox', `${vx - p} ${-(vy + vh) - p} ${vw + 2 * p} ${vh + 2 * p + 0.9}`);
  const rect = (o, c) => `<rect class="${c}" x="${o.x0}" y="${-o.y1}" width="${o.x1 - o.x0}" height="${o.y1 - o.y0}"/>`;
  // the garage block is built outside house.json: west + front walls with the 8' door, porch-side jamb
  const garage = [{ x0: -8.018, x1: -7.903, y0: -5.85, y1: 1.481 }, { x0: -8.018, x1: -6.92, y0: -5.85, y1: -5.735 }, { x0: -4.48, x1: -3.393, y0: -5.85, y1: -5.735 }, { x0: -3.507, x1: -3.393, y0: -5.85, y1: -4.72 }];
  let s = h.walls.concat(garage).map(w => rect(w, 'w')).join('');
  s += '<path class="v" d="M-0.95 -1.9 L-1.75 -3.6 L-0.15 -3.6 Z"/><circle class="vp" cx="-0.95" cy="-1.9" r="0.22"/>';   // where the landing photo looks from
  for (const o of h.openings) {
    s += rect(o, 'o');
    if (o.kind !== 'window') continue;
    const mx = (o.x0 + o.x1) / 2, my = -(o.y0 + o.y1) / 2;
    s += o.dir === 'H' ? `<line class="g" x1="${o.x0}" x2="${o.x1}" y1="${my}" y2="${my}"/>` : `<line class="g" x1="${mx}" x2="${mx}" y1="${-o.y1}" y2="${-o.y0}"/>`;
  }
  const by = -vy + 0.75;
  s += `<rect class="sb" x="${vx}" y="${by}" width="5" height="0.07"/><rect class="sb" x="${vx}" y="${by - 0.12}" width="0.04" height="0.19"/><rect class="sb" x="${vx + 4.96}" y="${by - 0.12}" width="0.04" height="0.19"/>`;
  s += `<text x="${vx + 5.25}" y="${by + 0.16}">5 m</text><text x="${vx + vw - 0.35}" y="${by + 0.16}">N ↑</text>`;
  svg.innerHTML = s;
}

export class UI {
  constructor(state) {
    this.state = state; this.title = document.getElementById('title'); this.enterBtn = document.getElementById('enter'); this.enterBtn.disabled = true;
    this.label = document.getElementById('label'); this.toastEl = document.getElementById('toast'); this.panel = document.getElementById('panel'); this.panelTitle = document.getElementById('panelTitle'); this.panelBody = document.getElementById('panelBody');
    this.controls = document.getElementById('controls'); this.helpOpen = false;
    document.getElementById('controlsClose').onclick = () => this.toggleHelp(false);
    addEventListener('langchange', () => { this.renderHelp(); this.syncLegends(); });
    this.caption = document.getElementById('caption');
    setLang(lang);
    new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${Math.ceil(document.getElementById('topbar').getBoundingClientRect().height)}px`)).observe(document.getElementById('topbar'));
    document.getElementById('btn-lang').onclick = () => setLang(lang === 'zh' ? 'en' : 'zh');
    for (const b of document.querySelectorAll('[data-lang]')) b.onclick = () => setLang(b.dataset.lang);
    fetch('data/house.json').then(r => r.json()).then(drawPlan).catch(() => {});
    document.getElementById('panelClose').onclick = () => this.closePanel();
    this.toastTimer = 0;
  }
  // The bar only moves forward and stops at 99% while loading; 100% belongs to ready(), the same moment Enter turns on.
  progress(p) {
    if (this.isReady) return;
    const pct = Math.min(99, Math.max(this.pct ?? 0, Math.floor(p * 100)));
    if (pct === this.pct) return;
    this.pct = pct;
    document.getElementById('loadbar').style.width = `${pct}%`; document.getElementById('loadtext').textContent = `${t('loading')} · ${pct}%`;
  }
  ready() {
    const bar = document.getElementById('loadbar');
    this.isReady = true; this.pct = 100;
    if (bar) { bar.style.transition = 'none'; bar.style.width = '100%'; }
    const text = document.getElementById('loadtext');
    if (text) text.textContent = t('ready');
    const btn = document.getElementById('enter');
    this.enterBtn = btn || this.enterBtn;
    if (this.enterBtn) { this.enterBtn.disabled = false; this.enterBtn.removeAttribute('disabled'); }
  }
  bind({ player, viewpoints, rednote, markers, tour, minimap, pets, toggleDusk, toggleQuality }) {
    this.player = player; this.viewpoints = viewpoints; this.rednote = rednote; this.markers = markers; this.toggleDusk = toggleDusk; this.toggleQuality = toggleQuality;
    const coarse = matchMedia('(pointer:coarse)').matches;
    this.enterBtn.onclick = () => { this.title.classList.add('hidden'); if (localStorage.getItem('croton-music') !== '0') setMusic(true); if (!this.firstStepsShown) { this.firstStepsShown = true; this.showFirstSteps(coarse); } else if (!coarse) player.lock(); };
    this.state.onLock = (locked) => { if (!locked && !this.panelOpen && !document.getElementById('bigmap').classList.contains('hidden') === false && !this.suppressTitle) { /* keep hud */ } };
    for (const [kind, id] of [['rn', 'btn-views'], ['pano', 'btn-panos'], ['photo', 'btn-photos']]) {
      document.getElementById(id).onclick = () => markers.toggle(kind);
    }
    document.getElementById('btn-legends').onclick = () => this.toggleLegends();
    for (const [id, on] of [['legends-show', true], ['legends-hide', false]]) document.getElementById(id).onclick = () => { for (const kind of ['rn', 'pano', 'photo']) markers.toggle(kind, on); };
    document.getElementById('legend-dusk').onclick = toggleDusk;
    document.getElementById('legend-quality').onclick = toggleQuality;
    this.syncLegends();
    document.addEventListener('pointerdown', e => { if (this.legendsOpen && !document.getElementById('legends').contains(e.target)) this.toggleLegends(false); }, { capture: true });
    document.getElementById('btn-help').onclick = () => this.toggleHelp();
    // The address in the top-left corner reopens the introduction (same as I).
    document.getElementById('brand').onclick = () => { if (this.firstStepsOpen) this.closeFirstSteps(false); else this.showFirstSteps(coarse); };
    document.getElementById('btn-zillow').onclick = () => viewpoints.togglePanel('pano');
    document.getElementById('btn-photolist').onclick = () => viewpoints.togglePanel('photo');
    document.getElementById('btn-rednote').onclick = () => rednote.togglePanel();
    document.getElementById('btn-dusk').onclick = toggleDusk;
    const music = document.getElementById('bgm'), musicBtn = document.getElementById('btn-music');
    const tracks = ['assets/audio/tuscany.m4a', 'assets/audio/mike-mills.m4a'];
    let track = 0;
    music.volume = 0.45;
    const playTrack = (i) => { track = (i + tracks.length) % tracks.length; if (!music.src.endsWith(tracks[track])) music.src = tracks[track]; return music.play(); };
    const setMusic = (on) => { localStorage.setItem('croton-music', on ? '1' : '0'); musicBtn.classList.toggle('on', on); musicBtn.setAttribute('aria-pressed', String(on)); if (on) playTrack(track).catch(() => musicBtn.classList.remove('on')); else music.pause(); };
    music.addEventListener('ended', () => { if (musicBtn.classList.contains('on')) playTrack(track + 1).catch(() => musicBtn.classList.remove('on')); });
    musicBtn.onclick = () => setMusic(!musicBtn.classList.contains('on'));
    document.getElementById('btn-tour').onclick = () => tour.toggle();
    for (const [name, id] of [['dog', 'btn-calldog'], ['cat', 'btn-callcat']]) { const b = document.getElementById(id); if (!b) continue; if (pets?.get(name)) b.onclick = () => pets.call(name); else b.hidden = true; }
    document.getElementById('minimap').onclick = () => minimap.toggleBig();
    addEventListener('keydown', e => { if (e.code === 'Escape') { e.crotonMenu = document.getElementById('ctxmenu')?.classList.contains('hidden') === false; e.crotonLegends = !!this.legendsOpen; } }, { capture: true });
    addEventListener('keydown', (e) => {
      if ((e.target?.tagName === 'INPUT' && e.target.type !== 'range') || ['TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable) return;
      if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
      if (e.key === '?' || e.key === '/' || e.code === 'Slash') { e.preventDefault(); if (this.title.classList.contains('hidden')) this.toggleHelp(); return; }
      if (e.code === 'Escape' && e.crotonLegends) { this.toggleLegends(false); document.getElementById('btn-legends').focus(); return; }
      if (['KeyG', 'KeyK'].includes(e.code) && this.title.classList.contains('hidden') && !this.helpOpen) { const name = e.code === 'KeyG' ? 'dog' : 'cat'; if (pets?.get(name)) pets.call(name); }
      if (e.code === 'KeyM') minimap.toggleBig();
      if (e.code === 'KeyT') tour.toggle();
      if (e.code === 'KeyN') toggleDusk();
      if (e.code === 'KeyV') markers.toggle();
      if (e.code === 'KeyR') rednote.togglePanel();
      if (e.code === 'KeyH' && this.title.classList.contains('hidden')) { const kinds = ['rn', 'pano', 'photo']; const on = !kinds.every(k => markers.enabled[k]); for (const kind of kinds) markers.toggle(kind, on); }
      if (e.code === 'KeyJ') toggleQuality();
      if (e.code === 'KeyI' && this.title.classList.contains('hidden') && !this.helpOpen) { if (this.firstStepsOpen) this.closeFirstSteps(false); else this.showFirstSteps(coarse); }
      if (e.code === 'Escape') { if (e.crotonMenu) return; if (this.helpOpen) this.toggleHelp(false); else if (viewpoints.panoActive) viewpoints.exitPano(); else if (viewpoints.compareOpen) viewpoints.closeCompare(); else if (this.panelOpen) this.closePanel(); else if (minimap.bigOpen) minimap.toggleBig(); else { this.title.classList.toggle('hidden'); player.unlock(); } }
      if (e.code === 'Space') { e.preventDefault(); if (this.title.classList.contains('hidden') && !this.helpOpen) player.jump(); }
      if (e.code === 'KeyC' && !this.helpOpen) viewpoints.toggleCompare();
      if (e.code === 'KeyQ') { viewpoints.exitPano(); viewpoints.closeCompare(); }
    });
    // click on canvas re-locks the pointer when a panel isn't open
    document.getElementById('gl').addEventListener('click', () => { if (!coarse && !this.title.classList.contains('hidden') === false && !player.locked && !viewpoints.compareOpen && !this.helpOpen && !this.panelOpen && !this.legendsOpen && !minimap.bigOpen) player.lock(); });
    if (coarse) this.touchControls(player);
  }
  syncLegends() {
    if (!this.markers) return;
    for (const [kind, id] of [['rn', 'btn-views'], ['pano', 'btn-panos'], ['photo', 'btn-photos']]) this.legendState(id, this.markers.enabled[kind], 'shown', 'hidden');
    this.legendState('legend-dusk', this.state.dusk);
    const duskBtn = document.getElementById('btn-dusk'); duskBtn.classList.toggle('on', !!this.state.dusk); duskBtn.setAttribute('aria-pressed', String(!!this.state.dusk));
    this.legendState('legend-quality', this.state.quality === (this.state.qualityHigh ?? 'hq'));
  }
  legendState(id, on, yes = 'on', no = 'off') {
    const b = document.getElementById(id), s = b.querySelector('.legend-state');
    b.setAttribute('aria-pressed', String(on)); s.dataset.i18n = on ? yes : no; s.textContent = t(s.dataset.i18n);
  }
  toggleLegends(on = !this.legendsOpen) {
    this.legendsOpen = on; document.getElementById('legendsPanel').classList.toggle('hidden', !on); document.getElementById('btn-legends').setAttribute('aria-expanded', String(on));
    if (on) { this.syncLegends(); this.player?.unlock(); }
  }
  renderHelp() {
    const keys = matchMedia('(pointer:coarse)').matches ? ['touchLookHelp', 'touchWalkHelp', 'touchJumpHelp', 'touchUseHelp', 'touchDragHelp', 'pinsHelp', 'touchPetHelp', 'touchMenuHelp'] : ['lookHelp', 'walkHelp', 'jumpHelp', 'useHelp', 'dragHelp', 'pinsHelp', 'mapHelp', 'tourHelp', 'introHelp', 'duskHelp', 'qualityHelp', 'musicHelp', 'petHelp', 'compareHelp', 'panelHelp'];
    const body = document.getElementById('controlsBody'); body.replaceChildren();
    for (const key of keys) { const row = document.createElement('div'); row.textContent = t(key); body.appendChild(row); }
    const credit = document.createElement('div'); credit.className = 'music-credit'; credit.append(t('musicCredit'), ' · ');
    const link = document.createElement('a'); link.href = 'https://www.youtube.com/watch?v=8uxzIVzzeVg'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'YouTube';
    credit.append(link); body.appendChild(credit);
  }
  // First steps: a pop-up over the first view with the four essentials. It sits in the HUD, under the loading screen,
  // so it appears with the first frame. A click anywhere closes it (on the scene or the box it also starts mouse look);
  // T, H, WASD, arrows, Space and ? close it and still do their usual thing; Escape only closes it.
  showFirstSteps(coarse) {
    const box = document.getElementById('firststeps'), canvas = document.getElementById('gl'), warming = document.getElementById('warming');
    if (!box || this.firstStepsOpen) return;
    // Reopened with I mid-walk: free the cursor so the cards can be read; a click closes them and looks again.
    this.player?.unlock();
    box.classList.toggle('touch', coarse); box.classList.remove('hidden'); this.firstStepsOpen = true;
    const keys = ['KeyT', 'KeyH', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash'];
    const close = (lock) => {
      if (!this.firstStepsOpen) return;
      this.firstStepsOpen = false; box.classList.add('hidden');
      removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true);
      if (lock && !coarse) this.player.lock();
    };
    this.closeFirstSteps = close;
    const onKey = (e) => {
      if (!this.title.classList.contains('hidden')) return;
      if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(false); }
      else if (keys.includes(e.code) || e.key === '?') close(false);
    };
    const onDown = (e) => {
      if (!this.title.classList.contains('hidden') || (warming && !warming.classList.contains('hidden'))) return;
      if (e.target.closest?.('#brand')) return;   // the brand button toggles it itself
      close(e.target === canvas || box.contains(e.target));
    };
    addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onDown, true);
  }
  toggleHelp(on = !this.helpOpen) {
    this.helpOpen = on; this.controls.classList.toggle('hidden', !on); document.getElementById('btn-help').classList.toggle('on', on); document.getElementById('btn-help').setAttribute('aria-pressed', String(on));
    if (on) { this.toggleLegends(false); this.renderHelp(); this.player?.unlock(); } else localStorage.setItem('croton-controls-dismissed', '1');
  }
  setLabel(text) { if (!text) { this.label.classList.remove('show'); return; } this.label.textContent = text; this.label.classList.add('show'); }
  toast(text, ms = 2200) { this.toastEl.textContent = text; this.toastEl.classList.add('show'); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms); }
  openPanel(title, bodyEl) { this.toggleLegends(false); this.closePanel(); this.panelTitle.textContent = title; this.panelBody.replaceChildren(bodyEl); this.panel.classList.remove('hidden'); this.panelOpen = true; this.player?.unlock(); }
  closePanel() { this.panel.classList.add('hidden'); this.panelOpen = false; if (this.viewpoints) { this.viewpoints.panelOpen = false; this.viewpoints.panelKind = ''; } if (this.rednote) this.rednote.panelOpen = false; }
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
    document.getElementById('touchJump').onclick = () => player.jump();
    document.getElementById('touchAct').onclick = () => dispatchEvent(new CustomEvent('touchact'));
  }
}
