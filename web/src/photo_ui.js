// Photo mode panel: describe a mood in words or set it by hand, choose lens, quality and size, render, save.
// Frame the shot in the walkthrough first; the still is taken from the current eye. I opens and closes the panel.
import { getLang } from './ui.js';
import { DEFAULT_MOOD } from './sky.js';

const S = {
  zh: { title: '摄影', mood: '氛围', moodHint: '用一句话描述，例如：雨过天晴 早晨太阳刚升起 室内灯光柔和 室外半明半暗', apply: '应用', understood: '已理解', none: '没有识别到词语',
    live: '实时天空', sunriseRain: '雨后日出', noon: '正午', golden: '黄昏', blue: '蓝调', night: '夜晚',
    light: '光线', bearing: '太阳方位', height: '太阳高度', clouds: '云量', mist: '薄雾', wet: '湿润', lamps: '室内灯', ev: '曝光',
    lens: '相机', focal: '焦距', eye: '人眼', heightCam: '机位高度', tripod: '三脚架', level: '水平', free: '自由', focusLabel: '对焦', auto: '自动', manual: '手动', aperture: '光圈', pinhole: '全景深', film: '胶片质感', quality: '质量', preview: '预览', fine: '精细', final: '成片', size: '尺寸', screen: '屏幕', gpu: 'GPU', gentle: '温和', full: '全速',
    render: '渲染', stop: '停止', save: '保存 PNG', close: '关闭', ready: '构好图后点渲染', rendering: '渲染中', done: '完成', stopped: '已停止', preparing: '准备场景', snapshot: '收集场景', merge: '准备表面', bvh: '准备光路', upload: '加载场景', compile: '准备渲染' },
  en: { title: 'Photograph', mood: 'Mood', moodHint: 'Describe it, e.g. after the rain, sun just rising, soft lamps inside, half-lit outside', apply: 'Apply', understood: 'Understood', none: 'No words recognised',
    live: 'Live sky', sunriseRain: 'Sunrise after rain', noon: 'Noon', golden: 'Golden hour', blue: 'Blue hour', night: 'Night',
    light: 'Light', bearing: 'Sun bearing', height: 'Sun height', clouds: 'Clouds', mist: 'Mist', wet: 'Wet', lamps: 'Lamps', ev: 'Exposure',
    lens: 'Camera', focal: 'Focal length', eye: 'Eye', heightCam: 'Height', tripod: 'Tripod', level: 'Level', free: 'Free', focusLabel: 'Focus', auto: 'Auto', manual: 'Manual', aperture: 'Aperture', pinhole: 'Pinhole', film: 'Film look', quality: 'Quality', preview: 'Preview', fine: 'Fine', final: 'Final', size: 'Size', screen: 'Screen', gpu: 'GPU', gentle: 'Gentle', full: 'Full',
    render: 'Render', stop: 'Stop', save: 'Save PNG', close: 'Close', ready: 'Frame the shot, then render', rendering: 'Rendering', done: 'Done', stopped: 'Stopped', preparing: 'Preparing the scene', snapshot: 'Collecting the scene', merge: 'Preparing surfaces', bvh: 'Preparing light paths', upload: 'Loading the scene', compile: 'Preparing the render' },
};
const tr = k => (S[getLang()] ?? S.en)[k] ?? k;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const PRESETS = [
  ['live', null],
  ['sunriseRain', '雨过天晴 早晨太阳刚升起 室内灯光柔和 室外半明半暗'],
  ['noon', '中午 晴朗'],
  ['golden', '黄昏 室内灯光柔和'],
  ['blue', '蓝调 灯光明亮'],
  ['night', '夜 灯光明亮'],
];
// [key, mood path, min, max, step, format]
const SLIDERS = [
  ['bearing', 'sun.az', 0, 360, 1, v => `${Math.round(v)}°`],
  ['height', 'sun.el', -12, 80, 0.5, v => `${v.toFixed(1)}°`],
  ['clouds', 'clouds', 0, 1, 0.01, v => `${Math.round(v * 100)}%`],
  ['mist', 'mist', 0, 1, 0.01, v => `${Math.round(v * 100)}%`],
  ['wet', 'wet', 0, 1, 0.01, v => `${Math.round(v * 100)}%`],
  ['lamps', 'lamps', 0, 1, 0.01, v => `${Math.round(v * 100)}%`],
  ['ev', 'ev', -2, 2, 0.1, v => `${v > 0 ? '+' : ''}${v.toFixed(1)} EV`],
];
const QUALITY = { preview: 64, fine: 256, final: 1024 };
const SIZES = { screen: null, '2K': [2560, 1440], '4K': [3840, 2160] };
const APERTURES = [['pinhole', Infinity], ['f/11', 11], ['f/8', 8], ['f/4', 4], ['f/2', 2]];
const FOCALS = ['eye', '16', '22', '24', '35', '50'];

