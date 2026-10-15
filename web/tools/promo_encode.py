# Promo encoder: crossfades the day and dusk renders of the garden shot, then encodes an X-ready MP4
# (H.264 High, yuv420p, 30 fps, faststart, AAC) with "Tuscany" faded in and out.
# usage (from web/): python3 -I tools/promo_encode.py <framesDir> <out.mp4>
import json, os, shutil, subprocess, sys, tempfile
from PIL import Image

frames, out = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(frames, 'meta.json')))
fps, total = meta['fps'], meta['total']
f0, f1 = meta['duskFade']
work = tempfile.mkdtemp(prefix='promo_')
for i in range(total):
    t = i / fps
    src = os.path.join(frames, f'f{i:05d}.jpg')
    dusk = os.path.join(frames, f'd{i:05d}.jpg')
    dst = os.path.join(work, f'{i:05d}.jpg')
    if os.path.exists(dusk) and t >= f0:
        w = min(1.0, max(0.0, (t - f0) / (f1 - f0)))
        w = w * w * (3 - 2 * w)
        if w >= 1: shutil.copyfile(dusk, dst)
        else: Image.blend(Image.open(src).convert('RGB'), Image.open(dusk).convert('RGB'), w).save(dst, quality=95)
    else:
        shutil.copyfile(src, dst)
dur = total / fps
audio = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'audio', 'tuscany.m4a')
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i', os.path.join(work, '%05d.jpg'), '-i', audio,
       '-filter_complex', f'[1:a]atrim=0:{dur:.3f},afade=t=in:st=0:d=1.2,afade=t=out:st={dur - 3:.3f}:d=3,volume=0.9[a]',
       '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '19', '-maxrate', '12M', '-bufsize', '24M', '-pix_fmt', 'yuv420p',
       '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', f'{dur:.3f}', out]
subprocess.run(cmd, check=True)
shutil.rmtree(work)
print('wrote', out, f'{os.path.getsize(out) / 1e6:.1f} MB', f'{dur:.1f} s')
