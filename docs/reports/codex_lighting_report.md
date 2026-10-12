Implemented realistic window fill, brighter ceiling bounce, separate indoor/outdoor environments, smooth exposure adaptation, and warm dusk glow. Neutral won the tone-mapping comparisons. HQ remains the desktop default.

M3 Max, 1280×800 HQ, GPU-synchronized `renderAt` fps:

| View | Before | After |
|---|---:|---:|
| Living | 28 | 70 |
| Garden | 14 | 45 |
| Dusk patio | 20 | 57 |

Live frame-loop results: **59 / 46 / 53 fps** respectively. Build, lighting toggles, door shadows, AO, and retina resizing passed.

All nine reviewed comparison sheets are `../evidence/light_{05,09,14,20,26,33,34,41,45}_after.jpg`. [Report and clickable sheet index](notes/lighting_report.md).

Recommended lead edits, detailed in the report:

- `living.js`: leather roughness `0.78`, clear its roughness map.
- `dining_parts.js`: soften ash grain and reduce bump scale to `0.003`.
- `materials.js`: glass opacity `0.07`, neutral white tint.
- `layout.js`: recognize mirror material arrays; use one Reflector per cabinet.

No commit or push.