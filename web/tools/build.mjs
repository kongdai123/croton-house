// esbuild bundler: node tools/build.mjs [--watch]. Bundles src/main.js -> dist/app.js and src/showcase.js -> dist/showcase.js
import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
// ?tex=4k loads assets/tex/4k/ only when that directory holds images at build time (its extension is baked in); otherwise the 2k JPEGs.
const tex4k = (() => { try { return readdirSync('assets/tex/4k').map(f => f.match(/\.(jpg|webp|png)$/)?.[1]).find(Boolean) ?? null; } catch { return null; } })();
// Stamped into the stats-for-nerds panel: short commit, a + when the tree has local changes, and the build date.
const build = (() => { try { const sh = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); return `${sh('git rev-parse --short HEAD')}${sh('git status --porcelain') ? '+' : ''} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`; } catch { return 'unknown'; } })();
const watch = process.argv.includes('--watch');
const ctx = await esbuild.context({ entryPoints: { app: 'src/main.js', showcase: 'src/showcase.js' }, bundle: true, format: 'esm', outdir: 'dist', sourcemap: true, target: 'es2022', logLevel: 'info', define: { 'globalThis.CROTON_TEX_4K': JSON.stringify(tex4k), 'globalThis.CROTON_BUILD': JSON.stringify(build) }, minify: !watch && process.argv.includes('--min') });
if (watch) await ctx.watch(); else { await ctx.rebuild(); await ctx.dispose(); }
