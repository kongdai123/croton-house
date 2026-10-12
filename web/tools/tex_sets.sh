#!/bin/zsh
# Builds the WebP 1K and 512 texture sets from the 2K JPEG library in assets/tex.
# Every map is halved / quartered: 2048x2048 becomes 1024 / 512, the 2048x4096 palm bark maps 1024x2048 / 512x1024.
# Diffuse is lossy q90; roughness and AO lossy q95; normal maps near-lossless (no 4:2:0 chroma blur on X/Y).
# Usage: web/tools/tex_sets.sh  (needs cwebp and sips)
set -e
cd "${0:A:h}/../assets/tex"
encode() {
  local src=$1 div=$2 out=$3/${1:r}.webp
  local w=$(sips -g pixelWidth "$src" | awk '/pixelWidth/{print $2}') h=$(sips -g pixelHeight "$src" | awk '/pixelHeight/{print $2}')
  local rw=$(( w / div )) rh=$(( h / div ))
  case $src in
    *_nor.jpg) cwebp -quiet -near_lossless 60 -z 9 -resize $rw $rh "$src" -o "$out" ;;
    *_diff.jpg) cwebp -quiet -q 90 -m 6 -sharp_yuv -resize $rw $rh "$src" -o "$out" ;;
    *) cwebp -quiet -q 95 -m 6 -resize $rw $rh "$src" -o "$out" ;;
  esac
}
for div dir in 2 1k 4 512; do
  mkdir -p $dir
  for f in *.jpg; do encode $f $div $dir & done
  wait
done
du -sh 1k 512
