#!/bin/bash
# Encode recorded frames into a film: H.264 High, yuv420p (TV range, BT.709 matrix and tags), faststart, AAC, with a music
# track faded in and out, and optional fades from and to black.
# usage: encode.sh <framesDir> <out.mp4> <music.m4a|none> [ffmpeg]
# Environment (defaults are the 2:50 demo film's):
#   FPS        frame rate (default: meta.json's fps, else 30)
#   VBITRATE   unset: CRF 18. Set (e.g. 14M): two-pass VBR at that rate, peaks capped at 1.4x (the Twitter/X cut).
#   SIZE       output size (default 1920x1080; larger frames, e.g. from record.mjs --dsf, are scaled down with Lanczos)
#   FADE_IN / FADE_OUT     video fades from / to black in seconds (default 0.6 / 1.0; 0 = none)
#   AFADE_IN / AFADE_OUT   music fades in seconds (default 2 / 3.5)
#   MUSIC_START            seconds into the track where the film starts (default 0)
# The demo film used "Mike Mills" (the 283 s track; "Tuscany" is 138 s, shorter than that film). Check a track's licence
# for the platform before publishing: the Twitter/X cut is music-licence sensitive (docs in the cut's report).
set -e
frames=$1; out=$2; music=$3; ffmpeg=${4:-${FFMPEG:-ffmpeg}}
n=$(ls "$frames" | grep -c '^f[0-9]*\.jpg$')
fps=${FPS:-$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('fps', 30))" "$frames/meta.json" 2>/dev/null || echo 30)}
size=${SIZE:-1920x1080}; W=${size%x*}; H=${size#*x}
fin=${FADE_IN:-0.6}; fout=${FADE_OUT:-1.0}; ain=${AFADE_IN:-2}; aout=${AFADE_OUT:-3.5}; mstart=${MUSIC_START:-0}
calc() { python3 -c "print(f'{$1:.3f}')"; }
dur=$(calc "$n/$fps")
vf="scale=${W}:${H}:flags=lanczos+accurate_rnd+full_chroma_int:in_range=pc:out_range=tv:out_color_matrix=bt709"
[ "$(python3 -c "print($fin > 0)")" = "True" ] && vf="fade=t=in:st=0:d=$fin,$vf"
[ "$(python3 -c "print($fout > 0)")" = "True" ] && vf="fade=t=out:st=$(calc "$n/$fps-$fout"):d=$fout,$vf"
vf="$vf,format=yuv420p"
tags=(-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)
x264=(-c:v libx264 -pix_fmt yuv420p -profile:v high -preset slow -r "$fps" -g "$((fps * 2))")
if [ "$music" = "none" ]; then
  audio_in=(-f lavfi -t "$dur" -i anullsrc=r=48000:cl=stereo); af="[1:a]anull[a]"
else
  audio_in=(-ss "$mstart" -i "$music"); af="[1:a]atrim=0:$dur,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=$ain,afade=t=out:st=$(calc "$dur-$aout"):d=$aout,volume=0.85,aresample=48000[a]"
fi
if [ -n "$VBITRATE" ]; then
  rate=${VBITRATE%M}; peak=$(calc "$rate*1.4"); buf=$(calc "$rate*2")
  plog=$(mktemp -d)/x264
  "$ffmpeg" -y -loglevel error -framerate "$fps" -i "$frames/f%05d.jpg" -vf "$vf" "${x264[@]}" -b:v "$VBITRATE" -maxrate "${peak}M" -bufsize "${buf}M" -pass 1 -passlogfile "$plog" -an -f null /dev/null
  rc=(-b:v "$VBITRATE" -maxrate "${peak}M" -bufsize "${buf}M" -pass 2 -passlogfile "$plog")
else
  rc=(-crf 18)
fi
"$ffmpeg" -y -loglevel error -framerate "$fps" -i "$frames/f%05d.jpg" "${audio_in[@]}" \
  -filter_complex "[0:v]$vf[v];$af" -map '[v]' -map '[a]' "${x264[@]}" "${rc[@]}" "${tags[@]}" \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -t "$dur" "$out"
echo "wrote $out ($n frames at $fps fps, $dur s, $(du -h "$out" | cut -f1))"
