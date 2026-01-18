#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

scripts/release/preflight.sh

tool=".codex/skills/gh-release-dmg/scripts/propose_release.py"
if [[ ! -f "$tool" ]]; then
  cat >&2 <<'EOF'
[propose_release] Missing release proposal tool:
  .codex/skills/gh-release-dmg/scripts/propose_release.py

This repository uses tag-driven GitHub Actions releases (push vX.Y.Z tag).
You can still preflight locally via:
  scripts/release/preflight.sh

And validate versions match your intended tag:
  node scripts/check-version.mjs --expected X.Y.Z
EOF
  exit 2
fi

python3 "$tool" --repo .
