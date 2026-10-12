Only src/tour.js edited. No commit or push.

Poses: (plan x m, plan y m, heading degrees, pitch radians). New pose is the actual hold start after freeSpot; eye is 1.58 m.

| Stop | Old pose | New pose | Caption changes (both languages) | Now in frame |
|---|---|---|---|---|
| 1 | (0, -11.5, 0, 0.06) | (-0.6, -14.9, 0, -0.02) | Unchanged | Front facade, porch and planting |
| 2 | (0, -6.6, 0, 0.06) | (0, -9.1, 0, 0.04) | Unchanged | Both iron columns and the eave |
| 3 | (0, -3.7, 0, 0) | (0, -3.8, 0, -0.03) | Describe the island and dining-room view | Quartz island and dining-room opening |
| 4 | (0.8, -1.9, 165, -0.03) | (0.6, -1.3, 151, -0.14) | Unchanged | Whole pine window seat and book cubbies |
| 5 | (0.4, -1.4, 262, -0.04) | (1.2, -2.8, 280, -0.03) | Unchanged | Quartz island, black tile and oak pendant |
| 6 | (-4.25, -3.7, 318, -0.05) | (-4.2, -4.7, 330, -0.1) | Unchanged | Ping-pong table, chocolate walls and washer/dryer |
| 7 | (-5.3, 4.95, 125, -0.08) | (-5.35, 4.95, 125, -0.18) | Correct 白蜡 to 白洗; describe the platform bed | Whitewashed pine platform bed and headboard |
| 8 | (4.55, -0.4, 180, 0) | (4.55, 1.3, 180, -0.03) | Visible doorway/window seat replaces room/bath count | Bedroom doorway and living-room window seat |
| 9 | (4.75, -2.75, 125, -0.06) | (6, -2.5, 178, -0.22) | Emphasize the dresser beside the bed | Pine bed foreground and unobscured charcoal dresser |
| 10 | (4.6, 2.25, 45, -0.05) | (4.459, 2.199, 40, -0.12) | Unchanged | Acacia bed and garden slider |
| 11 | (1.6, 0.6, 5, 0.02) | (0.65, 1.5, 30, -0.06) | Unchanged | Wishbone chairs, lantern and bookcase bench |
| 12 | (0.4, 2.6, 352, 0.03) | (1.17, 8.9, 180, -0.06) | Patio looking back; remove 20-foot claim | All six leaves of the three glass door pairs |
| 13 | (0.9, 7.4, 20, 0.02) | (3.5, 6.5, 350, -0.08) | Unchanged | Patio and planted garden lounge |
| 14 | (5.5, 11.2, 70, -0.02) | (4.865, 14.535, 230, -0.25) | Unchanged | Fire pit and entire lumber bench |
| 15 | (-1.3, 7.6, 245, -0.09) | (-1.4, 6.4, 280, -0.3) | Describe actual pebbles/slider/planting; remove white | Pebble courtyard, bedroom slider and tropical planting |
| 16 | (1, 13, 185, 0.05) | (3.5, 7.7, 245, -0.06) | Unchanged | Warm interior lights across the patio facade |
| 17 | (0.6, 15.4, 180, 0.04) | (0, 14.5, 180, -0.02) | Unchanged | Lit rear facade, garden lounge and fire pit |

Caption replacements:

- 3: 玄关 · 厨房中岛与通向餐厅的开阔视线 / Foyer · the kitchen island and the open view into the dining room
- 7: 主卧 · 自制白洗松木平台床 / Primary bedroom · the hand-built whitewashed pine platform bed
- 8: 走廊 · 卧室入口与客厅里的窗台座 / Hall · the bedroom doorway and a glimpse of the living-room window seat
- 9: 卧室三 · 松木床旁的炭黑五斗柜 / Bedroom three · the charcoal dresser beside the pine bed
- 12: 露台回望家庭室 · 三组落地玻璃双开门 / Looking back into the family room · three pairs of full-height glass doors
- 15: 主卧小院 · 石子地面、推拉门与热带植物 / Primary courtyard · pebbles, the bedroom slider and tropical planting

Validation: HQ Chrome, 1280 × 800; 34 start/end screenshots with bilingual captions burned in. Real window.__app.tourCtl, route door automation, freeSpot and freeRun were used. Holds were sampled 24 times each; every eye height was 1.58 m. Minimum hold grid clearance: 0.283 m.

Sheet: ../../evidence/tour_vet.jpg
Pose/clearance data: tour_vet.json
Subject ray picks: tour_picks.txt (additional final primary, courtyard and dresser picks were run separately).

Build passed again after the concurrent kitchen imports were completed. Tour route test: no clipping reports or door-leaf intersections after opening route doors at departure. Existing nav routing has a 0.10 m conservative grid clearance at the garage doorway in transit; all holds exceed 0.25 m. No unresolved caption/framing issues.

The dusk stop and all 17 stops remain in their original order. Drifts are limited to 0–1° of yaw and 0–0.30 m of requested push, with 0.25 m clearance used by freeRun.
