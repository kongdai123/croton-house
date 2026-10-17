// Peak trace, guides, denoise, depth and PNG staging; leave room for the live walkthrough.
// Safari and Firefox do not report deviceMemory: assume a desktop's 8 GB unless the tier says phone.
export function photoSize(size, capabilities, tier, memory = tier === 'mobile' ? 4 : 8) {
  const budget = Math.min({ mobile: 160, laptop: 512, hq: 1024 }[tier] ?? 160, Math.max(64, memory * 128)) * 1024 * 1024;
  const max = Math.min(capabilities.maxTextureSize, capabilities.maxRenderbufferSize ?? Infinity);
  const [w, h] = size, scale = Math.min(1, max / Math.max(w, h), Math.sqrt(budget / (120 * w * h)));
  return [Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale))];
}
