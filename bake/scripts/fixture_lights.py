# The bake's lamps, one source for every Blender scene (export/setup.py: lightmap, probe, reflection and Cycles reference
# scenes; scripts/lamp_groups.py: the per-switch lamp bakes): every light switch of the site (export/switch_groups.mjs,
# the lighting manifest's records, web/src/lighting_roles.js bakeSwitchRecord) becomes ONE physical light of its fixture's
# declared output (lumens, beam, emitter: lighting_roles.js FIXTURE_OUTPUT), named lampgrpNN_KK after its lamp group NN,
# and its lamp surfaces (shades, lenses, diffusers) glow at the luminance that output gives them, for camera and glossy
# rays only: the light itself carries all the fixture's lumens, so nothing is counted twice.
#
# LM_PER_W: the one constant from lumens to Blender watts of emitted power. The daylight's scale is the art-directed sky
# and sun of scripts/slots.py, so the lamps are calibrated against it: at this value the open-plan rooms' lamps at dusk
# give their desks ~0.2x the noon daylight there (a house in daylight: ~100-300 lux of lamps against ~500-2000 of noon
# daylight indoors); the bake units then read as lux x 1/LM_PER_W (web/tools/test_lamp_levels.mjs checks every space).
# Emitter models (Blender 4.5 Cycles), each converting the fixture's flux exactly (fixture_calibrate.py measures them):
#   omni      POINT: the bulb in a shade, a glass bubble, a sconce; power = flux
#   linear    AREA rectangle facing down (one-sided, Lambertian): an LED bar, a linear pendant; power = flux
#   downlight SPOT with a fully soft edge (blend 1) whose half-intensity cone is the declared beam: a recessed can, the
#             ceiling above it stays dim; power = flux * 4 pi / solid angle of the cone (Cycles gives a spot the
#             intensity of a point light of its power, masked by the cone)
#   spot      the same, a track head's narrow beam
# Pure Python above build(); build() and the surface pass need bpy.
import json, math

LM_PER_W = 6400.0         # lumens per Blender watt (see above)
LAMP_K = 3000             # every lamp's colour temperature (lighting_roles.js LAMP_CCT)
LENS_GAP = 0.012          # a downlight's emitter sits this far below its lens (clear of the trim ring)
TRACK_DROP = 0.2          # a track head's spot sits below its head (at the head the housing swallowed ~90%: 2026-10-15)
BULB_RADIUS = {'omni': 0.04, 'downlight': 0.025, 'spot': 0.02}
SHADE_SHARE = {'omni': 0.6, 'downlight': 1.0, 'spot': 1.0, 'linear': 1.0}   # flux leaving through the glowing surface
EMITTERS = ('downlight', 'spot', 'omni', 'linear')


def cone(beam_deg, blend=1.0):
    """A Cycles spot with a smoothstep edge over `blend` of its cone, half intensity at beam / 2 (blend 1):
    (spot_size radians, blend, effective solid angle). Cycles' attenuation: smoothstep((cos t - c) / ((1 - c) blend)),
    c = cos(spot_size / 2); its integral over the sphere is 2 pi (1 - c)(1 - blend / 2)."""
    if not 0 < beam_deg <= 120: raise ValueError(f'beam {beam_deg}: 0 < beam <= 120 degrees')
    c = 2 * math.cos(math.radians(beam_deg) / 2) - 1   # smoothstep(u) = 1/2 at u = 1/2
    return 2 * math.acos(c), blend, 2 * math.pi * (1 - c) * (1 - blend / 2)


def watts(output):
    """Blender power of a fixture's output (see the emitter models above)."""
    flux = float(output['lm']) / LM_PER_W
    e = output['emitter']
    if e in ('omni', 'linear'): return flux
    if e in ('downlight', 'spot'): return flux * 4 * math.pi / cone(output['beam'])[2]
    raise ValueError(f'unknown emitter {e}')


