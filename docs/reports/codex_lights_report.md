Made **40 existing fixtures individually toggleable**, with bilingual hover labels and 0.25-second fades.

| Room | Count | Fixtures |
|---|---:|---|
| Living + alcove | 7 | 6 track heads, alcove can |
| Kitchen | 6 | Oak pendant, 3 track heads, 2 hood lamps |
| Dining | 1 | Paper lantern |
| Office | 3 | Track heads |
| Primary + vestibule | 7 | 5 cans, 2 table lamps |
| Primary bath | 2 | Cans |
| Garden bedroom | 5 | 2 cans, 3 table lamps |
| Bedroom 3 | 3 | Can, 2 table lamps |
| Hallway | 2 | Cans |
| Garage | 3 | 2 shop lights, opener lamp |
| Front porch | 1 | Sconce |

Manual state wins until the next actual day/night change, which restores automatic brightness immediately. Fire pit behavior remains unchanged.

All **80 day/dusk hover-and-click cases passed**, with isolated glow changes, linked light changes, and no console errors. Switches took **21–24 ms**, with unchanged shader counts. `interacttest.mjs` passed; chair checks passed with the same headless pointer-lock warnings reproduced in the baseline.

Draw-call deltas: living **+8**, garden **+32**, front **+32**, primary bath **+19**.

[Inspected screenshot sheet](../evidence/lights_sheet.jpg) · [Test results](notes/lights_results.json)

Inventory gaps: the current scene contains no primary paper lantern, floor lamps, vanity lights, or string/garden lights.