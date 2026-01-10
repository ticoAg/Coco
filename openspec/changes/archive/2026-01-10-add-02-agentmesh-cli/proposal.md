# Change: add-02-agentmesh-cli

## Summary
定义并引入最小 `agentmesh` CLI（短进程控制面）：创建/查看任务与事件，为后续 subagent 编排与 Codex adapter 提供稳定入口。

## Why
当前 GUI 通过 Tauri 直接调用 Rust orchestrator，但缺少可在终端/脚本中使用的 CLI 接口；同时 `docs/agentmesh/*` 明确推荐“CLI 负责编排与执行，GUI 只读任务目录”。

## What Changes
- 增加 `agentmesh` CLI 的能力范围与输出约定（human + `--json`）。
- 统一工作区根目录解析：支持 `AGENTMESH_WORKSPACE_ROOT`，与 GUI/Tauri 行为保持一致。
- CLI 的 MVP 命令聚焦“任务与事件”（subagent 的 spawn/join 由后续 changes 承担）。

## Non-Goals
- 不在本 change 中实现 Codex worker spawn（由 `add-03-codex-exec-adapter` 与 subagent changes 覆盖）。
- 不引入常驻服务或后台 daemon。

## Impact
- Specs（新增）：`agentmesh-cli`
- 受影响代码（实现阶段）：新增 CLI crate/bin；复用 `agentmesh-orchestrator` 与 `agentmesh-core`
