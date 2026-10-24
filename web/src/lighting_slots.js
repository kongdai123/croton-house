// Pure slot policy: safe to exercise without three, a DOM or a GPU. The bake's side is bake/scripts/slots.py (the same
// sun, ev, autoExposure, wet and lamps; test_lighting_slots.mjs). lamps: the share of the lamps on by default (the shared
// lamps layer's level, the fallback without lamp groups).
export const SLOTS = {
  sunrise: { az: 58, el: 8, strength: 20, color: [1, 0.68, 0.45], skyColor: [0.42, 0.52, 0.72], ev: -0.7, autoExposure: { minEV: -0.5, maxEV: 5 }, wet: 1, lamps: 1 },
  noon: { az: 180, el: 57, strength: 36, color: [1, 0.95, 0.88], skyColor: [0.48, 0.65, 1], ev: -0.7, autoExposure: { minEV: -0.5, maxEV: 4.5 }, wet: 0, lamps: 0 },
  golden: { az: 255, el: 7, strength: 16, color: [1, 0.56, 0.28], skyColor: [0.55, 0.47, 0.65], ev: -0.55, autoExposure: { minEV: -0.5, maxEV: 5 }, wet: 0, lamps: 1 },
  dusk: { az: 263, el: -4, strength: 0, color: [1, 0.42, 0.2], skyColor: [0.18, 0.3, 0.6], ev: 3.1, autoExposure: { minEV: -0.5, maxEV: 3.5 }, wet: 0, lamps: 1 },
};
export const SLOT_ORDER = Object.keys(SLOTS);
export const validEncoding = e => ['slot', 'lamps'].every(k => Number.isFinite(e?.K?.[k]) && e.K[k] > 0);
export async function discoverSlots(base, manifest, fetcher = fetch) {
  // A packaged manifest is authoritative; never probe names excluded from that package.
  if (manifest && Object.keys(manifest).length) return SLOT_ORDER.filter(s => manifest[`v2/${s}/encoding.json`]);   // an empty manifest (dev checkout) means plain names: probe
  const results = await Promise.all(SLOT_ORDER.map(async s => {
    try { const r = await fetcher(`${base}/v2/${s}/encoding.json`); return r.ok && validEncoding(await r.json()); }
    catch { return false; }
  }));
  return SLOT_ORDER.filter((_, i) => results[i]);
}
export const initialSlot = (requested, available) => available.includes(requested) ? requested : 'sunrise';
export const nextSlot = (current, available) => {
  const ordered = SLOT_ORDER.filter(s => available.includes(s));
  return ordered[(ordered.indexOf(current) + 1) % ordered.length] ?? 'sunrise';
};
export function blendSlot(a, b, t) {
  const mix = (x, y) => x + (y - x) * t;
  const azDelta = ((b.az - a.az + 540) % 360) - 180;
  return { az: a.az + azDelta * t, el: mix(a.el, b.el), strength: mix(a.strength, b.strength),
    color: a.color.map((x, i) => mix(x, b.color[i])), ev: mix(a.ev, b.ev),
    autoExposure: { minEV: mix(a.autoExposure.minEV, b.autoExposure.minEV), maxEV: mix(a.autoExposure.maxEV, b.autoExposure.maxEV) },
    wet: mix(a.wet, b.wet), lamps: mix(a.lamps, b.lamps) };
}
// Latest request wins during loading. Once a fade starts it finishes before the next one starts.
// load() owns rollback; begin() resolves only when its complete transition is visible.
export function slotRequests({ available, current, load, begin, release }) {
  let desired = current, active = current, revision = 0, pending = null, disposed = false, reload = false;
  const request = (name, force = false) => {
    if (disposed || !available.includes(name)) return Promise.resolve(false);
    if (!pending && name === active && !force) return Promise.resolve(true);
    desired = name; revision++; reload ||= force;
    if (!pending) pending = (async () => {
      while (!disposed && (desired !== active || reload)) {
        const name = desired, rev = revision; reload = false;
        let data;
        try { data = await load(name); }
        catch (error) { if (!disposed && rev !== revision) continue; throw error; }
        if (disposed || rev !== revision) { release(data); continue; }
        try { await begin(data); } catch (e) { release(data); throw e; }
        active = name;
      }
      return !disposed;
    })().finally(() => { pending = null; });
    return pending;
  };
  return { request, get desired() { return desired; }, dispose() { disposed = true; } };
}
