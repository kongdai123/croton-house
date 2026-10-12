Implemented: both skies and bounce environments are cached, both states warm during loading, lights stay enabled with zero-intensity shader guards, and shadows refresh on movement or time changes.

HQ click → completed frame:

| Switch | Before | After |
|---|---:|---:|
| Garden → dusk | 28.25 s | 25 ms |
| Garden → day | 90 ms | 30 ms |
| Living → dusk | 725 ms | 24 ms |
| Living → day | 35 ms | 22 ms |

`applyTime`: **0.2–0.8 ms**, zero requests/compiles. Next three renders stayed below **45 ms**.

Paired HQ median frame times, before → after: living **30.9→22.4**, kitchen **29.4→21.7**, garden **21.9→27.7**, front **25.3→28.3**, primary **49.1→29.7 ms**. Garden p90 improved **67.6→33.1 ms**.

Loading added **0.67 s** in the cached comparison; cold shader warm-up took **26–31 s** behind the loading screen.

The look is preserved in the [comparison sheet](../evidence/daynight_compare.jpg). Dusk-start, tour and door-shadow checks passed. [Full measurements](notes/lighting_report.md).

The lighting changes built successfully. The latest global build is blocked by concurrent edits importing missing `props_kitchen.js` and `styling_kitchen.js`, outside my authorized scope.