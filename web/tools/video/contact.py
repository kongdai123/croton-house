# Contact sheet of recorded frames: one frame every --step seconds, labelled with its time.
# usage: python contact.py <framesDir> <out.jpg> [stepSeconds] [columns]
import os, sys
from PIL import Image, ImageDraw
frames, out = sys.argv[1], sys.argv[2]
step = float(sys.argv[3]) if len(sys.argv) > 3 else 3.0
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
have = sorted(f for f in os.listdir(frames) if f.startswith('f') and f.endswith('.jpg'))
nums = [int(f[1:-4]) for f in have]
picks, t = [], 0.0
while nums and t * 30 <= nums[-1]:
    want = round(t * 30); best = min(nums, key=lambda k: abs(k - want)); picks.append(best); t += step
picks = sorted(set(picks))
tw, th = 480, 270
rows = (len(picks) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 22)), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for i, k in enumerate(picks):
    im = Image.open(os.path.join(frames, f'f{k:05d}.jpg')).convert('RGB').resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 22)
    sheet.paste(im, (x, y + 22)); s = k / 30; d.text((x + 6, y + 5), f'{int(s // 60)}:{s % 60:04.1f}  (frame {k})', fill=(235, 235, 235))
sheet.save(out, quality=88)
print('contact sheet', out, len(picks), 'frames')
