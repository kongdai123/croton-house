# Copy the 2513-house RedNote posts (images resized, videos re-encoded to 720p) into assets/rednote and write data/rednote_posts.json
import json, os, subprocess
from PIL import Image
SRC = '/Users/masenov/agent/codex/downloads/rednote/Studio_Hu_Dwelling'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'rednote'); os.makedirs(OUT, exist_ok=True)
posts = []
sel = [d for d in sorted(os.listdir(SRC)) if ('2513' in d or d in ('60厘米悬挑 为了点儿树影照进来', 'Untitled post'))]
for d in sel:
    pj = os.path.join(SRC, d, 'post.json')
    if not os.path.isfile(pj):
        continue
    j = json.load(open(pj))
    slug = j['noteId'][:10]
    media = []
    for f in sorted(os.listdir(os.path.join(SRC, d))):
        if f.startswith('image') or f == 'cover.jpg':
            im = Image.open(os.path.join(SRC, d, f)); im.thumbnail((1600, 1600))
            name = f'{slug}_{f.rsplit(".", 1)[0]}.jpg'
            im.convert('RGB').save(os.path.join(OUT, name), quality=86); media.append(name)
    video = None
    vsrc = os.path.join(SRC, d, 'video.mp4')
    if os.path.isfile(vsrc):
        video = f'{slug}_video.mp4'; dst = os.path.join(OUT, video)
        if not os.path.exists(dst):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', vsrc, '-vf', 'scale=-2:720', '-c:v', 'libx264', '-crf', '24',
                            '-preset', 'fast', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '96k', dst])
    url = open(os.path.join(SRC, d, 'post.txt')).read().strip().split('\n')[-1]
    posts.append({'id': j['noteId'], 'slug': slug, 'title': j.get('title') or '(untitled)', 'desc': j.get('desc', ''),
                  'time': j.get('time'), 'type': j.get('type'), 'media': media, 'video': video, 'url': url, 'folder': d})
json.dump(posts, open(os.path.join(HERE, '..', 'data', 'rednote_posts.json'), 'w'), ensure_ascii=False, indent=1)
for p in posts:
    print(p['slug'], p['title'], len(p['media']), p['video'])
