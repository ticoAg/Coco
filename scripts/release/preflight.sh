#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

node_major=""
if command -v node >/dev/null 2>&1; then
  node_ver="$(node -v)"
  node_major="${node_ver#v}"
  node_major="${node_major%%.*}"
  echo "[preflight] node=$node_ver (CI uses Node 20)"
fi

if [[ -n "${REQUIRE_NODE_20:-}" ]]; then
  if [[ "${node_major:-}" != "20" ]]; then
    echo "[preflight] ERROR: Node major version must be 20 (found ${node_major:-unknown})." >&2
    echo "[preflight] Hint: CI uses actions/setup-node@v4 with node-version=20." >&2
    exit 2
  fi
fi

if [[ -n "${EXPECTED_VERSION:-}" ]]; then
  echo "[preflight] node scripts/check-version.mjs --expected ${EXPECTED_VERSION}"
  node scripts/check-version.mjs --expected "${EXPECTED_VERSION}"
fi

if [[ -z "${SKIP_RUST_PREFLIGHT:-}" ]]; then
  echo "[preflight] cargo fmt --check"
  cargo fmt --check

  echo "[preflight] cargo check --workspace --exclude coco-app"
  cargo check --workspace --exclude coco-app

  echo "[preflight] cargo clippy --workspace --exclude coco-app -- -D warnings"
  cargo clippy --workspace --exclude coco-app -- -D warnings

  echo "[preflight] cargo test --workspace --exclude coco-app"
  cargo test --workspace --exclude coco-app
else
  echo "[preflight] SKIP_RUST_PREFLIGHT set; skipping Rust checks."
fi

if [[ -z "${SKIP_GUI_PREFLIGHT:-}" ]]; then
  echo "[preflight] cd apps/gui && npm ci"
  (cd apps/gui && npm ci)

  echo "[preflight] cd apps/gui && npm run build"
  (cd apps/gui && npm run build)
else
  echo "[preflight] SKIP_GUI_PREFLIGHT set; skipping GUI checks."
fi

if [[ -z "${SKIP_TAURI_PREFLIGHT:-}" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "[preflight] cd apps/gui && npm run tauri:build -- --bundles app --no-sign --ci"
    (cd apps/gui && npm run tauri:build -- --bundles app --no-sign --ci)
  else
    echo "[preflight] non-macOS detected; skipping Tauri .app build."
  fi
else
  echo "[preflight] SKIP_TAURI_PREFLIGHT set; skipping Tauri build."
fi
