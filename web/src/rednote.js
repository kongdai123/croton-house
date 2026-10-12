// Studio Hu Dwelling's RedNote (小红书) posts about this house, each pinned to the spot in the model it was shot from.
import { t, getLang } from './ui.js';

// slug -> where to stand (plan x, y), heading (deg, 0 = north), pitch, and whether to switch to dusk.
const SPOTS = {
  '6ac5704700': { x: 0.9, y: 11.5, heading: 180, pitch: 0.05, dusk: true, zh: '黄昏时从后花园看回房子', en: 'From the back garden at dusk' },        // 花园住宅 (video)
  '6a4b314b00': { x: -0.6, y: 2.4, heading: 352, pitch: 0.03, zh: '家庭室里看向三组落地玻璃门', en: 'The three glass doors from the family room' },  // 无界的庭院 (video)
  '69ef572200': { x: -4.5, y: 3.5, heading: 300, pitch: -0.02, zh: '躺在床上看花园', en: 'From the bed toward the courtyard' },                 // 对着花园的床
  '69d2af8a00': { x: -4.9, y: 4.6, heading: 120, pitch: -0.08, zh: '自制白蜡松木床', en: 'The whitewashed bed frame he built' },             // white wash bedframe
  '6ab7b98000': { x: 2.2, y: -2.6, heading: 180, pitch: 0.0, zh: '窗台座 · 框出一处悠哉', en: 'The window seat, framing a lazy afternoon' },     // 窗前框出一处悠哉
  '68f9b07600': { x: 2.3, y: -3.9, heading: 175, pitch: -0.35, zh: '窗台木板细部', en: 'The solid-wood sill detail' },                     // 2513佛州住宅 (sill)
  '6acbf22b00': { x: 3.0, y: 2.6, heading: 85, pitch: -0.05, zh: '有深度的空腔', en: 'A niche with depth' },                            // 有深度的空腔
  '69ec158300': { x: -2.0, y: -3.0, heading: 262, pitch: 0.15, zh: '微波炉上的黑板', en: 'The chalkboard above the microwave' },         // 微波炉上的黑板
  '6a02916b00': { x: 2.5, y: 12.8, heading: 190, pitch: 0.04, dusk: true, zh: '后院灯火', en: 'Backyard lights at night' },                  // 后院灯火
  '69fd344f00': { x: 0.9, y: 6.3, heading: 10, pitch: 0.0, zh: '无界的后花园', en: 'The borderless back garden' },                       // 无界的后花园
  '69e6b9b100': { x: 1.4, y: 10.2, heading: 60, pitch: -0.4, zh: '后花园的贝壳和植物', en: 'Shells and plants in the garden' },           // 贝壳和植物
  '6ab9bb8a00': { x: 2.0, y: -7.2, heading: 20, pitch: 0.35, zh: '60 厘米悬挑，为了一点树影', en: '60 cm eave, for a little tree shadow' },   // 60厘米悬挑
  '68ac5a3b00': { x: 0.0, y: -8.5, heading: 0, pitch: 0.05, zh: '前院', en: 'Front yard' },
};
export class RedNote {
  constructor(posts, ui, viewpoints) {
    this.posts = posts; this.ui = ui; this.viewpoints = viewpoints; this.panelOpen = false;
    addEventListener('langchange', () => { if (this.panelOpen) this.renderPanel(); });
  }
  blips() { return this.posts.filter(p => SPOTS[p.slug]).map(p => { const s = SPOTS[p.slug]; return { kind: 'rn', id: p.slug, x: s.x, y: s.y, heading: s.heading, title: p.title }; }); }
  targetFor(slug) { const s = SPOTS[slug]; return s ? { kind: 'rn', id: slug, x: s.x, y: s.y, heading: s.heading, pitch: s.pitch, dusk: s.dusk } : null; }
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
      const a = document.createElement('a'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = zh ? '在小红书打开 ↗' : 'Open on RedNote ↗'; el.appendChild(a);
      if (s) { const b = document.createElement('button'); b.className = 'go'; b.textContent = t('goto'); b.onclick = () => { this.ui.closePanel(); this.panelOpen = false; this.go(p.slug); }; el.appendChild(document.createElement('br')); el.appendChild(b); }
      body.appendChild(el);
    }
    this.ui.openPanel(t('rednoteTitle'), body); this.panelOpen = true;
  }
  go(slug) { const tg = this.targetFor(slug); if (!tg) return; if (tg.dusk && !window.__app.state.dusk) document.getElementById('btn-dusk').click(); this.viewpoints.goTo(tg, { onDone: () => { const p = this.posts.find(q => q.slug === slug); const s = SPOTS[slug]; this.ui.toast(`${p.title} · ${getLang() === 'zh' ? s.zh : s.en}`, 3500); } }); }
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
