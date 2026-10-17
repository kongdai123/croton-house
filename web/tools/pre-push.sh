#!/bin/sh
# Optional pre-push gate: lint, then the full test suite. Install with:
#   ln -sf ../../web/tools/pre-push.sh "$(git rev-parse --git-dir)/hooks/pre-push"
# (in a linked worktree use: ln -sf "$(git rev-parse --show-toplevel)/web/tools/pre-push.sh" "$(git rev-parse --git-common-dir)/hooks/pre-push")
set -e
cd "$(git rev-parse --show-toplevel)/web"
npm run lint --silent
npm test --silent
