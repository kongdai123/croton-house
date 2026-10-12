// Bundle the dog test pages: cd web && node tools/dog_build.mjs
//   tools/dog_viewer.bundle.js  standalone viewer (own three.js)
//   tools/dog_inject.bundle.js  window.__dogInject.createPet for the running app; kit.js is mapped onto window.__app.THREE
//                               so the injected dog shares the app's three.js instance (used until roam.js adds pets)
import * as esbuild from 'esbuild';
await esbuild.build({ entryPoints: { 'tools/dog_viewer.bundle': 'tools/dog_viewer.src.js' }, bundle: true, format: 'esm', outdir: '.', target: 'es2022', logLevel: 'warning' });
const appThree = { name: 'app-three', setup(b) {
  b.onResolve({ filter: /\/kit\.js$/ }, () => ({ path: 'kit', namespace: 'app-three' }));
  b.onLoad({ filter: /.*/, namespace: 'app-three' }, () => ({ contents: 'export const THREE = window.__app.THREE;', loader: 'js' }));
} };
await esbuild.build({ stdin: { contents: "import { createPet } from './src/pets/dog.js'; window.__dogInject = { createPet };", resolveDir: '.', loader: 'js' }, bundle: true, format: 'iife', outfile: 'tools/dog_inject.bundle.js', target: 'es2022', plugins: [appThree], logLevel: 'warning' });
console.log('built tools/dog_viewer.bundle.js, tools/dog_inject.bundle.js');
