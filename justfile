# Root Justfile (Rust + Tauri)
set shell := ["zsh", "-c"]

default:
    @just --list --unsorted

# ==========================================
# 🚀 GUI (Tauri)
# ==========================================

gui action:
    #!/usr/bin/env zsh
    if [[ "{{action}}" == "deps" ]]; then
        cd apps/gui && npm install
    elif [[ "{{action}}" == "dev" ]]; then
        cd apps/gui && npm run tauri:dev
    elif [[ "{{action}}" == "build" ]]; then
        cd apps/gui && npm run tauri:build
    else
        echo "Unknown action: {{action}}. Available: deps, dev, build"
        exit 1
    fi

# ==========================================
# 🦀 Rust
# ==========================================

rust action:
    #!/usr/bin/env zsh
    if [[ "{{action}}" == "check" ]]; then
        cargo check
    elif [[ "{{action}}" == "test" ]]; then
        cargo test
    elif [[ "{{action}}" == "fmt" ]]; then
        cargo fmt
    else
        echo "Unknown action: {{action}}. Available: check, test, fmt"
        exit 1
    fi

