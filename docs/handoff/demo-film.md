# Handoff: refine the demo film

You are picking up the croton-house demo film: a 2:50 walkthrough video of the site, made for the owner's uncle, who
is selling the house at 2513 Croton Ave. Version 1 exists and is good. Your job is to make it better, not to start over.

## Where things are

- **The site:** `web/` in this repo, deployed from `master` to https://kongdai123.github.io/croton-house/.
  Version 1 was recorded from master `4e22642`. Master has since gained only CI changes, so the site looks the same.
- **The film tools:** on branch `video/demo` (worktree `../croton-wt/video` next to this checkout, commits `67706b4`,
  `db8ad9d`), in `web/tools/video/`:
  - `choreography.js`: the script, run in the page. It reuses the site's demonstration (`web/src/demo.js`: caption
    strip, frame-clock tasks, helpers such as `face`, `lookAt`, `drag`, `stage`) with a longer sequence.
    `window.__video.hold()` makes the recorder wait in wall-clock time, without stepping, while a lighting slot,
    panorama or picture loads.
  - `record.mjs`: the recorder. It serves a built site folder, opens headless Chromium on a GPU, runs the
    choreography and steps the app frame by frame with `window.renderAt` (30 fps), writing numbered JPEGs plus
    `meta.json` (step captions with times, holds, errors). `--every N` makes a quick preview. Usage is in its header.
  - `encode.sh`: H.264 High, CRF 18, TV-range yuv420p, with the site's 283 s music track faded in and out.
  - `contact.py`: a contact sheet of one frame every N seconds, labelled with its time.
- **Version 1 output:** `bake/cluster/video/` (git-ignored, on the owner's Mac):
  - `croton_demo_zh.mp4` and `croton_demo_en.mp4` at 1080p;
  - `*_720p.mp4` copies under 30 MB;
  - `contact_zh.jpg` and `contact_en.jpg`;
  - the cluster job wrappers `video_job.sh` and `encode_job.sh`.

  The wrappers hold cluster paths, so they stay untracked.
- **Cluster:** the recorded frames and the site copy are in `$R/site_video`. Read `bake/AGENTS_BRIEF.md` and
  `bake/cluster/env.sh` (git-ignored, owner's Mac only) for `$HOST`, `$R`, Node and Playwright paths.

## How version 1 is built (timestamps)

| Time | Scene |
|---|---|
| 0:00 | Over the front garden, down the front walk, in through the front door |
| 0:13 | Kitchen and window seat |
| 0:22 | Sit on the sofa, stand up |
| 0:29 | Call and pet the dog |
| 0:34 | Call and pet the cat |
| 0:39 | RedNote comparison 1, the window seat: pointer opens media, then RedNote, then Go; the camera walks there and the photo floats beside the view |
| 0:57 | Pull out a dining chair and put it back |
| 1:01 | Primary bedroom |
| 1:12 | RedNote comparison 2, the bed facing the garden |
| 1:28 | Primary bath |
| 1:31 | Zillow panorama: enter, look around, leave |
| 1:40 | Office, out through the glass doors to the patio |
| 2:06 | Time of day, holding still in the garden facing the glass doors: sunrise, 2:08 noon, 2:13 golden hour, 2:18 blue hour with the lamps on. Each slot loads fully before its 1.5 s crossfade |
| 2:23 | The lit fire pit |
| 2:28 | RedNote comparison 3, the lit house at dusk |
| 2:45 | "Now the house is yours", fade out |

Both languages have identical timing. The English version keeps the RedNote post titles in Chinese because the posts
are Chinese.

## Known weaknesses: start here

1. **Sunrise interiors are very warm and orange.** Sunrise is the site default. Consider recording the indoor walk at
   noon or golden hour, and only use sunrise inside the time-of-day sequence. Check with the owner which looks best.
2. **The primary bath (1:28) is dark,** because its light is off by default.
   - Either switch it on in the choreography (a visitor can), or wait for the owner's decision on default lamps.
   - Do not change the site's defaults yourself (see below).
3. **The camera faces a plain wall around 1:42** on the way from the bath to the office. Tighten that path.
4. **Only one panorama, and the east-wing baths are never shown.**
   - A short outdoor panorama would add variety, as would Bath B or the hall bath, which now have their own lights.
   - Both would push the film past 3 minutes; trim waits elsewhere to compensate.
5. **The pets appear only in the living room.** They are staged on the patio for the garden scenes but end up out of frame.
6. **Pacing:** some walks are long, for example the dusk walk to RedNote comparison 3 (about 6 s in the dark). Aim
   for a steady rhythm and keep the total at 2–3 minutes.
7. **A trimmed fire-pit walk:** walking to the fire pit was dropped because the route crossed its ring and the umbrella.

## Rules (the project's, not optional)

- **Read first:** `docs/architecture-lighting.md` and `docs/audit/postmortem.md`.
  - The project was refactored after a long run of one-off patches.
  - Every bug needs a root cause, a fix for its whole class, and a check that would have caught it.
  - Do not patch site behaviour to make one shot look right.
- **Site changes:** keep film-only logic in `web/tools/video/`. If the film needs a generic hook in the site, make it
  on its own branch from master with a test. Run `cd web && npm test` (36 tests) and the UI smoke suite on a GPU
  (`bake/validate/RENDER_GATE.md`). Never commit to master directly, and never push: the owner decides.
- **Do not change lighting defaults or calibration:** which lamps are on per time of day, and the lamp-group gains.
  These are open owner decisions:
  - turn the primary bedroom and bath lights on at golden hour;
  - calibrate the lamp brightness to Cycles (dusk with every switch on is about 1.3 stops too bright).
- **The repo is public:**
  - No personal names, usernames, machine or cluster paths in tracked files; `web/tools/test_no_personal_paths.mjs`
    enforces it.
  - Never write "AI" on the site.
- **Rendering location:** never run headless Chrome, Blender or GPU work on the owner's Mac (it lags their machine).
  Render on the cluster.
- **Cluster rules (strict):**
  - Nothing heavy on the login node: only file ops, rsync/scp, sbatch/squeue/scancel.
  - Compute only in scavenger GPU jobs you submit (the partition in `bake/cluster/job.sh`; 1–2 GPUs, named
    `croton-video-*`), never the CPU queue.
  - Never touch the owner's own jobs: only cancel jobs you submitted by name (`bake/AGENTS_BRIEF.md` names the
    others to leave alone).
  - All agents share one ssh ControlMaster: detach work, poll at most once a minute. If it is down (it needs the
    owner's 2FA), stop and ask.
- **Review before delivering:**
  - Make a low-rate preview (`record.mjs --every 6`) and a contact sheet, and look at them yourself.
  - Fix cameras in walls, black frames, missing pets, unloaded panoramas or pictures, and bad UI overlaps.
  - Then record and encode both languages.

## Delivering

- **Films:** put the new `croton_demo_{zh,en}.mp4`, 720p copies under 30 MB, and contact sheets into
  `bake/cluster/video/v2/`.
- **Code:** commit choreography and tool changes on `video/demo` (or a new branch from it).
- **Report:** the changes with timestamps, what you could not do, and the cluster jobs you ran, confirming none are
  left running.
