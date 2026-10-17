Moved the window centre **39.9 cm west** and widened it from **81 cm to 110 cm**, restoring **20 cm of tile beside the fridge**. Removed only the kitchen shade.

Changed:

- [house.js:33](../../web/src/house.js:33): shared dimensions, opening and adjoining wall pieces.
- [kitchen.js:102](../../web/src/furniture/kitchen.js:102): backsplash follows those dimensions.
- [layout.js:27](../../web/src/layout.js:27): removed shade placement.

Build and geometry checks passed; inspected g18, g12 and outside views. Wall joins close, colliders follow, and exterior trim shows no clipping.

[Real | 3D](../evidence/kwindow_g18.jpg) · [Before | after](../evidence/kwindow_before_after.jpg) · [Outside](../evidence/kwindow_outside.jpg)

**Remaining mismatch:** the unchanged faucet is about 35 cm east of the window centre versus roughly 16 cm in g18. The sink/dishwasher layout still needs correction to match that relationship.