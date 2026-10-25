// Lens shift (a view camera's rise and fall): the frame slides across the image plane while the camera stays level, so a
// ceiling, a roof line or a floor comes into the frame and vertical lines stay parallel, as an architectural
// photographer's shift lens does (pitching the camera instead makes them converge). An off-axis projection, kept in
// three's own view offset, so every updateProjectionMatrix (a resize, a change of field of view) keeps it, and everything
// that reads the camera's projection (culling, picking, TAA's jitter and reprojection, the path tracer's rays) agrees.
// TAA starts its history afresh when the projection changes, so a shot should hold its shift (change it across a cut).
// y: frame heights, positive moves the frame up (rise: more ceiling, less floor); x: frame widths, positive to the right.
// The optical axis then crosses the image at uv (0.5 - x, 0.5 - y): lens.js centres its vignetting there.
// three's setViewOffset sets the camera's aspect to fullWidth / fullHeight, so the full frame is given in the camera's own
// aspect (a 1 x 1 frame squeezed a 16:9 view to a square's field of view); the offsets are fractions of it, so a later
// resize (main.js sets the aspect) keeps them.
export function setLensShift(camera, y = 0, x = 0) {
  if (!x && !y) { if (camera.view?.enabled) camera.clearViewOffset(); else camera.updateProjectionMatrix(); return; }
  const a = camera.aspect;
  camera.setViewOffset(a, 1, x * a, -y, a, 1);
}
export function lensShift(camera) {
  const v = camera.view;
  return v?.enabled ? { x: v.offsetX / v.fullWidth, y: -v.offsetY / v.fullHeight } : { x: 0, y: 0 };
}
