// Pure policy for the volumetric pass (volumetric.js): the participating media of each time slot, their crossfade, the
// phase function and the outdoor ambient light taken from the slot's sky. No three, DOM or GPU: tools/test_volumetric.mjs.
//
// Units: extinction / scattering coefficients in 1/m, heights in metres above the ground plane (y = 0).
// Outdoors: a haze everywhere plus a ground mist falling off exponentially with height; lit by the sun (through the PCSS
// sun depth) and by the sky; it also dims what lies behind it. Indoors: dust, lit only by the sun coming through the
// glass. Its in-scattering of the room's own light and its extinction of it nearly cancel (the room light is roughly
// the same in every direction), so only the sunbeam is added: no flat veil, no probe lookups leaking through walls.
// The Cycles references (bake/export/setup.py) fill the lot and the house with a 0.006 / m volume (anisotropy 0.65) at
// every slot; photo mode's after-rain mist is 0.0042 / m (sky.js, photo.js). Clean indoor air scatters far less (10-30
// ug/m3 of fine particles: ~1e-4 / m); the beams people photograph in rooms are dust lifted into the low sun. Measured
// on the site (sun-facing cameras in bedroom B and the office at sunrise): at 0.004 / m a beam adds ~7% to the wall
// behind it, below what reads in a photograph; at 0.03 / m ~55%, a bright shaft. Dust is 0.016 / m at the low sun: a
// beam reads toward the window, from the side it is faint, and nothing is added outside the sunlit air.
export const MEDIA = {
  // dawn after rain: ground mist in the garden (visibility ~300 m at the ground, scale height 3.5 m: 0.0045 / m in the
  // tree crowns, as the Cycles references' 0.006), dust in the low sun
  sunrise: { haze: 0.0018, mist: 0.011, mistHeight: 3.5, dust: 0.016 },
  // midday: a clear, light haze; the high sun draws short, subtle beams beside the windows
  noon: { haze: 0.0008, mist: 0, mistHeight: 2.5, dust: 0.006 },
  // evening: warmer, hazier air, long beams again
  golden: { haze: 0.0015, mist: 0.0015, mistHeight: 4, dust: 0.016 },
  // the sun is down (strength 0): only a faint sky-lit haze outdoors; the dust has no beam to show
  dusk: { haze: 0.0012, mist: 0.0015, mistHeight: 4, dust: 0.004 },
};
// Shared by every slot: scattering albedos and two-lobe Henyey-Greenstein phase functions (forward lobe g, broad lobe g,
// forward weight). Water droplets (~10 um) scatter strongly forward; mineral and fibre dust a little less, with a broad
// part so a beam seen from the side still shows. A single HG lobe at g 0.75 would make side-on beams 30x dimmer than
// beams seen toward the sun; with the broad lobe it is ~13x, as in photographs of sunbeams in rooms.
export const PHASE = { mist: [0.85, 0.3, 0.6], dust: [0.8, 0.0, 0.7] };
export const ALBEDO = { mist: 1, dust: 0.9 };
// Ground reflectance under the mist (wet paving, lawn, beds) for the ambient light from below.
export const GROUND_ALBEDO = 0.15;
export const MEDIA_KEYS = ['haze', 'mist', 'mistHeight', 'dust'];

export const mediumOf = name => MEDIA[name] ?? MEDIA.sunrise;
export function blendMedia(a, b, t) {
  const k = Math.min(1, Math.max(0, t)), out = {};
  for (const key of MEDIA_KEYS) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}
// The medium shown now: the current slot, or the crossfade toward the next one (lightmap_slots.js fading: same 1.5 s ease
// as the lightmaps, sky and sun).
export const mediumFor = (current, next = null, t = 0) => next ? blendMedia(mediumOf(current), mediumOf(next), t) : { ...mediumOf(current) };

// Henyey-Greenstein, normalised over the sphere (1/sr); mu = cosine between the view ray and the direction to the sun.
export function hg(mu, g) { const gg = g * g; return (1 - gg) / (4 * Math.PI * Math.pow(Math.max(1 + gg - 2 * g * mu, 1e-4), 1.5)); }
export const phase = (mu, [gf, gb, w]) => w * hg(mu, gf) + (1 - w) * hg(mu, gb);

// Outdoor ambient in-scattering (linear radiance) from an equirectangular sky in the HDRLoader layout (RGBA, row 0 at the
// zenith, flipY): the sphere's mean incoming radiance, the upper half from the sky and the lower half from the ground the
// sky and sun light (Lambert, GROUND_ALBEDO). The sun disc, if the panorama has one, is clipped to 20x the median so it
// does not count twice (the live sun is added separately). `decode` turns a stored value into a float (half floats).
export function skyAmbient(image, sun = { el: 0, strength: 0, color: [1, 1, 1] }, decode = v => v) {
  const { width: w, height: h, data } = image ?? {};
  if (!data || !w || !h) return null;
  const stride = Math.round(data.length / (w * h));
  if (stride < 3) return null;
  const rows = Math.max(1, Math.floor(h / 2)), stepX = Math.max(1, Math.floor(w / 256)), stepY = Math.max(1, Math.floor(rows / 64));
  const samples = [];
  for (let y = 0; y < rows; y += stepY) {
    const el = Math.PI / 2 - (y + 0.5) / h * Math.PI, solid = Math.cos(el);   // solid angle per texel ~ cos(elevation)
    for (let x = 0; x < w; x += stepX) {
      const i = (y * w + x) * stride, r = decode(data[i]), g = decode(data[i + 1]), b = decode(data[i + 2]);
      if (![r, g, b].every(Number.isFinite)) continue;
      samples.push([r, g, b, solid, Math.sin(el)]);
    }
  }
  if (!samples.length) return null;
  const lum = samples.map(s => 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]).sort((a, b) => a - b);
  const cap = Math.max(1e-6, lum[lum.length >> 1] * 20);
  const mean = [0, 0, 0], irr = [0, 0, 0]; let weight = 0, cosWeight = 0;
  for (const [r, g, b, solid, sinEl] of samples) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, k = l > cap ? cap / l : 1;
    mean[0] += r * k * solid; mean[1] += g * k * solid; mean[2] += b * k * solid; weight += solid;
    irr[0] += r * k * solid * sinEl; irr[1] += g * k * solid * sinEl; irr[2] += b * k * solid * sinEl; cosWeight += solid;
  }
  // E_sky on the ground = pi x (cosine-weighted mean radiance) over the hemisphere; with a uniform sky the cosine weight
  // averages 1/2, so E = 2 pi x mean(L sin el) over the hemisphere's solid angle.
  const sinSun = Math.max(0, Math.sin((sun.el ?? 0) * Math.PI / 180)), E = c => 2 * Math.PI * irr[c] / cosWeight + (sun.strength ?? 0) * (sun.color?.[c] ?? 1) * sinSun;
  return [0, 1, 2].map(c => 0.5 * (mean[c] / weight) + 0.5 * (GROUND_ALBEDO * E(c) / Math.PI));
}

// Which passes run: ?shafts / ?shafts=0 and ?taa / ?taa=0 override the tier's flag (tier.js). A value after ?taa is
// TAA's internal resolution scale (taa.js).
export function featureWanted(search, key, tierPreset) {
  const q = new URLSearchParams(search);
  if (q.has(key)) return q.get(key) !== '0';
  return !!tierPreset?.[key];
}
