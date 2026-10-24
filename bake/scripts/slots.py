"""Sarasota mid-October bake presets; sunrise is the shipped, calibrated bake.

Print a config for any Blender pass: python3 scripts/slots.py noon
"""
import copy
import json
import sys

# lamps: the share of the house's lamps on by default (the level of the shared lamps layer, the site's fallback without lamp
# groups; with them, every switch is on or off at its fixture's physical output: fixture_lights.py, lighting_roles.js
# defaultSlots). ev: the display exposure (never baked); autoExposure: the visitor's metering indoors (the site's
# lighting_slots.js holds the reasons; test_lighting_slots.mjs keeps the two equal): key, the scene-linear level the meter's
# log mean is shown at (daylight 0.66: the listing photos' interior median through AgX; dusk 0.35), and the range around ev.
SLOTS = {
    'sunrise': dict(sun=dict(az=58, el=8, strength=20.0, color=[1.0, 0.68, 0.45]),
                    sky=0.45, dust=0.8, clouds=[0.5, 0.68], lampK=3000,
                    lamps=1.0, ev=-0.7, autoExposure=dict(key=0.66, minEV=-0.5, maxEV=7.1), wet=1),
    'noon': dict(sun=dict(az=180, el=57, strength=36.0, color=[1.0, 0.95, 0.88]),
                 sky=0.55, dust=1.0, clouds=[0.62, 0.82], lampK=3000,
                 lamps=0.0, ev=-0.7, autoExposure=dict(key=0.66, minEV=-0.5, maxEV=6.6), wet=0),
    'golden': dict(sun=dict(az=255, el=7, strength=16.0, color=[1.0, 0.56, 0.28]),
                   sky=0.38, dust=2.0, clouds=[0.56, 0.76], lampK=3000,
                   lamps=1.0, ev=-0.55, autoExposure=dict(key=0.66, minEV=-0.5, maxEV=7.1), wet=0),
    # blue hour, the sun 4 degrees down: the sky's light a few per mille of noon's, so the lamp-lit rooms (fixture_lights.py,
    # physical) are 2-4x the garden's ambient; the display exposure lifts the exterior back to its readable blue
    'dusk': dict(sun=dict(az=263, el=-4, strength=0.0, color=[1.0, 0.42, 0.20]),
                 sky=0.35, dust=0.6, clouds=[0.6, 0.8], lampK=3000,
                 sky_tint=[0.36, 0.52, 1.0], cloud_shade=[0.32, 0.46, 0.8],
                 cloud_lit=[0.55, 0.62, 1.0], lamps=1.0, ev=3.1, autoExposure=dict(key=0.35, minEV=-0.5, maxEV=4.7), wet=0),
}


def resolve(cfg):
    """Named configs can override individual sun fields; old explicit JSON stays unchanged."""
    if isinstance(cfg, str):
        return dict(copy.deepcopy(SLOTS[cfg]), slot=cfg)
    if 'slot' not in cfg:
        return cfg
    out = copy.deepcopy(SLOTS[cfg['slot']])
    out.update(cfg)
    out['sun'] = dict(SLOTS[cfg['slot']]['sun'], **cfg.get('sun', {}))
    return out


if __name__ == '__main__':
    print(json.dumps(resolve(sys.argv[1])))
