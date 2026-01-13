#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${SKIP_RUST_PREFLIGHT:-}" ]]; then
  echo "[preflight] SKIP_RUST_PREFLIGHT set; skipping Rust checks."
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

echo "[preflight] cargo fmt --check"
cargo fmt --check

echo "[preflight] cargo check --workspace --exclude agentmesh-app"
cargo check --workspace --exclude agentmesh-app

echo "[preflight] cargo clippy --workspace --exclude agentmesh-app -- -D warnings"
cargo clippy --workspace --exclude agentmesh-app -- -D warnings

echo "[preflight] cargo test --workspace --exclude agentmesh-app"
cargo test --workspace --exclude agentmesh-app
