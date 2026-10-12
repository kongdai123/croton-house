Added **40 placements**, including 19 in the side bedrooms, using 21 reusable prop builders. Only the assigned files were edited; no commits or pushes.

Photo references: books inspired by g26–28, the rattan egg lamp from g27/g52, and folded towels from g30/g36. Complementary styling includes linen lamps, botanical art, ceramics, carafes/glasses, plants, baskets with throws, cushions, slippers, candles, soap trays, towel bars/rings, bath mats, paper holders and a robe.

Build and runtime checks pass. Door swings are clear; added geometry totals **49,536 triangles**.

Comparison sheets:

- [Bedrooms](../evidence/decor_rooms_bedrooms.jpg)
- [Cabinet, closet and dresser details](../evidence/decor_rooms_details.jpg)
- [Bathrooms](../evidence/decor_rooms_baths.jpg)
- [Before / after](../evidence/decor_rooms_before_after.jpg)

One existing issue remains outside my files. At [layout.js:121](/Users/masenov/Documents/GitHub/croton-house/web/src/layout.js:121), move this shrub south to approximately `y: -6.9`; its foliage currently penetrates bedroom 3 beneath the window:

```js
{ m: 'plants', i: 'shrubGreen', x: 6.8, y: -6.0, seed: 1 },
```