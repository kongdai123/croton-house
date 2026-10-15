#!/bin/bash
# Render a site folder on the cluster through the reference cameras and compare with Blender, locally.
# usage: bake/validate/check.sh <name> '<query>' [site dir on the cluster, default site] [other run names to include]
# needs bake/cluster/env.sh (git-ignored): HOST, R (cluster root), JOB (debug job id), NODEBIN (node bin dir), OUT (local dir)
set -e; . "$(dirname "$0")/../cluster/env.sh"
name=$1 query=$2 site=${3:-site}; shift 3 2>/dev/null || shift $#
ssh -o BatchMode=yes $HOST "cd $R && mkdir -p renders/$name && timeout 1500 srun --jobid=$JOB --overlap bash -c 'export PATH=$NODEBIN:\$PATH PLAYWRIGHT_BROWSERS_PATH=$R/tools/pw CROTON_SITE=$R/$site; cd validate && node shoot.mjs ../renders/$name \"$query\"'" 2>&1 | grep -v shexport | grep 'baked\|pageerror\|rror' | head -5
mkdir -p $OUT/$name $OUT/blender_fixed; scp -q -o BatchMode=yes "$HOST:$R/renders/$name/*.png" $OUT/$name/
[ -f $OUT/blender_fixed/garden.png ] || scp -q -o BatchMode=yes "$HOST:$R/renders/blender_fixed/*.png" $OUT/blender_fixed/
python3 -I "$(dirname "$0")/metrics.py" $OUT/blender_fixed $(for n in "$@"; do echo $OUT/$n; done) $OUT/$name
echo "sheets: $OUT/$name/garden_sheet.jpg $OUT/$name/living_sheet.jpg"