const get = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
const set = (o, path, v) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

export class PhotoUI {
  constructor({ photo, player, ui }) {
    Object.assign(this, { photo, player, ui });
    this.events = new AbortController(); const signal = this.events.signal;
    this.open = false; this.rendering = false;
    this.opts = { quality: 'fine', size: 'screen', gpu: 'gentle', aperture: 'f/8', film: true, focal: '24', mount: 'tripod', height: 1.35, level: 'level', focusMode: 'auto', focusDist: 5 };
    this.el = document.createElement('aside'); this.el.id = 'photo'; this.el.className = 'hidden';
    this.el.setAttribute('aria-labelledby', 'photoHead');
    (document.getElementById('hud') ?? document.body).appendChild(this.el);
    this.build();
    // keys typed into the panel stay in the panel
    this.el.addEventListener('keydown', e => { if (e.code !== 'Escape') e.stopPropagation(); }, { signal });
    this.el.addEventListener('pointerdown', e => e.stopPropagation(), { signal });
    // UI's canvas click handler requests pointer lock; an open photo panel owns the pointer.
    document.getElementById('gl')?.addEventListener('click', e => { if (this.open) e.stopImmediatePropagation(); }, { capture: true, signal });
    addEventListener('keydown', e => {
      if (e.code === 'Escape' && this.open) { e.preventDefault(); e.stopImmediatePropagation(); if (this.rendering) this.photo.stop(); else this.toggle(false); }
    }, { capture: true, signal });
    addEventListener('keydown', e => {
      if (e.code !== 'KeyI' || e.repeat || e.target?.closest?.('input, textarea, #photo')) return;
      if (!document.getElementById('title')?.classList.contains('hidden')) return;
      this.toggle();
    }, { signal });
    document.getElementById('btn-photo')?.addEventListener('click', () => { this.ui.toggleMedia?.(false); this.toggle(true); }, { signal });
    addEventListener('langchange', () => this.build(), { signal });
    this.resizePhoto = () => this.resize(); this.photo.onResize = this.resizePhoto;
  }

  resize() {
    this.photo.viewInset = this.open && innerWidth > 700 ? this.el.getBoundingClientRect().width : 0;
    this.photo.resize();
  }

  dispose() {
    this.events.abort(); this.photo.dispose(); this.rendering = false; this.open = false;
    if (this.photo.onResize === this.resizePhoto) this.photo.onResize = null;
    document.getElementById('btn-photo')?.classList.remove('on');
    document.body.classList.remove('photo-still'); this.el.remove();
  }

  toggle(on = !this.open) {
    if (!on && this.rendering) return;
    this.open = on; this.el.classList.toggle('hidden', !on);
    document.getElementById('btn-photo')?.classList.toggle('on', on);
    if (on) { this.player.unlock?.(); this.status(this.photo.supportError() ?? tr('ready')); this.lock(this.rendering); }
    else { this.photo.active = false; document.body.classList.remove('photo-still'); }
    this.resize();
  }

