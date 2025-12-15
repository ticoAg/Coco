# Root Justfile
set shell := ["zsh", "-c"]

# 默认列出所有命令
default:
    @just --list --unsorted

# ==========================================
# 🚀 快速启动
# ==========================================

# 前端命令入口 (just frontend dev/deps)
frontend action:
    #!/usr/bin/env zsh
    if [[ "{{action}}" == "dev" ]]; then
        cd apps/gui && npm run dev
    elif [[ "{{action}}" == "deps" ]]; then
        cd apps/gui && npm install
    else
        echo "Unknown action: {{action}}. Available: dev, deps"
        exit 1
    fi

# 后端命令入口 (just backend dev/deps)
backend action:
    #!/usr/bin/env zsh
    if [[ "{{action}}" == "dev" ]]; then
        uv run --package agentmesh-orchestrator python -m agentmesh_orchestrator
    elif [[ "{{action}}" == "sync" ]]; then
        uv sync
    else
        echo "Unknown action: {{action}}. Available: dev, deps"
        exit 1
    fi

# ==========================================
# 🛠️ 构建与安装
# ==========================================

# 安装所有依赖
install:
    just backend deps
    just frontend deps

# ==========================================
# 🧹 检查与测试
# ==========================================

# 运行所有检查 (Python Linting + Testing)
check: lint test

# 运行 Python 代码风格检查 (Ruff + Mypy)
lint:
    uv run ruff check .
    uv run mypy packages/

# 运行 Python 测试
test:
    uv run pytest

# 运行特定包的测试 (e.g. just test-pkg agentmesh-core)
test-pkg package:
    uv run pytest packages/{{package}}

# ==========================================
# 📦 辅助工具
# ==========================================

# 清理所有临时文件
clean:
    rm -rf .venv
    find . -name "__pycache__" -type d -exec rm -rf {} +
    find . -name "dist" -type d -exec rm -rf {} +
    find . -name "build" -type d -exec rm -rf {} +
    find . -name "*.egg-info" -type d -exec rm -rf {} +
