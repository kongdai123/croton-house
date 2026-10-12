Implemented smooth bilingual toggles for curtains, cellular shades, and the umbrella, including moving ribs, runner, and refreshed shadows. The fire pit lights automatically at dusk and supports manual lighting/extinguishing, with flames, embers, sparks, and warm glow.

[Standing-pose screenshot sheet](../evidence/interact_sheet.jpg)

HQ headless checks passed: hover labels, clicks both ways, easing, shadows, chair sit/drag/put-back, and French-door opening. No runtime errors. [Test results](notes/interact_results.json) · [Test script](notes/interacttest.mjs)

Changed `src/interact.js`, `src/layout.js`’s registration line, and `src/furniture/{decor,outdoor,outdoor_parts}.js`. Build passes.

Curtains toggle individually. Optional lamp switches were omitted. No commits or pushes.