// Pure reference for the GPU meter/adaptation equations; no renderer or DOM needed.
export const METER = { width: 64, height: 36, interval: 3, floor: 1e-5, ceiling: 60000 };
// brighten = exposure rises on entering darkness; darken = exposure falls in brighter light. The key (the level the meter's
// log mean is shown at) is the slot's: lighting_slots.js autoExposure.key.
export const ADAPTATION = { brighten: 0.8, darken: 0.4, ease: 0.12, teleport: 0.18, fastDuration: 0.6, meterTau: 0.2, deadBand: 0.1 };
export const autoExposureEnabled = query => !query.has('rawtone') && !query.has('fixedexposure') && !query.has('capture') && query.get('autoexp') !== '0';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
export function meterWeight(x, y) {
  const dx = (x - 0.5) * 2, dy = (y - 0.45) * 2;
  return (0.15 + 0.85 * Math.exp(-2 * (dx * dx + dy * dy))) * (1 - 0.85 * smooth((y - 0.7) / 0.25));
}
export function targetExposureEV(luminance, slot, indoor = 1) {
  const { key, minEV, maxEV } = slot.autoExposure;
  const ev = clamp(Math.log2(key / clamp(luminance, METER.floor, METER.ceiling)), slot.ev + minEV, slot.ev + maxEV);
  // Keep the garden's art-directed exposure, with a spatially smooth doorway boundary.
  return slot.ev + (ev - slot.ev) * clamp(indoor, 0, 1);
}
export function adaptExposureEV(current, target, dt, fast = false, settings = ADAPTATION) {
  const tau = fast ? settings.teleport : target > current ? settings.brighten : settings.darken;
  return current + (target - current) * -Math.expm1(-Math.max(0, dt) / tau);
}
// Exact integration of two cascaded exponentials. The second stage keeps the exposure's velocity
// continuous when a metering tick, slot limit or fast-adaptation flag changes the target/first tau.
export function glideExposureEV({ ev, drive }, target, dt, fast = false, settings = ADAPTATION) {
  dt = Math.max(0, dt);
  const tau = fast ? settings.teleport : target > drive ? settings.brighten : settings.darken;
  const a = Math.exp(-dt / tau), b = Math.exp(-dt / settings.ease);
  const coupling = Math.abs(tau - settings.ease) < 1e-6 ? a * dt / tau : tau * (a - b) / (tau - settings.ease);
  return { ev: target + (ev - target) * b + (drive - target) * coupling, drive: target + (drive - target) * a };
}
export const median3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
export function filterMeterLog(previous, sample, dt, fast = false, settings = ADAPTATION) {
  // No history (first reading) or a teleport: restart at the new view; the exposure glide supplies the smoothness.
  if (!previous || fast) return { raw: sample, older: sample, filtered: sample, held: sample };
  const median = median3(sample, previous.raw, previous.older);
  const filtered = previous.filtered + (median - previous.filtered) * -Math.expm1(-Math.max(0, dt) / settings.meterTau);
  // A soft dead zone avoids a 0.1 EV target jump when the threshold is crossed.
  const error = filtered - previous.held;
  const held = previous.held + Math.sign(error) * Math.max(0, Math.abs(error) - settings.deadBand);
  return { raw: sample, older: previous.raw, filtered, held };
}
