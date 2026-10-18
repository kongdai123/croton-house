#!/bin/bash
# Gate (c), per-room render regression: shoot one tier's states through cameras.json on this GPU node, then compare.
# Runs inside a scavenger GPU job (never on the login node), from a folder holding this script, shoot.mjs, compare.py,
# cameras.json and thresholds.json, with playwright resolvable from it (e.g. $R/validate/gate_c, next to
# $R/validate/node_modules). See bake/validate/RENDER_GATE.md.
#   usage: gate_c.sh <run dir> <tier: hq|mobile> <states, comma-separated> [baseline dir] [cycles dir]
#   env:   CROTON_SITE (the site folder to serve), NODEBIN (node's bin dir), PLAYWRIGHT_BROWSERS_PATH, PY (python with
#          numpy + pillow)
set -u
here=$(cd "$(dirname "$0")" && pwd)
run=$1 tier=$2 states=$3 base=${4:-} cyc=${5:-}
export PATH=$NODEBIN:$PATH
mkdir -p "$run"
t0=$(date +%s)
node "$here/shoot.mjs" --cameras "$here/cameras.json" --out "$run" --tier "$tier" --states "$states"
code=$?
echo "shoot exit $code in $(( $(date +%s) - t0 )) s"
args=()
[ -n "$base" ] && [ -d "$base/$tier" ] && args+=(--baseline "$base")
[ -n "$cyc" ] && [ -d "$cyc" ] && args+=(--cycles "$cyc")
"$PY" -I "$here/compare.py" check "$run" --tiers "$tier" --states "$states" --cameras "$here/cameras.json" \
  --thresholds "$here/thresholds.json" ${args[@]+"${args[@]}"} --overview --out "$run/compare_$tier"
exit $(( code || $? ))
