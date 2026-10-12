Lighting day/dusk verification — HQ, 1280 × 800

Only src/lighting.js and the authorized loading section of src/main.js were edited. batchStatic and the onTime loop are unchanged. No commit, push or server restart.

Both HDRs and their PMREMs are cached before ready; both room bounce targets were already constructed eagerly and are retained. Both time states receive compileAsync plus a covered composer frame (including shadows/background/mirrors/HQ passes). Light arrays stay constant; zero-intensity branches skip point/spot/area calculations. Environment texture swaps no longer invalidate materials with an unchanged mapping. Sun shadows refresh for interactions, the final movement pose, and time changes.

Switch measurements use a real dusk-chip click, performance.now around the apply promise, and the next three composer frames. gl.finish confirms completion of the first frame with the new background. CPU timings exclude this explicit GPU fence. Baseline GPU shader-cache state varied between runs; the original cold living-room first dusk frame took 17.48 seconds, versus 0.725 seconds in the later paired capture.

| Pose / transition | Before apply ms | After apply ms | Before first completed frame ms | After first completed frame ms | Before next 3 render CPU ms | After next 3 render CPU ms |
|---|---:|---:|---:|---:|---|---|
| garden / day → dusk | 21832.4 | 0.4 | 28246.5 | 25.2 | 6413.1, 27.8, 53.2 | 23.8, 32.0, 40.0 |
| garden / dusk → day | 0.4 | 0.3 | 89.6 | 30.0 | 88.1, 22.4, 23.4 | 23.2, 23.3, 36.7 |
| living / day → dusk | 151.9 | 0.4 | 724.8 | 23.6 | 572.0, 18.2, 22.5 | 22.4, 41.9, 20.6 |
| living / dusk → day | 0.4 | 0.4 | 35.0 | 22.4 | 33.8, 32.2, 47.6 | 21.0, 27.1, 21.7 |

All eight final switches made zero network requests, zero shader compile/link calls, and no change in program count. Both interior and exterior movement retain all visible lights. Material version changes observed by the probe come from Three transparent double-sided render handling; they do not create programs.

Same-browser perf comparison with frozen scene sources, using the tools/perf.mjs hq algorithm. Main changes are limited to lighting and loading. Browser numbers vary with other concurrent work; garden/front median frame times increased slightly, while garden p90 and indoor frame times improved.

| Pose | Before median ms | After median ms | Before p90 ms | After p90 ms | Before calls/frame | After calls/frame |
|---|---:|---:|---:|---:|---:|---:|
| living | 30.9 | 22.4 | 44.3 | 27.0 | 2054 | 1325 |
| kitchen | 29.4 | 21.7 | 41.6 | 27.4 | 1763 | 1095 |
| garden | 21.9 | 27.7 | 67.6 | 33.1 | 3500 | 2776 |
| front | 25.3 | 28.3 | 31.5 | 31.8 | 3856 | 3298 |
| primary | 49.1 | 29.7 | 62.5 | 38.3 | 2103 | 1003 |

Loading: paired ready time 8,921 → 9,589 ms (+668 ms). Warm-up itself took 2,944 ms in that run, overlapping/replacing work previously performed in the first visible frames. Additional sky preparation is also completed under the loading screen. With new shaders and a cold driver cache, the first observed warm-up took 26,258 ms (ready at 42,469 ms); a later dusk-start validation with uncached shader variants took 31,049 ms, while cached warm-ups took ~3 seconds. This moves the costly first-switch compilation into loading rather than removing it.

The unmodified command node tools/perf.mjs hq was also run against the final live bundle; results are in perf_final.txt. The lighting changes built successfully before concurrent kitchen imports were added. The final global build currently has unrelated missing-file errors for src/furniture/props_kitchen.js and src/styling_kitchen.js; those files are outside the authorized edit scope. The last successfully built live bundle still contains the lighting changes. Dusk-start, tour dusk stop and door shadow invalidation were verified without browser errors; final details are in lighting_validate.txt.

Day/dusk screenshots at garden (1, 13, 185°) and living (-0.6, -2.2, 75°), all HQ, are assembled at ../../evidence/daynight_compare.jpg. Visual comparison preserves lighting, sky, exposure and reflected appearance. Mean RGB differences are below 1.56/255 per channel; animated foliage/curtains, AO and shadow sampling differ between captures.

Raw logs: switch_before_match.json, switch_after_match.json, lighting_paired_match.txt, perf_final.txt, lighting_validate.txt. Reviewable scoped patch: lighting_changes.patch.