def _norm(v):
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def emitter(s):
    """The light of one switch record: {name-free dict: type, p, aim (unit vector), energy, size, spot_size, blend, yaw,
    lm, emitter}. Position and aim from the record: a downlight below its lens (aimed at its own live spot's target if it
    has one: the alcove can washes the alcove wall), a track head's spot below the head, a bulb at the fixture's light
    spec (else the centre of its lamp surfaces), a linear emitter just under its diffuser along the spec's long axis."""
    out = s.get('output') or {}
    e = out.get('emitter')
    if e not in EMITTERS or not out.get('lm'): raise SystemExit(f'switch {s["key"]}: no photometric output {out} (export switches.json again)')
    spec, glows = s.get('spec') or {}, s.get('glows') or []
    bottom = min((g['c'][2] - g['size'][2] / 2 for g in glows), default=None)
    centre = [sum(g['c'][k] for g in glows) / len(glows) for k in range(3)] if glows else None
    L = {'emitter': e, 'lm': float(out['lm']), 'energy': watts(out), 'aim': [0.0, 0.0, -1.0], 'size': BULB_RADIUS.get(e, 0.0)}
    if e == 'downlight':
        aimed = next((l for l in s.get('lights') or [] if l.get('t')), None)
        lens = min(glows, key=lambda g: g['size'][0] * g['size'][1]) if glows else None
        if aimed: L['aim'] = _norm([aimed['t'][k] - aimed['p'][k] for k in range(3)])
        base = lens['c'] if lens else (spec.get('p') or s['root'])
        z0 = (lens['c'][2] - lens['size'][2] / 2) if lens else base[2]
        L['p'] = [base[0] + L['aim'][0] * LENS_GAP, base[1] + L['aim'][1] * LENS_GAP, z0 + L['aim'][2] * LENS_GAP]
    elif e == 'spot':
        z = (spec.get('p') or [0, 0, 2.38])[2] - TRACK_DROP
        L['p'] = [s['root'][0], s['root'][1], z]
    elif e == 'omni':
        L['p'] = list(spec['p']) if spec.get('p') else centre
    elif e == 'linear':
        w, h = spec.get('w'), spec.get('h')
        if not (w and h): raise SystemExit(f'switch {s["key"]}: a linear emitter needs a rect light spec (w, h)')
        ax = spec.get('axis') or [1, 0, 0]
        L['p'] = [spec['p'][0], spec['p'][1], (bottom if bottom is not None else spec['p'][2]) - 0.003]
        L['size'] = [float(w), float(h)]; L['yaw'] = math.atan2(ax[1], ax[0])
    if L.get('p') is None: raise SystemExit(f'switch {s["key"]}: nowhere to put its light')
    if e in ('downlight', 'spot'):
        L['spot_size'], L['blend'], _ = cone(out['beam'])
    L['p'] = [round(v, 4) for v in L['p']]; L['energy'] = round(L['energy'], 6)
    return L


def order_of(doc):
    """The lamp groups in their canonical order (lighting_roles.js lampGroupOrder: the bake's texture channels), 'always' last."""
    if 'groups' not in doc or any('group' not in s for s in doc['switches']):
        raise SystemExit('switches.json has no lamp groups: export it again with bake/export/switch_groups.mjs')
    return list(doc['groups'])


def plan(doc):
    """Every switch's light and group: [(group index, switch, emitter)], in switch order."""
    order = order_of(doc)
    return [(order.index(s['group']), s, emitter(s)) for s in doc['switches']]


# ---- Blender ----------------------------------------------------------------------------------------------------------------
def _blackbody(ld, k=LAMP_K):
    ld.use_nodes = True
    nt = ld.node_tree
    bb = next((n for n in nt.nodes if n.type == 'BLACKBODY'), None) or nt.nodes.new('ShaderNodeBlackbody')
    bb.inputs[0].default_value = k
    em = next(n for n in nt.nodes if n.type == 'EMISSION'); nt.links.new(bb.outputs[0], em.inputs['Color'])


def build(scene, doc):
    """Remove every lamp light of the scene and make one per switch (lampgrpNN_KK); tag the lamp surfaces. Returns
    (order, made): made = [{g, name, type, p, energy, lm, emitter, key}]."""
    import bpy
    from mathutils import Vector
    for ob in [o for o in scene.objects if o.type == 'LIGHT' and o.name.startswith('lamp')]:
        bpy.data.objects.remove(ob, do_unlink=True)
    order = order_of(doc); made = []
    for g, s, L in plan(doc):
        k = sum(1 for m in made if m['g'] == g); name = f'lampgrp{g:02d}_{k:02d}'
        kind = {'omni': 'POINT', 'linear': 'AREA', 'downlight': 'SPOT', 'spot': 'SPOT'}[L['emitter']]
        ld = bpy.data.lights.new(name, kind); ld.energy = L['energy']
        if kind == 'AREA':
            ld.shape = 'RECTANGLE'; ld.size, ld.size_y = L['size']
            try: ld.spread = math.pi   # Lambertian
            except AttributeError: pass
        else:
            ld.shadow_soft_size = L['size']
        if kind == 'SPOT': ld.spot_size = L['spot_size']; ld.spot_blend = L['blend']; ld.show_cone = False
        _blackbody(ld)
        ob = bpy.data.objects.new(name, ld); ob.location = L['p']; scene.collection.objects.link(ob)
        if kind == 'AREA': ob.rotation_euler = (0.0, 0.0, L['yaw'])   # faces down (-Z), long side along the axis
        else: ob.rotation_euler = Vector(L['aim']).to_track_quat('-Z', 'Y').to_euler()
        made.append({'g': g, 'name': name, 'type': kind, 'p': L['p'], 'energy': L['energy'], 'lm': L['lm'], 'emitter': L['emitter'], 'key': s['key']})
    glow = surfaces(scene, doc, order)
    for m in made: m['luminance'] = glow.get(m['key'])
    scene['lamp_groups'] = json.dumps({'order': order, 'lmPerW': LM_PER_W, 'groups': groups_of(doc, made)})
    return order, made


