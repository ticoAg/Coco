# 开发指南

本指南介绍了如何使用 [uv workspaces](https://docs.astral.sh/uv/concepts/workspaces/) 在 **AgentMesh Monorepo** 中进行开发。

## 环境设置

1.  **安装 `uv`** (如果尚未安装):
    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

2.  **同步依赖**:
    初始化环境并安装所有包的依赖。
    ```bash
    uv sync
    ```
    这会在根目录下创建一个统一的 `.venv` 虚拟环境。

## 依赖管理

在 Workspace 模式下，依赖管理分为两个层级：
1.  **项目级依赖**：特定于某个包（例如 `packages/agentmesh-orchestrator` 需要 `fastapi`）。
2.  **Workspace 级依赖**：所有包共享的开发工具（例如 `ruff`, `pytest`）。

### 给特定包添加依赖

例如，给 `agentmesh-core` 添加 `requests` 库：

```bash
uv add --package agentmesh-core requests
```

这会更新 `packages/agentmesh-core/pyproject.toml` 以及根目录的 `uv.lock`。

### 添加开发工具（根目录）

例如，添加一个所有包都能用的工具（如 `black`）：

```bash
uv add --dev black
```

这会更新根目录的 `pyproject.toml`。

## 运行命令

由于所有包共享同一个虚拟环境 (`.venv`)，你可以直接从根目录运行命令。

### 运行包中的脚本

运行 CLI 工具：
```bash
uv run agentmesh --help
```

运行特定包中的模块：
```bash
# 运行 orchestrator 模块
uv run --package agentmesh-orchestrator python -m agentmesh_orchestrator
```

### 运行测试

运行所有测试：
```bash
uv run pytest
```

运行特定包的测试：
```bash
uv run pytest packages/agentmesh-core
```

## 内部依赖机制

我们使用 `[tool.uv.sources]` 来链接内部包。例如，`agentmesh-cli` 依赖于 `agentmesh-core`。

在 `packages/agentmesh-cli/pyproject.toml` 中：
```toml
[project]
dependencies = ["agentmesh-core"]

[tool.uv.sources]
agentmesh-core = { workspace = true }
```

当你修改 `agentmesh-core` 的代码时，`agentmesh-cli` **立即生效**，无需重新安装，因为 `uv` 默认以可编辑模式（editable mode）链接它们。

## 项目结构

- **`packages/`**: Python 后端包。
  - `agentmesh-core`: 共享类型定义、Adapter 接口。
  - `agentmesh-cli`: 命令行接口工具。
  - `agentmesh-orchestrator`: 后端编排服务。
  - `agentmesh-codex`: Codex Adapter 实现。
- **`apps/`**: 前端应用。
  - `gui`: React + Vite 应用（由 npm/pnpm 管理，而非 uv）。

## 前端开发

前端应用独立管理，需使用 Node.js。

```bash
cd apps/gui
npm install
npm run dev
```

## 常见问题

- **"Module not found"**: 运行 `uv sync` 以确保虚拟环境与 `uv.lock` 保持一致。
- **Python 版本**: 确保已安装 Python 3.12。`uv` 会自动尝试查找并使用它。

