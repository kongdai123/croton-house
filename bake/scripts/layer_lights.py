# Light set-up shared by the lightmap and probe bakes, so both see exactly the same light for a layer.
#   sky    : the sky's light, direct and bounced (no sun, no lamps)
#   sunind : the sun's bounced light only (its direct light is drawn live)
#   lamps  : the house's lamps at unit level, direct and bounced
# Movable objects are hidden: they are lit by probes at run time.
import bpy, math
from slots import resolve

def configure_world(scene, cfg):
    """Shared world settings for diffuse, foliage, sky and full reflection passes."""
    cfg = resolve(cfg); s = cfg.get('sun', {})
    az, el = math.radians(s.get('az', 58)), math.radians(s.get('el', 8))
    nt = scene.world.node_tree; sky = nt.nodes['Nishita']
    sky.sun_elevation = el; sky.sun_rotation = (-az) % (2 * math.pi); sky.dust_density = cfg.get('dust', 0.8)
    nt.nodes['sundot'].inputs[1].default_value = (math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))
    lo, hi = cfg.get('clouds', [0.5, 0.68]); cr = nt.nodes['cloud_cover'].color_ramp; cr.elements[0].position = lo; cr.elements[1].position = hi
    tint = nt.nodes.get('slot_cloud_tint') or next((n for n in nt.nodes if n.type == 'MIX_RGB' and tuple(round(v, 2) for v in n.inputs[1].default_value[:3]) == (0.62, 0.66, 0.78)), None)
    if tint:
        tint.name = 'slot_cloud_tint'
        tint.inputs[1].default_value = tuple(cfg.get('cloud_shade', [0.62, 0.66, 0.78])) + (1,)
        tint.inputs[2].default_value = tuple(cfg.get('cloud_lit', [2.6, 1.45, 0.95])) + (1,)
    # Nishita below the horizon is dimmed and cooled, with no direct sun. Old scenes work too.
    node = nt.nodes.get('slot_sky_tint')
    if node is None:
        bg = nt.nodes['skybg']; source = bg.inputs['Color'].links[0].from_socket
        node = nt.nodes.new('ShaderNodeMixRGB'); node.name = 'slot_sky_tint'; node.blend_type = 'MULTIPLY'; node.inputs[0].default_value = 1
        nt.links.new(source, node.inputs[1]); nt.links.new(node.outputs[0], bg.inputs['Color'])
    node.inputs[2].default_value = tuple(cfg.get('sky_tint', [1, 1, 1])) + (1,)
    return cfg


def configure(scene, cfg):
    cfg = configure_world(scene, cfg)
    layer = cfg['layer']; s = cfg.get('sun', {})
    az, el = math.radians(s.get('az', 58)), math.radians(s.get('el', 8))
    sun = bpy.data.objects['sun']
    sun.rotation_euler = (math.radians(90) - el, 0, math.radians(180) - az)
    sun.data.energy = s.get('strength', 20.0); sun.data.color = tuple(s.get('color', (1.0, 0.68, 0.45)))
    nt = scene.world.node_tree; sky = nt.nodes['Nishita']
    sky.sun_elevation = el; sky.sun_rotation = (-az) % (2 * math.pi); sky.dust_density = cfg.get('dust', 0.8)
    nt.nodes['sundot'].inputs[1].default_value = (math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))
    lo, hi = cfg.get('clouds', [0.5, 0.68]); cr = nt.nodes['cloud_cover'].color_ramp; cr.elements[0].position = lo; cr.elements[1].position = hi
    nt.nodes['skybg'].inputs['Strength'].default_value = cfg.get('sky', 0.45) if layer == 'sky' else 0.0
    sun.hide_render = layer != 'sunind' or s.get('strength', 20.0) <= 0
    for o in scene.objects:
        if o.type == 'LIGHT' and o.name.startswith('lamp'):
            o.hide_render = layer != 'lamps'
            bb = next((n for n in o.data.node_tree.nodes if n.type == 'BLACKBODY'), None) if o.data.node_tree else None
            if bb: bb.inputs[0].default_value = cfg.get('lampK', 3000)
    bpy.data.objects['mist'].hide_render = True
    # movable objects are lit by probes at run time: keep them out of the bake entirely (no ghost shadows)
    for o in scene.objects:
        if o.name.startswith('movable'): o.hide_render = True
    # lamp shades glow only in the lamps layer
    for m in bpy.data.materials:
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
        if b and b.inputs['Emission Strength'].default_value > 0 and layer != 'lamps': b.inputs['Emission Strength'].default_value = 0
    return layer
