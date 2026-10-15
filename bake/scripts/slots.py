"""Sarasota mid-October bake presets; sunrise is the shipped, calibrated bake.

Print a config for any Blender pass: python3 scripts/slots.py noon
"""
import copy
import json
import sys

SLOTS = {
    'sunrise': dict(sun=dict(az=58, el=8, strength=20.0, color=[1.0, 0.68, 0.45]),
                    sky=0.45, dust=0.8, clouds=[0.5, 0.68], lampK=3000,
                    lamps=0.25, ev=-0.7, autoExposure=dict(minEV=-0.5, maxEV=3.5), wet=1),
    'noon': dict(sun=dict(az=180, el=57, strength=36.0, color=[1.0, 0.95, 0.88]),
                 sky=0.55, dust=1.0, clouds=[0.62, 0.82], lampK=3000,
                 lamps=0.0, ev=-0.3, autoExposure=dict(minEV=-0.5, maxEV=3.5), wet=0),
    'golden': dict(sun=dict(az=255, el=7, strength=16.0, color=[1.0, 0.56, 0.28]),
                   sky=0.38, dust=2.0, clouds=[0.56, 0.76], lampK=3000,
                   lamps=0.7, ev=-0.55, autoExposure=dict(minEV=-0.5, maxEV=3.5), wet=0),
    'dusk': dict(sun=dict(az=263, el=-4, strength=0.0, color=[1.0, 0.42, 0.20]),
                 sky=3.0, dust=0.6, clouds=[0.6, 0.8], lampK=3000,   # below the horizon the Nishita sky is very dim; 3.0 gives a readable blue hour (Cycles test)
                 sky_tint=[0.36, 0.52, 1.0], cloud_shade=[0.32, 0.46, 0.8],
                 cloud_lit=[0.55, 0.62, 1.0], lamps=1.0, ev=0.0, autoExposure=dict(minEV=-0.5, maxEV=3.0), wet=0),
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
