// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.
import { insideGLSL } from '../plan.js';

// The house's outline (plan.js isInside, the plan model's one inside test): 1.0 outside, 0.0 inside, on plan (x, north).
// Wet ground is outside it; the probe volume never blends a cell across it.
export const HOUSE_GLSL = insideGLSL('outsideHouse') + '\n';
