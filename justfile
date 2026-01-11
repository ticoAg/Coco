# Root Justfile (Rust + Tauri)
set shell := ["zsh", "-c"]

default:
    @just --list --unsorted

# ==========================================
# 🚀 GUI
# ==========================================

# 安装 GUI 依赖
deps:
    cd apps/gui && npm install

# 运行开发模式
dev:
    cd apps/gui && npm run tauri:dev

# 构建 release app
build:
    cd apps/gui && npm run tauri:build

# ==========================================
# 🦀 Rust
# ==========================================

# 检查代码
check:
    cargo check

# 运行测试
test:
    cargo test

# 格式化代码
fmt:
    cargo fmt

# 检查格式（不修改）
fmt-check:
    cargo fmt --check

# Clippy 检查
lint:
    cargo clippy -- -D warnings

# ==========================================
# 🔄 CI
# ==========================================

# 运行完整 CI 检查（含 GUI 构建）
ci: fmt-check check lint test build
