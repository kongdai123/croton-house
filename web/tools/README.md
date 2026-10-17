# web/tools

## Tests, lint and the pre-push hook

- `npm test` (in `web/`) builds the site, runs every `tools/test_*.mjs` (one node process each, in parallel), `tools/test_package.py`
  and every `bake/scripts/test_*.py`, and exits non-zero on any failure. `node tools/run_tests.mjs [--serial] [--timeout=SECONDS] [name-filter]`
  for a subset.
- `npm run lint` runs eslint (`eslint.config.mjs`) over `src` and `tools`. Errors fail; unused-variable findings are warnings.
- CI (`.github/workflows/pages.yml`) runs lint and tests on every push and pull request; the Pages deploy waits for them on master.
- `tools/pre-push.sh` runs the same lint and tests locally. It is not installed automatically; to enable it from the repository root:

      ln -sf ../../web/tools/pre-push.sh .git/hooks/pre-push

  (In a linked git worktree `.git` is a file; use `ln -sf "$(git rev-parse --show-toplevel)/web/tools/pre-push.sh" "$(git rev-parse --git-common-dir)/hooks/pre-push"`.)

Tests that need a browser or dev server (`_smoke`, `playtest`, `tourtest`, `pets_*`, ...) are manual tools and are not part of `npm test`.
