# Root Justfile (Rust + Tauri)
set shell := ["zsh", "-c"]

default:
    @just --list --unsorted

# ==========================================
# 🚀 GUI
# ==========================================

# 安装 GUI 依赖
deps:
    if [ "$(uname -s)" = "Linux" ] && [ -f /etc/os-release ]; then \
        . /etc/os-release; \
        if [ "$ID" = "ubuntu" ]; then \
            echo "[just] Ubuntu detected, installing system deps for Tauri..."; \
            sudo apt-get update; \
            WEBKIT_PKG=libwebkit2gtk-4.1-dev; \
            if ! apt-cache show "$WEBKIT_PKG" >/dev/null 2>&1; then \
                WEBKIT_PKG=libwebkit2gtk-4.0-dev; \
            fi; \
            sudo apt-get install -y \
                "$WEBKIT_PKG" \
                build-essential \
                curl \
                wget \
                file \
                libxdo-dev \
                libssl-dev \
                libayatana-appindicator3-dev \
                librsvg2-dev \
                libgtk-3-dev; \
        fi; \
    fi
    cd apps/gui && npm install

# 检查 GUI 依赖（缺失/过期时自动安装）
ensure-gui-deps:
    cd apps/gui && if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ package.json -nt node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then echo "[just] GUI deps missing/stale, running npm install..."; npm install; fi

# 运行开发模式
dev: ensure-gui-deps
    cd apps/gui && npm run tauri:dev

# 构建 release app
build: ensure-gui-deps
    cd apps/gui && npm run tauri:build

# GUI（前端）
fe-fmt: ensure-gui-deps
    cd apps/gui && npm run format

fe-fmt-check: ensure-gui-deps
    cd apps/gui && npm run format:check

fe-check: ensure-gui-deps
    cd apps/gui && npm run typecheck

fe-lint: ensure-gui-deps
    cd apps/gui && npm run lint

fe-test:
    @echo "[just] GUI tests not configured; skipping"

fe-build: ensure-gui-deps
    cd apps/gui && npm run build

# ==========================================
# 🦀 Rust
# ==========================================

# Rust（后端）
be-check:
    cargo check

be-test:
    cargo test

be-fmt:
    cargo fmt

be-fmt-check:
    cargo fmt --check

be-lint:
    cargo clippy -- -D warnings

be-build:
    cargo build

# 检查代码
check: be-check fe-check

# 运行测试
test: be-test fe-test

# 格式化代码
fmt: be-fmt fe-fmt

# 检查格式（不修改）
fmt-check: be-fmt-check fe-fmt-check

# Clippy 检查
lint: be-lint fe-lint

# ==========================================
# 🔄 CI
# ==========================================

# 运行完整 CI 检查（含 GUI 构建）
ci: fmt check lint test build

# ==========================================
# 🏷️ Release helpers
# ==========================================

# 统一 bump 版本号（同时更新 Rust crates + GUI + lockfiles）
# 用法：just bump-version 1.1.0
bump-version VERSION:
    node scripts/bump-version.mjs --to {{VERSION}}

# ==========================================
# 🏷️ Release helpers
# ==========================================

# 统一 bump 版本号（同时更新 Rust crates + GUI + lockfiles）
# 用法：just bump-version 1.1.0
bump-version VERSION:
    node scripts/bump-version.mjs --to {{VERSION}}
