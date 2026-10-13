# Small WebP thumbnails for the panorama list and cards (the full 4096 x 2048 panoramas are ~1 MB each).
# usage (from web/): python3 -I tools/pano_thumbs.py
import glob, os
from PIL import Image
src = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'panos')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'pano_thumbs')
os.makedirs(out, exist_ok=True)
total = 0
for f in sorted(glob.glob(os.path.join(src, '*.jpg'))):
    im = Image.open(f).convert('RGB')
    w, h = im.size
    # the middle of an equirect is the horizon band the viewer sees first; keep a 2:1 crop of it
    crop = im.crop((0, h // 6, w, h - h // 6)).resize((512, 192), Image.LANCZOS)
    dst = os.path.join(out, os.path.basename(f)[:-4] + '.webp')
    crop.save(dst, 'WEBP', quality=80, method=6)
    total += os.path.getsize(dst)
print(f'{len(glob.glob(os.path.join(out, "*.webp")))} thumbnails, {total / 1024:.0f} KB total')
