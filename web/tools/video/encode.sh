#!/bin/bash
# Encode recorded frames into a film: H.264 High, yuv420p (TV range, BT.709 matrix and tags), faststart, AAC, with a music
# track faded in and out, and optional fades from and to black.
# usage: encode.sh [options] <framesDir> <out.mp4> <music.m4a|none|mute> [ffmpeg]
# none: a silent AAC track; mute: no audio stream at all (a master that music is muxed onto later with -c:v copy)
# Options (defaults are the 2:50 demo film's):
#   --fps N             frame rate (default: meta.json's fps, else 30)
#   --vbitrate 14M      two-pass VBR at that rate, peaks capped at 1.4x (the Twitter/X cut); default CRF 18
#   --size WxH          output size (default 1920x1080; larger frames, e.g. from record.mjs --dsf, are scaled down)
#   --fade-in S / --fade-out S     video fades from / to black (default 0.6 / 1.0; 0 = none)
#   --afade-in S / --afade-out S   music fades (default 2 / 3.5)
#   --music-start S     seconds into the track where the film starts (default 0)
# The demo film used "Mike Mills" (the 283 s track; "Tuscany" is 138 s, shorter than that film). Check a track's licence
# for the platform before publishing.
# The Twitter/X cut: encode.sh --vbitrate 14M --fade-in 0 --fade-out 0 --afade-in 0.02 --afade-out 2.5 --music-start 0.4 ...
set -e
fps=''; vbitrate=''; size=1920x1080; fin=0.6; fout=1.0; ain=2; aout=3.5; mstart=0
while [[ $1 == --* ]]; do
  case $1 in
    --fps) fps=$2 ;; --vbitrate) vbitrate=$2 ;; --size) size=$2 ;; --fade-in) fin=$2 ;; --fade-out) fout=$2 ;;
    --afade-in) ain=$2 ;; --afade-out) aout=$2 ;; --music-start) mstart=$2 ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
  shift 2
done
frames=$1; out=$2; music=$3; ffmpeg=${4:-${FFMPEG:-ffmpeg}}
n=$(ls "$frames" | grep -c '^f[0-9]*\.jpg$')
[ -n "$fps" ] || fps=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('fps', 30))" "$frames/meta.json" 2>/dev/null || echo 30)
W=${size%x*}; H=${size#*x}
calc() { python3 -c "print(f'{$1:.3f}')"; }
positive() { [ "$(python3 -c "print($1 > 0)")" = "True" ]; }
dur=$(calc "$n/$fps")
vf="scale=${W}:${H}:flags=lanczos+accurate_rnd+full_chroma_int:in_range=pc:out_range=tv:out_color_matrix=bt709"
if positive "$fin"; then vf="fade=t=in:st=0:d=$fin,$vf"; fi
if positive "$fout"; then vf="fade=t=out:st=$(calc "$n/$fps-$fout"):d=$fout,$vf"; fi
# frame tags as well as encoder tags: recent ffmpeg takes a frame's own (unset) primaries and transfer over -color_*
vf="$vf,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
tags=(-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)
# High@4.2 (1080p60 on any phone): x264's slow preset would use 5 reference frames, which needs level 5.0 at 1080p
x264=(-c:v libx264 -pix_fmt yuv420p -profile:v high -level:v 4.2 -refs 4 -preset slow -r "$fps" -g "$((fps * 2))")
if [ "$music" = "mute" ]; then
  audio_in=(); af=''
elif [ "$music" = "none" ]; then
  audio_in=(-f lavfi -t "$dur" -i anullsrc=r=48000:cl=stereo); af="[1:a]anull[a]"
else
  audio_in=(-ss "$mstart" -i "$music"); af="[1:a]atrim=0:$dur,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=$ain,afade=t=out:st=$(calc "$dur-$aout"):d=$aout,volume=0.85,aresample=48000[a]"
fi
if [ -n "$af" ]; then amap=(-map '[a]' -c:a aac -b:a 192k -ar 48000); else amap=(); fi
if [ -n "$vbitrate" ]; then
  rate=${vbitrate%M}; peak=$(calc "$rate*1.4"); buf=$(calc "$rate*2")
  plog=$(mktemp -d)/x264
  "$ffmpeg" -y -loglevel error -framerate "$fps" -i "$frames/f%05d.jpg" -vf "$vf" "${x264[@]}" -b:v "$vbitrate" -maxrate "${peak}M" -bufsize "${buf}M" -pass 1 -passlogfile "$plog" -an -f null /dev/null
  rc=(-b:v "$vbitrate" -maxrate "${peak}M" -bufsize "${buf}M" -pass 2 -passlogfile "$plog")
else
  rc=(-crf 18)
fi
"$ffmpeg" -y -loglevel error -framerate "$fps" -i "$frames/f%05d.jpg" "${audio_in[@]}" \
  -filter_complex "[0:v]$vf[v]${af:+;$af}" -map '[v]' "${amap[@]}" "${x264[@]}" "${rc[@]}" "${tags[@]}" \
  -movflags +faststart -t "$dur" "$out"
echo "wrote $out ($n frames at $fps fps, $dur s, $(du -h "$out" | cut -f1))"
