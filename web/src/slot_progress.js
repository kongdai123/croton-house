// Count real completed requests (including split atlas parts and individual HDRs).
// The total grows as encoding/reflection metadata reveals more requests. Keep 100%
// for fully staged GPU data; downloading the last file alone does not start a fade.
export function createSlotProgress(onProgress = () => {}) {
  let loaded = 0, total = 0;
  const report = phase => onProgress(phase === 'staged' ? 1 : Math.min(0.99, total ? loaded / total : 0), { loaded, total, phase });
  return {
    async track(work) {
      total++; report('loading');
      try { return await work(); }
      finally { loaded++; report('loading'); }
    },
    finish() { report('staged'); },
  };
}
