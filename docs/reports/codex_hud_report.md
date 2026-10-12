Implemented all three tasks:

- **Pins:** independent red 小红书, blue 全景, and green 照片 chips, persisted and shared with minimap visibility. Blue/green pins fly to framed cards; click the card or press **C** for compare/pano. Poor photos stay in the list.
- **Tutorial:** bilingual overlay via **? chip**, **?**, or **/**; first-entry display and remembered dismissal. Includes touch instructions.
- **Jump:** **Space** or touch **Jump**, with air control, ceiling/collision limits, and smooth landing. Measured **0.450 m apex**, **0.608 s airtime**. Seated Space stands; tour/fly/pano block jumping.

Build, HUD/map/touch checks, interaction regression, and tour test passed. No console errors. Interaction test setup was adjusted for the new daylight curtain default.

Draw calls stayed roughly flat; pin updates measured **≈0.011 ms/frame**. Whole-scene timings increased during concurrent changes; details are in the report.

[Inspected screenshot sheet](../evidence/hud_sheet.jpg) · [Tests and performance report](notes/hud_report.md)

No commits or pushes.