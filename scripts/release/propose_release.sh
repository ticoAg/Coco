#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

scripts/release/preflight.sh
python3 .codex/skills/gh-release-dmg/scripts/propose_release.py --repo .