def groups_of(doc, made):
    """Per group: its switches' default slots, exterior flag, plan spaces and lumens (cycles_refs.py turns lamps on by them)."""
    order = order_of(doc); out = []
    for i, g in enumerate(order):
        sw = [s for s in doc['switches'] if s['group'] == g]
        dflt = sorted({d for s in sw for d in s['defaultOn']}) if g != 'always' else ['dusk', 'golden', 'noon', 'sunrise']
        out.append({'name': g, 'index': i, 'always': g == 'always', 'exterior': any(s['exterior'] for s in sw), 'defaultOn': dflt,
                    'spaces': sorted({s['space'] for s in sw if s.get('space')}), 'lm': round(sum(m['lm'] for m in made if m['g'] == i), 1)})
    return out


def _emits(m):
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m and m.use_nodes else None
    return b if b is not None and b.inputs['Emission Strength'].default_value > 0 else None


def _area(ob):
    """World-space surface area of a mesh object (one side of every face)."""
    m = ob.matrix_world; me = ob.data; co = [m @ v.co for v in me.vertices]; tot = 0.0
    for p in me.polygons:
        vs = [co[i] for i in p.vertices]
        for i in range(1, len(vs) - 1): tot += (vs[i] - vs[0]).cross(vs[i + 1] - vs[0]).length / 2
    return tot


def surfaces(scene, doc, order):
    """Lamp surfaces: every emitting mesh within 0.3 m of a switch's glow (bounding-box centres) belongs to that switch's
    group (material property lamp_group; a material shared across groups is copied), stops casting shadows (a lamp inside
    its shade lights the room as a translucent shade does) and glows at its fixture's physical luminance for camera,
    glossy and transmission rays only: strength = share x flux / (pi x area), share the flux leaving through it
    (SHADE_SHARE). Emitters near no switch are the 'always' group's (unswitched lamps) and keep their strength.
    Returns {switch key: strength}: the site draws the same luminance (lamp_groups.js, encoding.json members' luminance)."""
    from mathutils import Vector
    by_switch = [(Vector(gl['c']), s) for s in doc['switches'] for gl in s['glows']]
    owner = {}
    for ob in scene.objects:
        if ob.type != 'MESH' or not any(_emits(sl.material) for sl in ob.material_slots): continue
        c = sum((ob.matrix_world @ Vector(v) for v in ob.bound_box), Vector()) / 8
        d, s = min((((c - p).length, s) for p, s in by_switch), key=lambda t: t[0]) if by_switch else (9, None)
        owner[ob] = s if d < 0.3 else None
        # a switched lamp surface: no shadow (the light inside passes it), and probe.py hides it from its camera rays so a
        # probe sees the fixture's light once, from the light itself
        if d < 0.3: ob.visible_shadow = False; ob['lamp_surface'] = True
    area = {}
    for ob, s in owner.items():
        if s is not None: area[s['key']] = area.get(s['key'], 0.0) + _area(ob)
    lum = {}
    for s in doc['switches']:
        if s['key'] in area:
            out = s['output']; lum[s['key']] = SHADE_SHARE[out['emitter']] * float(out['lm']) / LM_PER_W / (math.pi * max(area[s['key']], 1e-6))
    users = {}
    for ob, s in owner.items():
        g = order.index(s['group']) if s else order.index('always')
        for sl in ob.material_slots:
            if _emits(sl.material): users.setdefault(sl.material, set()).add((g, s['key'] if s else None))
    done = {}
    for ob, s in owner.items():
        g = order.index(s['group']) if s else order.index('always'); key = s['key'] if s else None
        for sl in ob.material_slots:
            m = sl.material
            if not _emits(m): continue
            if len(users[m]) > 1:   # one material per (group, switch): a lamp material shared across switches is copied
                tag = (g, key)
                if tag not in done:
                    copy = m.copy(); done[tag] = copy
                sl.link = 'OBJECT'; sl.material = m = done[tag]
            m['lamp_group'] = g
            if s is not None and not m.get('lamp_luminance'): _camera_glow(m, lum[s['key']])
    return lum


def _camera_glow(m, strength):
    """The material's emission at `strength`, seen by camera, glossy and transmission rays but not by diffuse ones (the
    fixture's light already carries its lumens)."""
    nt = m.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Emission Strength'].default_value = strength; m['lamp_luminance'] = strength
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'); surf = out.inputs['Surface']
    if not surf.is_linked or m.get('lamp_camera_only'): return
    src = surf.links[0].from_socket
    # emission alone for non-diffuse rays: mix the shader with the same BSDF minus its emission on diffuse rays
    dark = nt.nodes.new('ShaderNodeBsdfPrincipled'); dark.name = 'lamp_no_emission'
    for i in b.inputs:
        if i.name in dark.inputs and not i.name.startswith('Emission'):
            d = dark.inputs[i.name]
            if i.is_linked: nt.links.new(i.links[0].from_socket, d)
            elif hasattr(i, 'default_value') and hasattr(d, 'default_value'):
                try: d.default_value = i.default_value
                except (TypeError, ValueError): pass
    dark.inputs['Emission Strength'].default_value = 0
    lp = nt.nodes.new('ShaderNodeLightPath'); mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Diffuse Ray'], mix.inputs[0]); nt.links.new(src, mix.inputs[1]); nt.links.new(dark.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], surf); m['lamp_camera_only'] = True
