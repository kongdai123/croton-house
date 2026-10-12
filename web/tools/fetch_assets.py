# Download CC0 textures/HDRIs from Poly Haven (2k JPG maps, 2k HDR skies). Re-runnable.
import json, os, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '..', 'assets')
TEX = ['plank_flooring_02', 'laminate_floor_02', 'white_stucco', 'white_stucco_02', 'shell_floor_01', 'clean_pebbles',
       'concrete_floor_01', 'brown_leather', 'hessian_380', 'grey_roof_01', 'leafy_grass', 'palm_tree_bark', 'white_oak_veneer']
HDR = ['drakensberg_solitary_mountain_puresky', 'belfast_sunset_puresky']
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough', 'AO': 'ao'}


def get(url, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        return
    req = urllib.request.Request(url, headers={'User-Agent': 'croton-house/1.0'})
    with urllib.request.urlopen(req) as r, open(dst, 'wb') as f:
        f.write(r.read())
    print('got', os.path.basename(dst), os.path.getsize(dst) // 1024, 'KB')


for t in TEX:
    d = json.load(urllib.request.urlopen(f'https://api.polyhaven.com/files/{t}'))
    for k, short in MAPS.items():
        if k not in d:
            continue
        e = d[k].get('2k', {}).get('jpg') or d[k].get('1k', {}).get('jpg')
        if not e:
            continue
        get(e['url'], os.path.join(OUT, 'tex', f'{t}_{short}.jpg'))
for h in HDR:
    d = json.load(urllib.request.urlopen(f'https://api.polyhaven.com/files/{h}'))
    e = d['hdri']['2k']['hdr']
    get(e['url'], os.path.join(OUT, 'hdr', f'{h}_2k.hdr'))
print('done')
