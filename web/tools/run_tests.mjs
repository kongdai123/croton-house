// Test runner: build, then every web/tools/test_*.mjs (own process, parallel), test_package.py and bake/scripts/test_*.py.
// Usage: node tools/run_tests.mjs [--serial] [--timeout=SECONDS] [filter]
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const web = fileURLToPath(new URL('../', import.meta.url)), bake = join(web, '../bake/scripts');
const args = process.argv.slice(2), serial = args.includes('--serial');
const timeoutS = Number((args.find(a => a.startsWith('--timeout=')) || '').slice(10)) || 120;
const filter = args.find(a => !a.startsWith('--'));
const py = process.env.PYTHON || 'python3';

function run(name, cmd, argv, cwd) {
  return new Promise(resolve => {
    const t0 = Date.now(); let out = '', timedOut = false;
    const p = spawn(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutS * 1000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    p.on('error', e => { out += String(e); });
    p.on('close', code => { clearTimeout(timer); resolve({ name, ok: code === 0 && !timedOut, timedOut, code, out, ms: Date.now() - t0 }); });
  });
}

const t0 = Date.now();
const build = await run('build', process.execPath, ['tools/build.mjs'], web);
if (!build.ok) { console.log(build.out.trim().split('\n').slice(-20).join('\n')); console.log('FAIL build'); process.exit(1); }
console.log(`build ok (${(build.ms / 1000).toFixed(1)}s)`);

const jobs = [];
for (const f of readdirSync(join(web, 'tools')).filter(f => /^test_.*\.mjs$/.test(f)).sort()) jobs.push(['web/tools/' + f, process.execPath, [`tools/${f}`], web]);
jobs.push(['web/tools/test_package.py', py, ['tools/test_package.py'], web]);
for (const f of readdirSync(bake).filter(f => /^test_.*\.py$/.test(f)).sort()) jobs.push(['bake/scripts/' + f, py, [join(bake, f)], web]);
const todo = jobs.filter(j => !filter || j[0].includes(filter));

const results = [], queue = [...todo], width = serial ? 1 : Math.max(2, cpus().length);
await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
  while (queue.length) { const j = queue.shift(); results.push(await run(...j)); }
}));
results.sort((a, b) => a.name.localeCompare(b.name));
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(40)} ${(r.ms / 1000).toFixed(1)}s${r.timedOut ? `  TIMEOUT >${timeoutS}s` : ''}`);
const failed = results.filter(r => !r.ok);
for (const r of failed) console.log(`\n--- ${r.name} (exit ${r.code}) ---\n${r.out.trim().split('\n').slice(-25).join('\n')}`);
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
