# /compact 原理笔记

本目录聚焦 Codex CLI 的 `/compact` 机制，目标是：

- 精准定位实现原理（文件路径 + 行号）
- 解释 remote vs local 两种 compaction 路径的输入/输出与事件序列
- 说明 `gpt-5.2-codex` 与 `gpt-5.2` 在 `/compact` 上“由代码可确定”的差异点，便于 GUI 复刻

## 目录索引

- `flow-and-implementation.md`：`/compact` 触发链路与实现细节（`tui2` → `protocol` → `core`）
- `model-differences.md`：`gpt-5.2-codex` vs `gpt-5.2` 在 `/compact` 上的差异（配置/行为影响点）
