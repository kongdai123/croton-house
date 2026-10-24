"""The realism target for the visitor's exposure: how bright the listing photos of the house's rooms are.

    python3 -I web/tools/listing_brightness.py   # rewrite web/tools/golden/listing_brightness.json and
                                                 # bake/validate/cameras_listing.json (the photos' camera spots, for shoot.mjs)

Every gallery photo with a camera spot (web/data/photo_spots.json) in an interior room of the plan (web/data/plan.json; the
garage annex and the grounds left out), measured as the gate measures its frames (bake/validate/compare.py brightness):
the 8-bit luma (ITU-R 601 on the sRGB values, Pillow's "L") per photo, its median, 90th percentile and clipped share
(>= 250). The listing photos are bright and airy (white walls near 220-240, windows kept). lighting_slots.js sets the daylight
auto-exposure key from the median of medians, test_auto_exposure.mjs holds the key to it through AgX, and gate (c) holds
the visitor frames to a band around it (bake/validate/thresholds.json brightness)."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

WEB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WEB.parent / 'bake/scripts'))
import plan as planlib   # noqa: E402

plan = planlib.load(str(WEB / 'data/plan.json'))
spots = json.loads((WEB / 'data/photo_spots.json').read_text())
photos, cameras = {}, []
for s in spots:
    sp = plan.space_at(s['x'], s['y'])
    if not sp or sp.get('zone') != 'interior': continue
    luma = np.asarray(Image.open(WEB / 'assets/photos' / s['file']).convert('L'), np.float32)
    photos[s['id']] = {'space': sp['id'], 'median': float(np.median(luma)), 'p10': float(np.percentile(luma, 10)), 'p90': float(np.percentile(luma, 90)),
                       'clip': round(float((luma >= 250).mean()), 4)}
    # the gate's camera at the photo's spot (approximate, as the site's compare view), a wide real-estate lens
    cameras.append({'id': f"listing_{s['id']}", 'space': sp['id'], 'kind': 'listing', 'photo': s['file'], 'x': s['x'], 'y': s['y'],
                    'z': s.get('eye', 1.4), 'h': s['heading'], 'p': s.get('pitch', 0), 'lens': 16})
med = np.array([p['median'] for p in photos.values()])
out = {'note': __doc__.strip().splitlines()[0] + ' Rewritten by web/tools/listing_brightness.py.',
       'interior': {'photos': len(photos), 'median': float(np.median(med)), 'p10': float(np.percentile(med, 10)),
                    'p90': float(np.percentile(med, 90)), 'p10Luma': float(np.median([p['p10'] for p in photos.values()])), 'p90Luma': float(np.median([p['p90'] for p in photos.values()])),
                    'clip': float(np.median([p['clip'] for p in photos.values()]))},
       'photos': dict(sorted(photos.items()))}
(WEB / 'tools/golden/listing_brightness.json').write_text(json.dumps(out, indent=1) + '\n')
cams = {'version': 1, 'note': "the interior listing photos' camera spots (web/data/photo_spots.json, approximate), lens 16: visitor "
        'shots to set beside the photos (web/tools/listing_brightness.py writes this file)', 'cameras': sorted(cameras, key=lambda c: c['id'])}
(WEB.parent / 'bake/validate/cameras_listing.json').write_text(json.dumps(cams, indent=1) + '\n')
print(f"{len(photos)} interior photos: median luma {out['interior']['median']:.0f} (p10 {out['interior']['p10']:.0f}, p90 {out['interior']['p90']:.0f}), "
      f"p90 {out['interior']['p90Luma']:.0f}, clipped {out['interior']['clip'] * 100:.1f}%; {len(cameras)} cameras")
