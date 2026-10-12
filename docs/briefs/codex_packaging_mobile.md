# Codex brief · 2513 Croton Ave walkthrough — packaging + mobile pass

> **Done, kept for history.** `web/tools/package.py` and the mobile pass shipped. The site is now built and deployed by
> `.github/workflows/pages.yml` on every push to `master`. The project moved out of Yireeb to its own repo, `croton-house`.

Project: `/Users/masenov/Documents/GitHub/croton-house/web` (its own repo now). Read `HANDOFF.md` at the repo root first for the layout of the code. A static server already serves `web/` at
http://127.0.0.1:8780 (do not start another). Build with `node tools/build.mjs`. Screenshots: `node tools/shot.mjs "<path?query>" out.png [w] [h]`
(headless system Chrome; `index.html?x=<plan x>&y=<plan y>&h=<heading>&p=<pitch>&fast=1` skips the title screen).

Two jobs. Another agent is editing `src/main.js`, `src/house.js`, `src/layout.js`, `src/viewpoints.js`, `src/furniture/*` right now —
do not touch those. You own: `tools/package.py` (new), `style.css`, `src/ui.js`, `index.html`.

## Job 1 — `tools/package.py`: produce a publishable `build/` folder (hard cap: 240 MB total, 15 MB per file)
- Copy `index.html`, `style.css`, `dist/app.js` (no source maps), `data/*`, and only the assets the app references:
  `assets/tex/*` (downscale every jpg to 1024 px with Pillow, quality 82; keep names), `assets/hdr/*` (keep),
  `assets/photos/*` (resolve the symlink; keep), `assets/panos/*` (resolve the symlink; re-encode to 3072×1536 jpg q85 if larger),
  `assets/rednote/*` (images max 1280 px; the two mp4 files as-is if ≤15 MB each, else re-encode with ffmpeg to fit).
- Print a size report per folder and the total; fail loudly if any file exceeds 15 MB or the total exceeds 240 MB.
- Verify the build works: serve `build/` on another port (e.g. `python3 -m http.server 8781 --directory build`) and take a
  screenshot with `tools/shot.mjs` pointed at it (edit a copy of the URL base inside your command, not the tool), confirm it renders.

## Job 2 — mobile/touch pass (phones are how RedNote readers will open this)
- Use playwright with the iPhone 14 device descriptor (or viewport 390×844, isMobile, hasTouch) against 127.0.0.1:8780 and
  screenshot the title screen, the HUD after entering, the viewpoints panel, the RedNote panel and the big map.
- Fix what breaks in `style.css` / `src/ui.js` / `index.html`: the title card must fit without scrolling; the top bar chips must
  wrap or scroll; panels must be full-width sheets on phones; the minimap smaller; the touch stick/look pad must work (the code is in
  `UI.touchControls`); the compare slider usable with a thumb. Keep the desktop layout unchanged.
- Rebuild (`node tools/build.mjs`) and re-screenshot to prove it.

Report back in a short markdown summary: what you changed, sizes, screenshot paths, and anything you could not fix.
