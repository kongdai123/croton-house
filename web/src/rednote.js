// Studio Hu Dwelling's RedNote (小红书) posts about this house, each pinned to the spot in the model it was shot from.
import { t, getLang, esc } from './ui.js';

// Post links open only on RedNote itself (the data file is first-party; a javascript: or other URL never becomes a link).
const RN_URL = /^https:\/\/www\.xiaohongshu\.com\//;

// slug -> where to stand (plan x, y), heading (deg, 0 = north), pitch, and whether to switch to dusk.
const SPOTS = {
  '6ac5704700': { x: 2.15, y: 14.3, heading: 183, pitch: 0.2, eye: 1.4, img: 0, dusk: true, zh: '黄昏时从后花园看回房子', en: 'The house from the back garden at dusk' },
  '6a4b314b00': { x: 3.08, y: 3.05, heading: 7, pitch: -0.16, eye: 1.35, img: 0, zh: '从餐厅玻璃门旁看后花园', en: 'The garden through the dining-room doors' },
  '69ef572200': { x: -5, y: 2.15, heading: 23, pitch: -0.15, eye: 1, img: 0, zh: '床尾旁看向花园玻璃门', en: 'Beside the foot of the bed, toward the garden' },
  '69d2af8a00': { x: -5.25, y: 4.35, heading: 114, pitch: -0.15, eye: 1, img: 3, zh: '自制白蜡松木床 · 完工前', en: 'The whitewashed bed before furnishing' },
  '6ab7b98000': { x: 2.75, y: -2.6, heading: 180, pitch: -0.04, eye: 1.2, img: 0, zh: '客厅窗台座 · 正面近景', en: 'The living-room window seat, close frontal view' },
  '68f9b07600': { x: 1.7, y: -3.25, heading: 180, pitch: -0.3, eye: 0.8, img: 1, zh: '施工期窗台木板 · 近似视角', en: 'Construction sill detail; approximate view' },
  '6acbf22b00': { x: 0.85, y: 0.25, heading: 66, pitch: -0.05, eye: 1.5, img: 1, zh: '墙面凹龛 · 书架与小凳', en: 'Wall alcove with shelves and stool' },
  '69ec158300': { x: -2.3, y: 1.25, heading: 190, pitch: -0.06, eye: 1.6, img: 0, zh: '厨房过道看微波炉与黑板', en: 'The microwave and chalkboard from the kitchen aisle' },
  '6a02916b00': { x: 2.15, y: 14.3, heading: 183, pitch: 0.2, eye: 1.4, img: 0, dusk: true, zh: '后花园回望亮灯的房子', en: 'Looking back at the lit house from the garden' },
  '69fd344f00': { x: 3.08, y: 3.05, heading: 7, pitch: -0.16, eye: 1.35, img: 0, zh: '从室内门边看后花园', en: 'The garden viewed from inside the doorway' },
  '69e6b9b100': { x: 4.4, y: 9.25, heading: 0, pitch: -0.72, eye: 1.6, img: 0, zh: '低头看贝壳地面与植物', en: 'Looking down at shells and garden planting' },
  '6ab9bb8a00': { x: 1.5, y: -3.72, heading: 235, pitch: 0.05, eye: 0.8, img: 0, zh: '窗边悬挑柜 · 模型柜体不同', en: 'Window-side cantilever; the model cabinet differs' },
  '68ac5a3b00': { x: 6.1, y: -0.95, heading: 90, pitch: -0.2, eye: 1.4, img: 0, zh: '浴缸细部 · 模型为淋浴间', en: 'Tub detail; the model has a shower instead' },
};
export class RedNote {
  constructor(posts, ui, viewpoints) {
    this.posts = posts; this.ui = ui; this.viewpoints = viewpoints; this.panelOpen = false;
    addEventListener('langchange', () => { if (this.panelOpen) this.renderPanel(); });
  }
  blips() { return this.posts.filter(p => SPOTS[p.slug]).map(p => { const s = SPOTS[p.slug]; return { kind: 'rn', id: p.slug, x: s.x, y: s.y, heading: s.heading, title: p.title }; }); }
  spotOf(slug) { return SPOTS[slug] || null; }
  targetFor(slug) { const s = SPOTS[slug]; return s ? { kind: 'rn', id: slug, x: s.x, y: s.y, heading: s.heading, pitch: s.pitch, eye: s.eye, dusk: s.dusk } : null; }
  togglePanel() { if (this.panelOpen) { this.ui.closePanel(); this.panelOpen = false; return; } this.renderPanel(); }
  renderPanel() {
    const body = document.createElement('div'); const zh = getLang() === 'zh';
    const intro = document.createElement('p'); intro.style.cssText = 'margin:6px 8px 10px;color:#8a847a;font-size:12.5px'; intro.textContent = zh ? '他在小红书上记录了这栋房子的改造。每一篇都能走到拍摄的位置。' : 'He documented the remodel on RedNote. Every post can be visited from where it was shot.'; body.appendChild(intro);
    const sorted = [...this.posts].sort((a, b) => (b.time || 0) - (a.time || 0));
    for (const p of sorted) {
      const el = document.createElement('div'); el.className = 'post';
      const s = SPOTS[p.slug];
      const date = p.time ? new Date(p.time).toLocaleDateString(zh ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      el.innerHTML = `<h4>${esc(p.title)}</h4><div style="font-size:12px;color:#8a847a">${date}${s ? ' · ' + (zh ? s.zh : s.en) : ''}</div>${p.desc ? `<p>${esc(p.desc.replace(/#[^#\[]+\[话题\]#/g, '').trim())}</p>` : ''}`;
      if (p.video) { const v = document.createElement('video'); v.src = `assets/rednote/${p.video}`; v.controls = true; v.preload = 'metadata'; v.playsInline = true; v.poster = p.media[0] ? `assets/rednote/${p.media[0]}` : ''; el.appendChild(v); }
      else for (const m of p.media) { const img = document.createElement('img'); img.loading = 'lazy'; img.src = `assets/rednote/${m}`; el.appendChild(img); }
      if (RN_URL.test(p.url)) { const a = document.createElement('a'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = zh ? '在小红书打开 ↗' : 'Open on RedNote ↗'; el.appendChild(a); }
      if (s) { const b = document.createElement('button'); b.className = 'go'; b.textContent = t('goto'); b.onclick = () => { this.ui.closePanel(); this.panelOpen = false; this.go(p.slug); }; el.appendChild(document.createElement('br')); el.appendChild(b); }
      body.appendChild(el);
    }
    this.ui.openPanel(t('rednoteTitle'), body); this.panelOpen = true;
  }
  go(slug) { const pin = this.viewpoints.markers?.pins.find(p => p.kind === 'rn' && p.post.slug === slug); if (pin) { this.viewpoints.markers.activate({ pin }); return; } const tg = this.targetFor(slug); if (!tg) return; if (tg.dusk && !window.__app.state.dusk) this.ui.toggleDusk(); this.viewpoints.goTo(tg, { onDone: () => { const p = this.posts.find(q => q.slug === slug); const s = SPOTS[slug]; this.ui.toast(`${p.title} · ${getLang() === 'zh' ? s.zh : s.en}`, 3500); } }); }
}
