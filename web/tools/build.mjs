// esbuild bundler: node tools/build.mjs [--watch]. Bundles the application, showcase and photo workers into dist/.
import * as esbuild from 'esbuild';
import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
// ?tex=4k loads assets/tex/4k/ only when that directory holds images at build time (its extension is baked in); otherwise the 2k JPEGs.
const tex4k = (() => { try { return readdirSync('assets/tex/4k').map(f => f.match(/\.(jpg|webp|png)$/)?.[1]).find(Boolean) ?? null; } catch { return null; } })();
// Stamped into the stats-for-nerds panel: short commit, a + when the tree has local changes, and the build date.
const build = (() => { try { const sh = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); return `${sh('git rev-parse --short HEAD')}${sh('git status --porcelain') ? '+' : ''} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`; } catch { return 'unknown'; } })();
const watch = process.argv.includes('--watch');
// esbuild does not bundle new URL(worker, import.meta.url). Emit the installed 0.9.4 worker explicitly,
// and redirect its wrapper to the sibling output. Keep all existing application entry points intact.
const photoWorkers = {
  name: 'photo-workers',
  setup(build) {
    build.onLoad({ filter: /\/GenerateMeshBVHWorker\.js$/ }, async ({ path }) => {
      const source = readFileSync(path, 'utf8');
      const from = "new URL( './generateMeshBVH.worker.js', import.meta.url )";
      if (!source.includes(from)) throw new Error('Review GenerateMeshBVHWorker URL bundling for the installed version.');
      return { contents: source.replace(from, "new URL( './photo-bvh-worker.js', import.meta.url )"), loader: 'js' };
    });
    build.onResolve({ filter: /^photo-merge-worker$/ }, () => ({ path: 'photo-merge-worker', namespace: 'photo-worker' }));
    build.onLoad({ filter: /.*/, namespace: 'photo-worker' }, () => ({
      loader: 'js', resolveDir: process.cwd(), contents: `
        import { BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
        import { StaticGeometryGenerator } from 'three-gpu-pathtracer/src/core/utils/StaticGeometryGenerator.js';
        import { updateMaterialIndexAttribute } from 'three-gpu-pathtracer/src/core/utils/GeometryPreparationUtils.js';
        self.onmessage = ({ data }) => {
          try {
            const geometries = data.geometries.map(g => {
              const out = new BufferGeometry(); out.uuid = g.uuid;
              for (const [key, a] of Object.entries(g.attributes)) out.setAttribute(key, new BufferAttribute(a.array, a.itemSize, a.normalized));
              if (g.index) out.setIndex(new BufferAttribute(g.index, 1));
              out.groups = g.groups; return out;
            });
            const materials = new Map();
            const meshes = data.meshes.map(m => {
              if (!materials.has(m.material)) materials.set(m.material, new MeshBasicMaterial());
              const out = new Mesh(geometries[m.geometry], materials.get(m.material)); out.uuid = m.uuid;
              out.matrixAutoUpdate = false; out.matrix.fromArray(m.matrix); out.updateMatrixWorld(true); return out;
            });
            const generator = new StaticGeometryGenerator(meshes);
            const result = generator.generate();
            updateMaterialIndexAttribute(result.geometry, result.materials, result.materials);
            const g = result.geometry, attributes = {}, transfer = new Set();
            for (const [key, a] of Object.entries(g.attributes)) {
              attributes[key] = { array: a.array, itemSize: a.itemSize, normalized: a.normalized }; transfer.add(a.array.buffer);
            }
            if (g.index) transfer.add(g.index.array.buffer);
            self.postMessage({ attributes, index: g.index?.array, groups: g.groups }, [...transfer]);
          } catch (error) { self.postMessage({ error: error.message || String(error) }); }
        };
      `,
    }));
  },
};
const ctx = await esbuild.context({ entryPoints: { app: 'src/webgpu/entry.js', webgpu: 'src/webgpu/start.js', showcase: 'src/showcase.js', 'photo-merge-worker': 'photo-merge-worker', 'photo-bvh-worker': 'node_modules/three-mesh-bvh/src/workers/generateMeshBVH.worker.js' }, plugins: [photoWorkers], bundle: true, format: 'esm', outdir: 'dist', sourcemap: true, target: 'es2022', logLevel: 'info', define: { 'globalThis.CROTON_TEX_4K': JSON.stringify(tex4k), 'globalThis.CROTON_BUILD': JSON.stringify(build) }, minify: !watch && process.argv.includes('--min') });
if (watch) await ctx.watch(); else { await ctx.rebuild(); await ctx.dispose(); }
