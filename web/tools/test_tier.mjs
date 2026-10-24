// Tier from the GPU's name (src/tier.js classifyGpu) on real renderer strings (ANGLE on D3D11 / Metal / Vulkan, Firefox,
// Safari), and the adaptive start's decision and driver (src/start_quality.js) on simulated frame times.
//   node tools/test_tier.mjs
import { importSrc } from './harness/util.mjs';

const { classifyGpu, TIERS } = await importSrc('src/tier.js');
const { decide, createStartQuality, START } = await importSrc('src/start_quality.js');
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL ' + msg); } };

const cases = {
  hq: [
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)',
    'Apple M2 Ultra', 'Apple M4 Pro',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Ti (0x00001E04) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA NVIDIA GeForce RTX 2080 Ti (0x00001E04)), NVIDIA)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 SUPER (0x00001F06) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 3070 Laptop GPU/PCIe/SSE2',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 5090', 'NVIDIA GeForce RTX 3060',
    'NVIDIA RTX A4000', 'NVIDIA RTX 4000 Ada Generation', 'Quadro RTX 5000', 'NVIDIA TITAN RTX', 'NVIDIA GeForce GTX 1080 Ti', 'NVIDIA GeForce GTX 1080',
    'ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Radeon RX 7900 XTX', 'AMD Radeon RX 7600', 'AMD Radeon RX 9070 XT',
    'AMD Radeon RX 5700 XT', 'AMD Radeon RX 6600', 'AMD Radeon Pro W7800', 'Radeon VII',
    'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel(R) Arc(TM) B580 Graphics', 'Intel(R) Arc(TM) A580 Graphics',
  ],
  laptop: [
    'Apple GPU', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'Apple M3', '',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel(R) Iris(R) Xe Graphics', 'Intel(R) Arc(TM) Graphics',
    'Intel(R) Arc(TM) 140V GPU (16GB)', 'Intel(R) Arc(TM) A380 Graphics', 'AMD Radeon(TM) Graphics', 'AMD Radeon 780M', 'AMD Radeon RX 6500 XT', 'AMD Radeon RX 580 Series',
    'AMD Radeon RX 5500 XT', 'NVIDIA GeForce RTX 3050 Laptop GPU', 'NVIDIA GeForce RTX 2050', 'NVIDIA GeForce GTX 1660 SUPER', 'NVIDIA GeForce GTX 1070',
    'NVIDIA GeForce MX450', 'NVIDIA RTX A500 Laptop GPU', 'Radeon R9 200 Series', 'Mali-G78', 'Adreno (TM) 650',
  ],
  mobile: ['Google SwiftShader', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver'],
};
for (const [want, list] of Object.entries(cases)) for (const s of list) { const got = classifyGpu(s); check(got === want, `"${s}": ${got}, want ${want}`); }
check(Object.keys(cases).every(t => TIERS[t]), 'every class is a tier');

// the decision
const frames = (total, cpu = total * 0.3) => Array.from({ length: START.SAMPLES }, (_, i) => ({ total: total + (i % 3) * 0.2, cpu }));
check(decide('laptop', frames(5)) === 'hq', 'laptop, 5 ms frames: up to hq');
check(decide('laptop', frames(12)) === null, 'laptop, 12 ms frames: stays');
check(decide('laptop', frames(60)) === 'mobile', 'laptop, 60 ms frames waiting on the GPU: down to mobile');
check(decide('laptop', frames(60, 55)) === null, 'laptop, 60 ms frames spent on the CPU: stays (fewer effects would not help)');
check(decide('hq', frames(60)) === 'laptop', 'hq, 60 ms GPU-bound frames: down to laptop');
check(decide('hq', frames(14)) === null, 'hq, 14 ms frames: stays');
check(decide('hq', frames(40), 'laptop') === 'laptop' && decide('hq', frames(20), 'laptop') === null, 'a step up is handed back only over REVERT_MS');
check(decide('mobile', frames(3)) === null, 'mobile never moves');
const one = frames(5); one[0].total = 900;
check(decide('laptop', one) === 'hq', 'one hitch among the samples does not change the call');

// the driver: one step, a verified step up, never a third change
async function run(costs, tier = 'laptop', opts = {}) {
  const switches = []; let t = 0, current = tier;
  const q = createStartQuality({ tier, setTier: async name => { switches.push(name); current = name; }, now: () => t, ...opts });
  for (let i = 0; i < 2000; i++, t += 16.7) {
    q.begin(t);
    if (opts.pauseAt && i === opts.pauseAt) q.pause(t);
    if (q.wants(t)) { const total = costs(current, t); q.sample(total * 0.3, total, t); }
    await null;
  }
  return { switches, state: q.state };
}
{
  const r = await run(tier => (tier === 'laptop' ? 5 : 12));
  check(r.switches.join() === 'hq' && r.state.phase === 'done', `cheap laptop frames: one step to hq, kept (${r.switches})`);
}
{
  const r = await run(tier => (tier === 'laptop' ? 5 : 50));
  check(r.switches.join() === 'hq,laptop' && r.state.phase === 'done', `a step up that does not hold is handed back once (${r.switches})`);
}
{
  const r = await run(() => 12);
  check(!r.switches.length && r.state.phase === 'done', 'borderline frames: no change');
}
{
  const r = await run(() => 70, 'hq');
  check(r.switches.join() === 'laptop', `a known-hq GPU that is far too slow steps down once (${r.switches})`);
}
{
  const r = await run(() => 5, 'laptop', { enabled: false });
  check(!r.switches.length && r.state.phase === 'off', 'off: ?tier=, ?capture, ?adapt=0');
}
{
  let t = 0; const q = createStartQuality({ tier: 'laptop', setTier: async () => {}, now: () => t });
  q.begin(0); t = START.SETTLE_MS + 1; q.wants(t); q.cancel();
  check(!q.wants(t + 1000) && q.state.phase === 'done', 'J ends it');
}
{
  const r = await run(tier => (tier === 'laptop' ? 5 : 12), 'laptop', { pauseAt: 100 });
  check(r.switches.join() === 'hq', 'a pause (panorama, photo mode, hidden tab) restarts the window');
}

console.log(failed ? `${failed} failed` : `tier: ${Object.values(cases).flat().length} renderer strings classified, adaptive start decides once`);
process.exit(failed ? 1 : 0);
