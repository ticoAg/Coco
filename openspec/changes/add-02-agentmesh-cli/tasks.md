# Tasks: add-02-agentmesh-cli

## 1. Spec
- [ ] 定义 CLI 命令集合、参数、输出格式与退出码（MVP：task + events）。
- [ ] 明确 workspace root 的解析优先级（`AGENTMESH_WORKSPACE_ROOT` > repo dev fallback > app-data/workspace）。

## 2. Implementation (apply 阶段执行)
- [ ] 新增 `agentmesh` CLI（二进制）并接入 `agentmesh-orchestrator`：`task create|list|show|events`。
- [ ] 所有命令提供 `--json` 输出（便于 GUI/脚本复用），并保持稳定字段命名。

## 3. Validation
- [ ] `openspec validate add-02-agentmesh-cli --strict`
- [ ] `cargo test -p agentmesh-orchestrator`
