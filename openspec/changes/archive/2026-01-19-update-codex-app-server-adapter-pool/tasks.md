# Tasks: update-codex-app-server-adapter-pool

## 1. Spec
- [x] 1.1 在 `codex-app-server-adapter` spec delta 中新增 “App-Server Pool” 的行为约定（appServerId / codexHome / 路由）。
- [x] 1.2 明确 pool key（MVP：codexHome；可扩展：profile/cwd）与冲突处理策略。

## 2. Implementation
- [x] 2.1 Tauri: 引入 `CodexAppServerPool`（按 appServerId 管理多进程实例）。
- [x] 2.2 Tauri: spawn app-server 时支持指定 `codexHome`，并设置 `CODEX_HOME` env。
- [x] 2.3 Tauri: 所有 codex RPC 命令扩展 `appServerId`（或等价 handle）参数；保持向后兼容策略（例如 default appServerId）。
- [x] 2.4 Tauri: streaming events 增加 `appServerId` 字段，前端可按 app-server 路由。
- [x] 2.5 清理：app-server 实例的 shutdown / LRU / idle eviction（MVP 可只做显式 shutdown + 最大数量上限）。

## 3. Validation
- [x] 3.1 `openspec validate update-codex-app-server-adapter-pool --strict`
- [x] 3.2 `cargo test`（至少覆盖 [`apps/gui/src-tauri`](../../../../apps/gui/src-tauri) 构建）
- [x] 3.3 `npm -C apps/gui run build`
