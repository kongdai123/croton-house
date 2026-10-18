// UI smoke tests (gate d): the house in a real browser, driven through its own UI.
//   node tools/smoke/run.mjs [--headed] [--url=http://host:port] [--out=DIR] [--only=load,tour] [--list] [--gpu] [--timeout=SECONDS] [--no-build]
// Without --url it builds dist/ if missing and serves web/ itself on an ephemeral port. Mobile tier (quarter atlases), music off.
// Default is software WebGL2 (SwiftShader), as on a CI runner; --gpu uses whatever GPU the machine has.
// Failures leave <out>/<test>.png and <test>.txt (message and the page's recent console).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { parseArgs } from './helpers.mjs';
import { startServer } from './server.mjs';
import { TESTS } from './tests.mjs';
import { launch, Session, makeContext } from './session.mjs';

const web = fileURLToPath(new URL('../../', import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (args.list) { for (const t of TESTS) console.log(t.name); process.exit(0); }
const unknown = args.only.filter(n => !TESTS.some(t => t.name === n));
if (unknown.length) { console.error(`unknown test(s): ${unknown.join(', ')} (see --list)`); process.exit(2); }
const out = resolve(args.out); mkdirSync(out, { recursive: true });

if (!args.url && args.build && !existsSync(join(web, 'dist/app.js'))) {
  console.log('building dist/ ...');
  execFileSync(process.execPath, ['tools/build.mjs'], { cwd: web, stdio: 'inherit' });
}
const server = args.url ? null : await startServer({ root: web });
const base = args.url ?? server.url;
console.log(`smoke: ${base}${args.gpu ? ' (machine GPU)' : ' (SwiftShader)'}, artifacts in ${out}`);

const results = [];
let browser = null, session = null;
const withTimeout = (p, s, name) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`test '${name}' timed out after ${s}s`)), s * 1000); })]).finally(() => clearTimeout(t)); };
try {
  browser = await launch({ headed: args.headed, gpu: args.gpu });
  session = new Session({ browser, base });
  const ctx = makeContext(session, m => console.log(m));
  // the tests share the page that 'load' opens, so a selection of anything but 'legacy' brings 'load' along
  const needLoad = args.only.some(n => n !== 'legacy');
  const todo = TESTS.filter(t => !args.only.length || args.only.includes(t.name) || (needLoad && t.name === 'load'));
  let loadFailed = false;
  for (const test of todo) {
    const t0 = Date.now(), c0 = session.counts();
    let error = null;
    if (loadFailed && test.name !== 'legacy' && test.name !== 'load') error = new Error('skipped: the load test failed');
    else if (!ctx.page && test.name !== 'load' && test.name !== 'legacy') error = new Error("the page is not loaded (run 'load' first)");
    else {
      try {
        await withTimeout(test.run(ctx), test.timeoutS ?? args.timeoutS, test.name);
        const bad = session.since(c0);
        if (bad.length) throw new Error(`${bad.length} error(s) while the test ran:\n  ${bad.slice(0, 6).join('\n  ')}`);
      } catch (e) { error = e; }
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (error) {
      if (test.name === 'load') loadFailed = true;
      console.log(`FAIL ${test.name} (${secs}s): ${error.message}`);
      const stem = join(out, test.name);
      for (const [i, page] of session.pages.entries()) await page.screenshot({ path: `${stem}${i ? `-page${i}` : ''}.png`, timeout: 15000 }).catch(() => {});
      writeFileSync(`${stem}.txt`, `${error.stack || error.message}\n\nrecent console:\n${session.recent.slice(-60).join('\n')}\n`);
    } else console.log(`PASS ${test.name} (${secs}s)`);
    results.push({ name: test.name, ok: !error, seconds: +secs, error: error?.message ?? null });
  }
} catch (e) {
  console.log(`FAIL setup: ${e.stack || e}`);
  results.push({ name: 'setup', ok: false, seconds: 0, error: String(e.message || e) });
} finally {
  await session?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(f => f.name).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
