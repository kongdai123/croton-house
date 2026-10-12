Three HUD / controls tasks implemented. Owned-file edits only; no commits or pushes.

- RedNote, Zillow panorama and listing-photo pins share rings/arrows/stems through instanced meshes per colour, with 256 px thumbnail canvases. Independent chips and localStorage states also filter minimap/full-map blips and full-map click targets. There are 13 RedNote, 16 panorama and 29 vetted photo pins. All 50 vetted photos remain in the viewpoint list; poor matches have no world pin. Original viewpoint poses remain the fallback when no vetting entry exists.
- Click a pin to fly to its shot pose and show its framed image. Click the blue/green card or press C for compare/panorama. RedNote posts and the Zillow viewpoint list have their own panel chips. Shot camera height stays fixed until movement/jump; idle collision resolution no longer displaces a curated shot pose. Walking/jumping keeps capsule collision.
- ? chip, ? or / shows the bilingual controls overlay. First manual entry shows it until dismissed; dismissal persists. Touch uses joystick/look/Use/Jump instructions and a jump button. Wrapped phone chips and overlays remain clickable above the look pad.
- Space jumps or stands from a seat. C replaces Space for photo comparison/panorama. Jump apex 0.44995 m, airtime 0.60833 s, airborne walking displacement 1.44115 m. Lands at 1.62 m eye height; capsule top respects 2.44 m ceiling; tour/fly/pano block jumping. Bob fades back after landing.

Validation:
- node tools/build.mjs: passed.
- hudtest.mjs: tutorial bilingual/key/chip/first-visit/dismissal; all-colour pin hover, physical clicks, flight/card/image; C compare/pano and mouse-look while in pano; jump standstill/walking/real Space+W, ceiling, seat/tour/fly/pano exclusions; touch help/jump; panel access; no console or page errors. Reload persistence verified per colour in the full run; final HUD_FAST pass skips only those already-verified repeated reloads.
- hud_extra.mjs: map draw/click targets track each toggle; map photo click opens a card; poor photo reachable from list; C closes comparison after slider focus.
- interacttest.mjs: all PASS, no runtime errors.
- node tools/tourtest.mjs: no collision warnings, 0.10 m minimum clearance, 0.016 m maximum height change per frame.
- Syntax checks (ES module mode) and git diff --check: passed.

Performance snapshots (living / garden / front / primary bath):
- Before draw calls: 1093 / 2231 / 2691 / 1939.
- After draw calls: 1077 / 2234 / 2670 / 1936.
- HQ at DPR 2 before CPU submit: 6.6 / 11.1 / 11.6 ms (living / garden / front).
- HQ at DPR 2 after CPU submit: 7.6 / 16.0 / 13.7 ms; median GPU wait 0.0 ms. Other agents also changed furniture/mirror/light code during these snapshots, so the whole-scene before/after is not an isolated pin comparison. See hud_pin_overhead.log for same-scene all/red/off measurements.

Screenshot sheet: ../../evidence/hud_sheet.jpg (visually inspected). Touch screenshot: ../../evidence/hud_touch.png. Jump samples and results: hud_results.json.

Within one scene, median CPU submit with all colours / red only was 15.1 / 15.4 ms (living), 12.8 / 11.4 ms (garden), 12.9 / 12.9 ms (front). The marker update itself averaged approximately 0.011 ms for all 58 pins. These submit measurements remain sensitive to other concurrent Chrome/GPU work.

The final interaction rerun explicitly closes the curtain in test setup before exercising it: a concurrent furniture change now opens curtains automatically in daylight. The interaction assertions are unchanged, and no furniture/lighting source was edited by this task.
