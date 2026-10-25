// The live sun through a slot crossfade (lightmap.js setParams). The bake's two slots are blended as a dissolve (the
// lightmaps, sky, probes and reflections of both, mixed), and so is the sun: it dims out at the first slot's direction
// and comes up at the second's, like a cloud passing: RAMP of the blend to fade out, DARK without direct sun around the
// middle, RAMP to come up. Sweeping it from one direction to the other, as blendSlot's az/el do, moved it 100+ degrees
// in 1.5 s (sunrise to noon: up to 2 degrees a frame at 60 fps): long low-sun shadows raced across the garden at up to a
// metre a frame and the dappled ones of the trees strobed, every frame right for its own sun (a still of the same state
// matches it) and the sequence a flicker (docs/audit/postmortem.md, row 34). The sun's direction now changes once per crossfade,
// on a frame without direct sun, so the sun-shadow map is redrawn once instead of on every frame of the fade.
// Pure (no three, DOM or GPU): tools/test_sun_crossfade.mjs.
export const DARK = 0.05, RAMP = 0.4;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// mood: the blended slot parameters (blendSlot); from, to: the two slots' own; t: the fade's blend (0..1). Returns mood
// with the sun's direction, colour and strength of one end. Without a fade (from or to missing): mood unchanged.
export function crossfadeSun(mood, from, to, t) {
  if (!from || !to) return mood;
  const end = t < 0.5 ? from : to, d = Math.abs(t - 0.5) - DARK / 2;
  return { ...mood, az: end.az, el: end.el, color: end.color, strength: end.strength * smooth(0, RAMP, d) };
}
