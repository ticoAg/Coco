# Design: add-task-evidence-index

## Context
Coco 的核心原则是 artifacts-first：任务目录是事实来源。为了让 multi/subagent 的执行过程“可复盘、可审计、可引用”，需要把关键证据从 runtime 事件流中抽取出来，形成结构化索引。

## Goals / Non-Goals
- Goals
  - 为报告/决策/契约提供稳定可引用的 evidence 入口（不复制大段日志）。
  - 让 GUI/脚本可在不解析 vendor 专有格式的情况下定位关键证据。
- Non-Goals
  - 不承诺完整保存所有原始输出（只保证索引与引用指针）。
  - 不在本 change 里做自动化 evidence 生成（先把格式/目录规范定下来）。

## Decisions

### D1: Evidence lives in `shared/evidence/` as an index + references
- `shared/evidence/index.json` 作为 evidence 清单，包含 `EvidenceEntry[]`。
- 每条 evidence 的内容尽量小：只存 `summary + sources + refs`，把大块内容留在 `agents/<instance>/runtime/*` 或其他 artifact 文件中。

### D2: Evidence sources are typed and point to verifiable artifacts
最小支持三类来源：
- `fileAnchor`: 引用 repo 文件路径 + 行号范围（可选附加 snippet，但以文件为真）。
- `commandExecution`: 引用命令字符串 + cwd + 退出码，并用 `stdoutRef/stderrRef` 指向落盘文件。
- `runtimeEventRange`: 引用某个 JSONL 事件文件的行号范围（或 offset），用于复盘“发生了什么”。

### D3: Markdown uses a simple citation token
报告中引用证据使用 `evidence:<id>`（例如：`evidence:cmd-42`），便于 GUI 与脚本解析。

## Risks / Trade-offs
- 如果 runtime 输出没有稳定行号/offset，`runtimeEventRange` 的定位精度会下降。
- 如果文件发生后续变更，`fileAnchor` 的行号可能漂移；应优先在 evidence 中记录 `path + snippet`，并允许 GUI 以 snippet 做二次定位（实现阶段处理）。

## Open Questions
- 是否需要为 evidence index 追加 `sha256`（用于检测被篡改）？
- `fileAnchor` 是否需要支持“git blob hash”级别的稳定引用（未来可选）？
