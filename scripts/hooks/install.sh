#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)

git config core.hooksPath "$repo_root/scripts/hooks"

echo "Git hooks path set to $repo_root/scripts/hooks"
