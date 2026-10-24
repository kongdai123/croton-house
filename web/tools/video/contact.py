# Contact sheet of recorded frames: one frame every --step seconds, labelled with its time (and its shot, for twitter.js).
# With step 0, every recorded frame (a --stills run: one frame per pose, labelled with the pose's name).
# usage: python contact.py <framesDir> <out.jpg> [stepSeconds] [columns] [thumbWidth]
import json, os, sys
from PIL import Image, ImageDraw
frames, out = sys.argv[1], sys.argv[2]
step = float(sys.argv[3]) if len(sys.argv) > 3 else 3.0
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
tw = int(sys.argv[5]) if len(sys.argv) > 5 else 480
meta = {}
if os.path.exists(os.path.join(frames, 'meta.json')): meta = json.load(open(os.path.join(frames, 'meta.json')))
fps = meta.get('fps', 30)
# frame -> shot name (twitter.js records the frame each shot starts at)
starts = [(s['frame'], s.get('shot') or s.get('text') or '') for s in meta.get('steps', [])]
def shot_of(k):
    name = ''
    for f, n in starts:
        if f <= k: name = n
    return name
have = sorted(f for f in os.listdir(frames) if f.startswith('f') and f.endswith('.jpg'))
nums = [int(f[1:-4]) for f in have]
if step <= 0: picks = nums
else:
    picks, t = [], 0.0
    while nums and t * fps <= nums[-1]:
        want = round(t * fps); best = min(nums, key=lambda k: abs(k - want)); picks.append(best); t += step
    picks = sorted(set(picks))
w0, h0 = Image.open(os.path.join(frames, have[0])).size
th = round(tw * h0 / w0)
rows = (len(picks) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 22)), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for i, k in enumerate(picks):
    im = Image.open(os.path.join(frames, f'f{k:05d}.jpg')).convert('RGB').resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 22)
    sheet.paste(im, (x, y + 22)); s = k / fps
    d.text((x + 6, y + 5), f'{int(s // 60)}:{s % 60:05.2f}  {shot_of(k)}  (frame {k})' if step > 0 else f'{shot_of(k)}', fill=(235, 235, 235))
sheet.save(out, quality=88)
print('contact sheet', out, len(picks), 'frames')
