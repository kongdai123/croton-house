# Deployment verification

The 15,000,000-byte cap is retained: `git log -S FILE_LIMIT -- web/tools/package.py` points to its initial addition,
and `docs/briefs/codex_packaging_mobile.md` explicitly requires the cap. `encode_webp.py --split` writes two lossless
horizontal halves per layer, with top/bottom row counts in `encoding.json.rows`. The packager never transforms bake
files. It selects the runtime files, copies their exact bytes to SHA-256 names, and writes `assets/lightmaps/manifest.json`.
Pre-encoded half/quarter tiers are copied when present; arrays, EXRs, stale whole atlases and unused probes are excluded.

The loader fetches the manifest with `cache: 'no-store'`, resolves all UV/layer/probe/sky/reflection paths through it,
and uses plain names when it is absent. Hashed URLs identify immutable content; HTTP cache headers remain the host's
responsibility (GitHub Pages controls its headers). The dev server continues to serve plain names with no caching.
The GitHub Pages workflow is unchanged (out of scope here): publishing the packaged `web/build` is a separate step.
Missing bakes or budget violations fail packaging before replacing an existing build. Bake assets must be staged in
`web/assets/lightmaps` before packaging; they are not available on the Mac.

In the browser a split layer is never drawn through a 2D canvas (which could colour-manage and would hold a second
full-size copy): each flipped half is uploaded with texSubImage2D into one texture allocated once (lightmap.js
`loadRGBM`, three's `copyTextureToTexture`), the bottom half at row 0, and the halves are closed afterwards.

Local checks (no browser or GPU):

```sh
python3 web/tools/test_package.py
node web/tools/test_lightmap_assets.mjs
cd web && node tools/build.mjs
```

Cluster staging map (paths on the right are relative to R):

| Local file | Cluster file |
|---|---|
| `web/dist/app.js` (built after workers finish) | `tools/deployment_app.js` |
| `web/tools/package.py` | `tools/package.py` |
| `web/src/lightmap_assets.js` | `tools/lightmap_assets.js` |
| `bake/scripts/encode_webp.py` | `scripts/encode_webp.py` |
| `bake/validate/deployment.{sh,py,mjs}` | `validate/deployment.{sh,py,mjs}` |

Existing inputs: `site/` (runtime asset folders), `bakes/v2/sunrise/{slot_tone.npy,lamps_tone.npy,encoding.json}`,
`site/assets/lightmaps/v2/lightmap_uv2.bin.gz`, `site/assets/lightmaps/sunrise/{probes.bin,sky_bg.hdr,refl/}`,
`renders/blender_fixed/{garden,living}.png`, `validate/{shoot.mjs,metrics.py}`, `.venv/`, and `tools/pw/`.
Use a stable set of tone arrays and encoding metadata from the same composite. ffmpeg/ffprobe must be on the job's PATH
(FFMPEGBIN) when a rednote video exceeds the cap. package.py needs every runtime folder, including `assets/agx` and
real `assets/panos` and `assets/photos` (on the cluster these are dangling symlinks: stage copies first).

On the cluster, with R and NODEBIN set as in the brief:

```sh
cd "$R"
bash validate/deployment.sh "$R"
```

The script refuses existing `site_deploy_src`, `bakes/deploy`, or `renders/deploy` outputs. It clones the site into
`site_deploy_src`, encodes into `bakes/deploy/sunrise`, and packages into `site_deploy_src/build`; the shared `site`
and original bakes are not modified. Every processing/browser command uses `srun --jobid=7822229 --overlap` with
a timeout (JOB may override the job ID). File staging runs on the login node.

Checks: all selected files must be byte-identical, their hashes must match the manifest, decoded split pixels must
equal the tone arrays, and the browser's stitched RGB bytes must exactly equal the arrays with vertically reversed
rows (read back from a WebGL texture filled with texSubImage2D, as the site does). This catches colour conversion,
half order, odd-row loss and seams. All files must be <=15 MB and the full
package <=240 MB. Check `renders/deploy/{garden,living}.png` and `{garden,living}_sheet.jpg` for alignment and seams,
and check the render log for non-null baked stats and no asset failures/page errors. The render query forces full
resolution so it exercises the split atlas even with another worker's tier selection enabled.
