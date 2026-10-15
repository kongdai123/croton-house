# Cycles reference with chosen lamp groups on, at the bake's physical level (lamps 1.0): run before export/render.py on
# the lamp-group scene (lamp_groups.py), with the same JSON: {"lampsOn": [group indices], "lamps": 1.0, ...render.py}.
# Optional "gains": {group index: factor}, as the site applies them. Groups not listed are off: their lights hidden, their lamp surfaces dark (as the site draws a switched-off lamp).
# usage: blender -b lampgroups.blend -P scripts/lamp_groups_render.py -P export/render.py -- '<json>'
import bpy, sys, json
arg = sys.argv[sys.argv.index('--') + 1]
cfg = json.load(open(arg)) if arg.endswith('.json') else json.loads(arg)
on = set(cfg.get('lampsOn', []))
# per-group gains (the site's encoding.json "gain", lamp_groups_pack.py --gains): scale lights and lamp surfaces alike
gains = {int(k): float(v) for k, v in cfg.get('gains', {}).items()}
for o in bpy.context.scene.objects:
    if o.type == 'LIGHT' and o.name.startswith('lampgrp'):
        g = int(o.name[7:9]); o.hide_render = g not in on; o.data.energy *= gains.get(g, 1.0)
for m in bpy.data.materials:
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
    if b and b.inputs['Emission Strength'].default_value > 0 and 'lamp_group' in m.keys():
        b.inputs['Emission Strength'].default_value *= gains.get(m['lamp_group'], 1.0) if m['lamp_group'] in on else 0
print('lamp groups on', sorted(on), 'lights', [o.name for o in bpy.context.scene.objects if o.type == 'LIGHT' and o.name.startswith('lampgrp') and not o.hide_render])
