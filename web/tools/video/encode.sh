#!/bin/bash
# Encode recorded frames into the demo film: H.264 High (CRF 18), yuv420p, 30 fps, faststart, with the site's background
# music ("Mike Mills", web/assets/audio: the 283 s track; "Tuscany" is 138 s, shorter than the film) faded in and out, and a short fade from and to black.
# usage: encode.sh <framesDir> <out.mp4> <music.m4a> [ffmpeg]
set -e
frames=$1; out=$2; music=$3; ffmpeg=${4:-ffmpeg}
n=$(ls "$frames" | grep -c '^f[0-9]*\.jpg$')
dur=$(python3 -c "print(f'{$n/30:.3f}')")
fo=$(python3 -c "print(f'{$n/30-1.0:.3f}')"); ao=$(python3 -c "print(f'{$n/30-3.5:.3f}')")
"$ffmpeg" -y -loglevel error -framerate 30 -i "$frames/f%05d.jpg" -i "$music" \
  -filter_complex "[0:v]fade=t=in:st=0:d=0.6,fade=t=out:st=$fo:d=1.0,scale=in_range=pc:out_range=tv,format=yuv420p[v];[1:a]atrim=0:$dur,afade=t=in:st=0:d=2,afade=t=out:st=$ao:d=3.5,volume=0.85[a]" \
  -map '[v]' -map '[a]' -c:v libx264 -pix_fmt yuv420p -color_range tv -profile:v high -preset slow -crf 18 -r 30 -c:a aac -b:a 192k -movflags +faststart -t "$dur" "$out"
echo "wrote $out ($n frames, $dur s)"