  build() {
    const mood = this.photo.mood;
    const seg = (name, items, current) => `<div class="ph-seg" data-name="${name}">${items.map(([k, label]) => `<button type="button" data-v="${k}" class="${k === current ? 'on' : ''}">${label}</button>`).join('')}</div>`;
    this.el.innerHTML = `
      <div class="ph-head"><h2 id="photoHead">${tr('title')}</h2><kbd>I</kbd><button type="button" class="ph-close" aria-label="${tr('close')}">×</button></div>
      <section><h3>${tr('mood')}</h3>
        <div class="ph-prompt"><input id="phPrompt" type="text" spellcheck="false" placeholder="${tr('moodHint')}" value="${esc(this.lastText ?? '')}"><button type="button" id="phApply">${tr('apply')}</button></div>
        <p class="ph-matched" id="phMatched">${esc(this.matchedText ?? '')}</p>
        <div class="ph-presets">${PRESETS.map(([k]) => `<button type="button" data-preset="${k}" class="${(this.preset ?? 'live') === k ? 'on' : ''}">${tr(k)}</button>`).join('')}</div>
      </section>
      <section class="ph-light ${mood ? '' : 'off'}"><h3>${tr('light')}</h3>
        ${SLIDERS.map(([k, path, min, max, step, fmt]) => { const v = get(mood ?? DEFAULT_MOOD, path) ?? 0; return `<label class="ph-row"><span>${tr(k)}</span><input type="range" data-path="${path}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${fmt(+v)}</output></label>`; }).join('')}
      </section>
      <section><h3>${tr('lens')}</h3>
        <h3>${tr('focal')}</h3>
        ${seg('focal', FOCALS.map(f => [f, f === 'eye' ? tr('eye') : `${f} mm`]), this.opts.focal)}
        <h3>${tr('heightCam')}</h3>
        ${seg('mount', [['eye', tr('eye')], ['tripod', tr('tripod')]], this.opts.mount)}
        <label class="ph-row"><span>${tr('tripod')}</span><input type="range" data-opt="height" min="0.4" max="2.2" step="0.05" value="${this.opts.height}"><output>${this.opts.height.toFixed(2)} m</output></label>
        ${seg('level', [['level', tr('level')], ['free', tr('free')]], this.opts.level)}
        <h3>${tr('aperture')}</h3>
        ${seg('aperture', APERTURES.map(([k]) => [k, k === 'pinhole' ? tr('pinhole') : k]), this.opts.aperture)}
        <h3>${tr('focusLabel')}</h3>
        ${seg('focusMode', [['auto', tr('auto')], ['manual', tr('manual')]], this.opts.focusMode)}
        <label class="ph-row"><span>${tr('manual')}</span><input type="range" data-opt="focusDist" min="0.5" max="25" step="0.1" value="${this.opts.focusDist}"><output>${this.opts.focusDist.toFixed(1)} m</output></label>
        ${seg('film', [['on', tr('film')], ['off', '—']], this.opts.film ? 'on' : 'off')}
      </section>
      <section><h3>${tr('quality')}</h3>
        ${seg('quality', Object.keys(QUALITY).map(k => [k, `${tr(k)} · ${QUALITY[k]}`]), this.opts.quality)}
        <h3>${tr('size')}</h3>
        ${seg('size', Object.keys(SIZES).map(k => [k, k === 'screen' ? tr('screen') : k]), this.opts.size)}
        <h3>${tr('gpu')}</h3>
        ${seg('gpu', [['gentle', `${tr('gentle')} · 30%`], ['full', tr('full')]], this.opts.gpu)}
      </section>
      <section class="ph-go">
        <div class="ph-bar"><b id="phBar"></b></div>
        <p class="ph-status" id="phStatus"></p>
        <div class="ph-actions"><button type="button" class="primary" id="phRender">${tr('render')}</button><button type="button" id="phStop" disabled>${tr('stop')}</button><button type="button" id="phSave" disabled>${tr('save')}</button></div>
      </section>`;
    const $ = s => this.el.querySelector(s);
    $('.ph-close').onclick = () => this.toggle(false);
    const apply = () => { const text = $('#phPrompt').value.trim(); if (!text) return; this.lastText = text; const r = this.photo.setMood(text); this.preset = null; this.matchedText = r.matched.length ? `${tr('understood')}: ${r.matched.join(' · ')}` : tr('none'); this.build(); };
    $('#phApply').onclick = apply;
    $('#phPrompt').addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'NumpadEnter') apply(); });
    for (const b of this.el.querySelectorAll('[data-preset]')) b.onclick = () => {
      const text = PRESETS.find(p => p[0] === b.dataset.preset)[1]; this.preset = b.dataset.preset;
      const r = this.photo.setMood(text); this.lastText = text ?? ''; this.matchedText = text ? `${tr('understood')}: ${r.matched.join(' · ')}` : ''; this.build();
    };
    for (const input of this.el.querySelectorAll('input[data-opt]')) input.oninput = () => { this.opts[input.dataset.opt] = +input.value; input.nextElementSibling.textContent = `${(+input.value).toFixed(input.dataset.opt === 'height' ? 2 : 1)} m`; };
    for (const input of this.el.querySelectorAll('input[data-path]')) input.oninput = () => {
      if (!this.photo.mood) this.photo.setMood({});
      const v = +input.value; set(this.photo.mood, input.dataset.path, v);
      if (input.dataset.path === 'wet') this.photo.mood.puddles = v * 0.7;
      this.preset = null; this.el.querySelector('.ph-light').classList.remove('off');
      input.nextElementSibling.textContent = SLIDERS.find(s => s[1] === input.dataset.path)[5](v);
    };
    for (const g of this.el.querySelectorAll('.ph-seg')) for (const b of g.querySelectorAll('button')) b.onclick = () => {
      const name = g.dataset.name, v = b.dataset.v; this.opts[name] = name === 'film' ? v === 'on' : v;
      for (const x of g.querySelectorAll('button')) x.classList.toggle('on', x === b);
    };
    $('#phRender').onclick = () => this.render();
    $('#phStop').onclick = () => this.photo.stop();
    $('#phSave').onclick = () => this.save();
    this.lock(this.rendering);
    if (this.lastResult) $('#phSave').disabled = false;
  }

  status(text) { const s = this.el.querySelector('#phStatus'); if (s) s.textContent = text; }
  lock(on) {
    for (const b of this.el.querySelectorAll('section:not(.ph-go) button, section:not(.ph-go) input')) b.disabled = on;
    const error = this.photo.supportError();
    this.el.querySelector('#phRender').disabled = on || !!error; this.el.querySelector('#phStop').disabled = !on; this.el.querySelector('#phSave').disabled = on || !this.lastResult;
    if (!on && error) this.status(error);
  }

  async render() {
    if (this.rendering) return;
    const error = this.photo.supportError(); if (error) { this.status(error); return; }
    this.rendering = true; this.lastResult = null; this.lock(true); this.status(tr('preparing'));
    const bar = this.el.querySelector('#phBar'); bar.style.transform = 'scaleX(0.02)';
    const samples = QUALITY[this.opts.quality], t0 = performance.now();
    let preparation = { stage: 'snapshot', progress: null };
    const showPreparation = () => {
      if (!preparation) return;
      const s = Math.floor((performance.now() - t0) / 1000);
      this.status(`${tr(preparation.stage)}${preparation.progress == null ? '' : ` · ${Math.round(preparation.progress * 100)}%`} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    };
    const preparationTimer = setInterval(showPreparation, 250);
    this.photo.size = SIZES[this.opts.size];
    this.photo.active = true;   // the walkthrough stops drawing; the canvas is the darkroom
    this.photo.viewInset = this.open && innerWidth > 700 ? this.el.getBoundingClientRect().width : 0;
    document.body.classList.add('photo-still');
    const lens = this.opts.film ? {} : { bloom: 0, ca: 0, vignette: 0, grain: 0, contrast: 1, saturation: 1 };
    const fStop = APERTURES.find(a => a[0] === this.opts.aperture)[1], o = this.opts;
    this.photo.camera_ = { focal: o.focal === 'eye' ? null : +o.focal, height: o.mount === 'tripod' ? o.height : null, level: o.level === 'level' };
    const focus = o.focusMode === 'manual' ? o.focusDist : null;
    try {
      const r = await this.photo.render({
        samples, fStop, focus, lens, duty: this.opts.gpu === 'gentle' ? 0.3 : 1,
        onPrepare: p => { preparation = p.stage === 'ready' ? null : p; showPreparation(); },
        onProgress: (f, n) => { bar.style.transform = `scaleX(${Math.max(0.02, Math.min(1, f))})`; const s = Math.round((performance.now() - t0) / 1000); this.status(`${tr('rendering')} · ${Math.floor(n)} / ${samples} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`); },
      });
      if (this.events.signal.aborted) return;
      this.lastResult = r.samples > 0 && r.presented !== false ? r : null;
      if (!this.lastResult) { this.photo.active = false; document.body.classList.remove('photo-still'); this.status(tr('stopped')); return; }
      const s = Math.round((performance.now() - t0) / 1000);   // the whole wait, as the progress line counted it
      const ci = this.photo.cameraInfo(); this.status(`${r.stopped ? tr('stopped') : tr('done')} · ${Math.floor(r.samples)} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${ci.focal} mm ${Number.isFinite(ci.fStop) ? 'f/' + ci.fStop : ''} · ${ci.height} m`);
      bar.style.transform = 'scaleX(1)';
    } catch (err) {
      console.warn('photo', err); this.status(String(err.message ?? err)); this.photo.active = false; document.body.classList.remove('photo-still');
    } finally { clearInterval(preparationTimer); this.rendering = false; if (!this.events.signal.aborted) this.lock(false); }
  }

  async save() {
    const blob = await this.photo.toBlob(); if (!blob) return;
    const a = document.createElement('a'), stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    a.href = URL.createObjectURL(blob); a.download = `croton-${stamp}.png`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
