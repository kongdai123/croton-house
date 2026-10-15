#!/bin/bash
# Cluster only: stage an isolated site, encode, package, check exact bytes, then render reference cameras.
# usage: NODEBIN=<cluster node bin> [FFMPEGBIN=<ffmpeg bin>] bash validate/deployment.sh "$R"
set -euo pipefail
cd "$1"; R=$(pwd)
: "${NODEBIN:?set NODEBIN to the cluster Node bin directory}"
JOB=${JOB:-7822229}
command -v srun >/dev/null
test ! -e site_deploy_src
test ! -e bakes/deploy
test ! -e renders/deploy
test -f tools/deployment_app.js
cp -rLs "$R/site" "$R/site_deploy_src"
# Rebuild these directories as regular files: writing through a cloned symlink would modify the shared site/bake.
rm -rf site_deploy_src/dist site_deploy_src/assets/lightmaps
mkdir -p site_deploy_src/dist site_deploy_src/assets/lightmaps/v2/sunrise site_deploy_src/assets/lightmaps/sunrise/refl bakes/deploy/sunrise renders/deploy
cp tools/deployment_app.js site_deploy_src/dist/app.js
cp -L site/assets/lightmaps/v2/lightmap_uv2.bin.gz site_deploy_src/assets/lightmaps/v2/
cp -L site/assets/lightmaps/sunrise/{probes.bin,sky_bg.hdr} site_deploy_src/assets/lightmaps/sunrise/
cp -L site/assets/lightmaps/sunrise/refl/{meta.json,probe_*.hdr} site_deploy_src/assets/lightmaps/sunrise/refl/
for res in half quarter; do
  if [ -d "site/assets/lightmaps/v2/sunrise/$res" ]; then
    cp -aL "site/assets/lightmaps/v2/sunrise/$res" "site_deploy_src/assets/lightmaps/v2/sunrise/$res"
  fi
done
cp bakes/v2/sunrise/encoding.json bakes/deploy/sunrise/
for layer in slot lamps; do ln -s "$R/bakes/v2/sunrise/${layer}_tone.npy" "bakes/deploy/sunrise/${layer}_tone.npy"; done
timeout 900 srun --jobid="$JOB" --overlap .venv/bin/python scripts/encode_webp.py bakes/deploy/sunrise --split
cp bakes/deploy/sunrise/{encoding.json,slot_0.webp,slot_1.webp,lamps_0.webp,lamps_1.webp} site_deploy_src/assets/lightmaps/v2/sunrise/
timeout 900 srun --jobid="$JOB" --overlap env PATH="${FFMPEGBIN:+$FFMPEGBIN:}$PATH" .venv/bin/python tools/package.py --root site_deploy_src
timeout 300 srun --jobid="$JOB" --overlap .venv/bin/python validate/deployment.py site_deploy_src/assets/lightmaps site_deploy_src/build bakes/deploy/sunrise
timeout 300 srun --jobid="$JOB" --overlap env PATH="$NODEBIN:$PATH" PLAYWRIGHT_BROWSERS_PATH="$R/tools/pw" node validate/deployment.mjs site_deploy_src/build bakes/deploy/sunrise tools/lightmap_assets.js
timeout 1500 srun --jobid="$JOB" --overlap env PATH="$NODEBIN:$PATH" PLAYWRIGHT_BROWSERS_PATH="$R/tools/pw" CROTON_SITE="$R/site_deploy_src/build" node validate/shoot.mjs renders/deploy 'lightmap=sunrise&lmres=full'
timeout 120 srun --jobid="$JOB" --overlap .venv/bin/python validate/metrics.py renders/blender_fixed renders/deploy
