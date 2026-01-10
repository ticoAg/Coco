# Tasks: add-03-codex-exec-adapter

## 1. Spec
- [ ] 定义 worker runner 的最小行为：启动命令、环境变量、落盘路径、退出码映射、失败/阻塞语义。
- [ ] 定义 `session.json` 的最小字段集合（threadId/cwd/codexHome/recording paths）。

## 2. Implementation (apply 阶段执行)
- [ ] 在 `crates/agentmesh-codex` 实现 `codex exec --json` runner（spawn/kill、stdout JSONL 落盘、stderr 落盘）。
- [ ] 记录 `thread_id` 并写入 `session.json`，为后续 resume 做准备。
- [ ] 支持 `--output-schema schemas/worker-output.schema.json` 与 `--output-last-message` 落盘到 `artifacts/final.json`。

## 3. Validation
- [ ] `openspec validate add-03-codex-exec-adapter --strict`
- [ ] `cargo test -p agentmesh-codex`
