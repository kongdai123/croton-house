// Browser side of the smoke suite: launches Chromium, opens pages with the app's console and errors collected, and gives the
// tests their context (ctx). Playwright is imported lazily so the helpers and the server stay usable without it.
import { classifyConsole } from './helpers.mjs';

// Software WebGL2 (SwiftShader) is what a GitHub runner has; --gpu leaves the choice to the machine, except on Linux,
// where headless Chromium's default ANGLE backend (GL, no display) loses or crashes the GPU process under the house's
// load (seen on the cluster's NVIDIA nodes): Vulkan there, as bake/validate/shoot.mjs uses.
export const SOFTWARE_GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const LINUX_GPU = ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--enable-gpu-rasterization'];

export async function launch({ headed = false, gpu = false } = {}) {
  const { chromium } = await import('playwright');
  const gpuArgs = ['--ignore-gpu-blocklist', ...(process.platform === 'linux' && !headed ? LINUX_GPU : [])];
  return chromium.launch({ headless: !headed, args: [...(gpu ? gpuArgs : SOFTWARE_GL), '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
}

export class Session {
  // slow: a factor on every wait a test asks for (ctx.until): software GL answers input in seconds, not frames
  constructor({ browser, base, query = 'tier=mobile', slow = 1 }) {
    this.browser = browser; this.base = base; this.query = query; this.slow = slow;
    this.pages = []; this.contexts = [];
    this.pageErrors = []; this.consoleErrors = []; this.patchWarnings = []; this.recent = [];
  }
  counts() { return { e: this.pageErrors.length, c: this.consoleErrors.length, p: this.patchWarnings.length }; }
  // what went wrong since counts() was taken
  since(c) {
    return [...this.pageErrors.slice(c.e).map(m => `page error: ${m}`), ...this.consoleErrors.slice(c.c).map(m => `console.error: ${m}`), ...this.patchWarnings.slice(c.p).map(m => `shader patch warning: ${m}`)];
  }
  async newPage(extraQuery = '') {
    const context = await this.browser.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1, acceptDownloads: false });
    await context.addInitScript(() => {
      try { localStorage.setItem('croton-music', '0'); localStorage.setItem('croton-lang', 'en'); } catch { /* storage blocked */ }
      // pointer lock is refused in headless runs; the player's lock() would reject. Mouse look is not under test.
      Element.prototype.requestPointerLock = function () { return Promise.resolve(); };
      addEventListener('unhandledrejection', e => console.error('unhandled rejection: ' + (e.reason?.stack || e.reason)));
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000 * this.slow);   // clicks and key presses wait for the page's main thread too
    const tag = `[page ${this.pages.length}]`;
    page.on('pageerror', e => { const m = String(e.stack || e.message || e); this.pageErrors.push(m); this.recent.push(`${tag} pageerror ${m}`); });
    page.on('crash', () => { this.pageErrors.push('the page crashed'); });
    page.on('console', msg => {
      const entry = { type: msg.type(), text: msg.text(), url: msg.location()?.url ?? '' };
      this.recent.push(`${tag} ${entry.type}: ${entry.text.slice(0, 300)}`); if (this.recent.length > 200) this.recent.shift();
      const kind = classifyConsole(entry);
      if (kind === 'error') this.consoleErrors.push(entry.text.slice(0, 500));
      else if (kind === 'patch') this.patchWarnings.push(entry.text.slice(0, 500));
    });
    this.pages.push(page); this.contexts.push(context);
    const q = [this.query, extraQuery.replace(/^\?/, '')].filter(Boolean).join('&');
    // a second page (legacy) loads while the first keeps drawing: under SwiftShader that takes more than a minute
    await page.goto(`${this.base}/index.html?${q}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
    return page;
  }
  async close() { for (const c of this.contexts) await c.close().catch(() => {}); }
}

// ctx handed to a test
export function makeContext(session, logLine) {
  const ctx = {
    session, page: null, base: session.base,
    log: m => logLine(`    ${m}`),
    expect(cond, message) { if (!cond) throw new Error(message); },
    async openMain() { ctx.page = await session.newPage(); return ctx.page; },
    openPage: extra => session.newPage(extra),
    async untilOn(page, fn, arg, timeout, what) {
      timeout *= session.slow;
      try { await page.waitForFunction(fn, arg, { timeout }); } catch (e) { throw new Error(`timed out after ${timeout / 1000}s waiting for ${what}`); }
    },
    until(fn, arg, timeout, what) { return ctx.untilOn(ctx.page, fn, arg, timeout, what); },
    frames: (n, page = ctx.page) => page.evaluate(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n),
  };
  return ctx;
}
