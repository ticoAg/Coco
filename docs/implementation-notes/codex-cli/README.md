# Codex CLI 原理笔记

本目录用于沉淀 Codex CLI（主要是 `github:openai/codex/codex-rs` 内的 Rust 实现，以及 `tui` / `tui2`）的关键机制与实现原理，便于 AgentMesh GUI 在行为上对齐/复刻。

## 目录索引

- [app-server-api.md](app-server-api.md)：Codex App-Server JSON-RPC API 文档（已接入/待接入方法、参数说明）
- `compact/`：`/compact`（上下文压缩/总结）实现机制与差异说明
- [slash-menu.md](slash-menu.md)：[`/`](../../../../../../../../..) 命令菜单实现（Commands、Prompts、Skills 支持）
- [skills-implementation.md](skills-implementation.md)：Skills 选择、发送与注入机制

