// esbuild bundler: node tools/build.mjs [--watch]. Bundles src/main.js -> dist/app.js and src/showcase.js -> dist/showcase.js
import * as esbuild from 'esbuild';
const watch = process.argv.includes('--watch');
const ctx = await esbuild.context({ entryPoints: { app: 'src/main.js', showcase: 'src/showcase.js' }, bundle: true, format: 'esm', outdir: 'dist', sourcemap: true, target: 'es2022', logLevel: 'info', minify: !watch && process.argv.includes('--min') });
if (watch) await ctx.watch(); else { await ctx.rebuild(); await ctx.dispose(); }
