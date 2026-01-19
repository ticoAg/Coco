# 会话数据流与聚合逻辑（Codex VSCode 插件 ↔ AgentMesh GUI 对照）

> 目标：梳理“原始事件/数据 → 结构化 item → 聚合/分组 → UI 展示”的路径，并标注关键函数/变量定位，便于对齐 VSCode 插件的行为。

---

## 1. Codex VSCode 插件侧（plugin-index.js）

### 1.1 事件流 → 线程状态（reasoning deltas 的处理）
- 事件处理逻辑会维护 reasoning 的 `summary[]` / `content[]` 数组，并按 index 增量更新。
- 相关 case：
  - `item/reasoning/summaryTextDelta`（`plugin-index.js:44789`）
  - `item/reasoning/textDelta`（`plugin-index.js:44818`）
  - 使用 `summaryIndex` / `contentIndex` 来定位数组位置（`ensureBufferIndex`）。

### 1.2 Turn items → 本地渲染 items
- `mapStateToLocalConversationItems`（`plugin-index.js:77848`）
  - `agentMessage` → `assistant-message`（流式判定：仅 turn 最后一条且 turn inProgress）。
  - `reasoning`：**只迭代 `summary[]`，每个 summary entry 生成一个独立 reasoning item**；最后一条在 inProgress 时保持未完成状态。
  - `commandExecution`：使用 `commandActions` → `mapCommandActionToParsedCmd` 生成 `parsedCmd`；输出结构体只在有 `aggregatedOutput` 或 `exitCode` 时出现。

### 1.3 读文件聚合（Reading）
- `mergeReadingItems`（`plugin-index.js:78073`）
  - 把连续 `exec` 且 `parsedCmd.type === "read"` 的 item 合并成 `reading-files`。
  - 合并后的 item 结构：`{ type: "reading-files", execItems: [...] }`。

### 1.4 探索分组（ExplorationAccordion）
- `segmentAgentItems`（`plugin-index.js:278685`）
- `isExplorationStarter`（`plugin-index.js:278725`）：
  - `reading-files` 或 `exec` 且 `parsedCmd.type` 是 `list_files/search/read`。
- `isExplorationContinuation`（`plugin-index.js:278734`）：
  - 继承 starter + `reasoning`。
- `getUniqueReadingCount`（`plugin-index.js:278737`）：统计唯一文件数，驱动标题 “Exploring/Explored N files”。
- `ExplorationAccordion`（`plugin-index.js:278335`）：
  - `status` 为 exploring 时标题为 “Exploring”；结束为 “Explored”，并带 unique file count。

---

## 2. AgentMesh GUI 侧（当前实现）

### 2.1 数据获取（thread/resume + rollout restore）
- `codex_thread_resume`（`apps/gui/src-tauri/src/lib.rs:946`）
  - 调用 `thread/resume` 后，执行 `codex_rollout_restore::augment_thread_resume_response`（`apps/gui/src-tauri/src/lib.rs:954`）。

### 2.2 rollout 还原与合并
- `parse_rollout_activity_by_turn`（`apps/gui/src-tauri/src/codex_rollout_restore.rs:459`）
  - 通过 `event_msg` 的 `user_message` 切分 turns；
  - `response_item` 类型映射：
    - `reasoning`：若 `summary` 非空且 `content` 为空，生成 reasoning item，并追加 placeholder（`rollout_placeholder("reasoning")`）。
    - `function_call`/`exec_command`：生成 `commandExecution`（`commandActions` 为空）。
    - `custom_tool_call`/`apply_patch`：生成 `fileChange`。
    - `function_call_output`：回填 `aggregatedOutput`/`status`。
- `merge_turn_items`（`apps/gui/src-tauri/src/codex_rollout_restore.rs:819`）
  - 通过 placeholder（reasoning/agent/user）与 `type:id` key 合并 rollout 与 server items。
  - 完成后调用 `dedupe_adjacent_reasoning`（`apps/gui/src-tauri/src/codex_rollout_restore.rs:258`）去重相邻 reasoning。

### 2.3 UI 侧 item 映射与增量（对齐后）
- `normalizeThreadFromResponse`（[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)）：直接取 `res.thread`。
- `entryFromThreadItem`（[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)）：
  - `reasoning` → 保留 `reasoningSummary` / `reasoningContent` 数组，`text` 由 `buildReasoningText` 组装。
  - 渲染层通过 `expandReasoningEntries` + `buildReasoningSegments` 把 `summary[]` 拆成多个 reasoning block，**最后一段追加 content**。
  - 若 `summary[]` 为空但 `content` 有值，优先合并到前一条 reasoning block，避免额外标题（无前置 reasoning 时仍单独显示）。
- 增量事件处理：
  - `item/reasoning/summaryTextDelta` / `item/reasoning/textDelta` → `applyReasoningDelta`，按 `summaryIndex` / `contentIndex` 更新数组。
  - `item/reasoning/summaryPartAdded` / `item/reasoning/contentPartAdded` → `applyReasoningPartAdded` 预扩展数组长度。

### 2.4 聚合/分组（对齐后）
- `mergeReadingEntries`：在 Working 数据层合并连续 `read`。
- `segmentExplorationItems`：把 `list_files/search/read + reasoning` 串成 exploration 组。
- `formatExplorationHeader`：生成 “Exploring/Explored N files” 标题。
- `parseCommand`：命令解析用于探索分组与标题生成（[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)）。
  - `sed -n` / `nl -ba` 识别为 `read`，`sed -i`（或 `--in-place`）避免误判。
  - 支持管道命令按 segment 解析（`rg ... | head` / `nl ... | sed -n ...`）。
- `getCmdSummary`：unknown/format/test/lint/noop 等命令的标题优先展示原始 `command`（保留 shell wrapper）。
- `normalizeCommandOutput`：对 `exec_command` 输出做清理，去除 `Chunk ID/Wall time/Exit code/Original token count/Output:` 等元信息，仅保留实际 stdout/stderr（命令 block 与 reading group 均使用）。
- `formatCommandLine` / `prefixCommandLine`：命令 block 的内容首行固定输出 `$ '...'`（保留原始 wrapper 的字符串）；reading group 在有输出时同样添加首行命令，避免重复 `$` 前缀。

---

## 3. 差异精准定位与排查方法（推荐流程）

### 3.1 锁定数据源与会话范围
- GUI 侧真实渲染数据来自 `thread/resume` + rollout 还原：
  - `codex_thread_resume` → `augment_thread_resume_response`（[`apps/gui/src-tauri/src/lib.rs`](../../../apps/gui/src-tauri/src/lib.rs) / [`apps/gui/src-tauri/src/codex_rollout_restore.rs`](../../../apps/gui/src-tauri/src/codex_rollout_restore.rs)）。
- rollout 路径优先取 `thread.path`，缺失时会在 `~/.codex/sessions` 下按 `threadId` 模糊检索（`augment_thread_resume_response`）。
- 建议先记录目标 turn 的输入文本（`event_msg.user_message`），确保与 VSCode 插件显示的是同一轮。

### 3.2 用 rollout 精确切分 turn 与取样
- turn 划分规则：`event_msg` 的 `user_message` 作为新 turn 起点（`parse_rollout_activity_by_turn`）。
- 快速定位某 turn 的 reasoning 标题与命令（示例脚本，找到目标标题后输出该 turn 的命令序列）：

```bash
python3 - <<'PY'
import json
from pathlib import Path
path = Path('~/.codex/sessions/2026/01/14/rollout-...jsonl').expanduser()
turn_index = -1
current = None
target_title = 'Designing reasoning summary segmentation and grouping'
with path.open() as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get('type') == 'event_msg' and obj.get('payload', {}).get('type') == 'user_message':
            turn_index += 1
            current = {'turn': turn_index, 'reasoning': [], 'commands': []}
            continue
        if obj.get('type') != 'response_item' or current is None:
            continue
        payload = obj.get('payload', {})
        if payload.get('type') == 'reasoning':
            summary = payload.get('summary') or []
            if summary and isinstance(summary[0], dict):
                current['reasoning'].append(summary[0].get('text', ''))
        if payload.get('type') == 'function_call' and payload.get('name') == 'exec_command':
            args = payload.get('arguments', '')
            try:
                args = json.loads(args).get('cmd', args)
            except Exception:
                pass
            current['commands'].append(args)
        if any(target_title in r for r in current['reasoning']):
            print('TURN', current['turn'])
            print('REASONING TITLES:')
            for r in current['reasoning']:
                print('-', r.splitlines()[0])
            print('COMMANDS:')
            for c in current['commands']:
                print('-', c)
            break
PY
```

### 3.3 对照 `thread/resume` items 与 rollout
- 如果 `thread.turns[].items` 缺少 `commandExecution`，说明探索分组所需活动项来源不足；
- 如果 `commandExecution` 存在但没有 `commandActions`，将回退到 `parseCommand`；
- 合并逻辑位置：`merge_turn_items`（[`apps/gui/src-tauri/src/codex_rollout_restore.rs`](../../../apps/gui/src-tauri/src/codex_rollout_restore.rs)）。

### 3.4 排查探索分组缺失原因
- `resolveParsedCmd` 优先用 `commandActions`，否则走 `parseCommand`；
- `segmentExplorationItems` 只把 `read/search/list_files` 作为探索起点；
- 常见问题：
  - shell wrapper 未解包（已在 GUI 侧处理 `bash/zsh -lc`）；
  - `sed/nl` 未识别为 read，导致探索链中断；
  - 仅有 `reasoning` 而无 `commandExecution`，无探索起点。

### 3.5 UI 渲染与分组路径定位
- `renderTurns` 中的 `workingEntries → expandReasoningEntries → mergeReadingEntries → segmentExplorationItems`
- 相关位置：[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)（`renderTurns`、`segmentExplorationItems`、`parseCommand`）。

---

## 4. 对齐结果（核心差异已消除）

- Reasoning 拆分粒度：已按 `summary[]` 分段渲染，并保留 reasoning content（追加在最后一段）。
- Reading 聚合：已前置合并 `read` 并进入探索分组。
- ExplorationAccordion 分组：已形成 “Exploring/Explored N files” 二级分组。
- Reasoning 增量处理：已按 `summaryIndex/contentIndex` 更新数组。
- 仍可能差异：VSCode 插件的滚动渐隐/内部 accordion 行为与 GUI 交互细节可能略有不同。

---

## 5. 对齐实现备注

- rollout restore 仍复用现有逻辑；如出现 reasoning 段落丢失或合并异常，可评估 `dedupe_adjacent_reasoning` 的影响。

---

## 6. 定位速查表

- 插件：`mapStateToLocalConversationItems`（`plugin-index.js:77848`）
- 插件：`mergeReadingItems`（`plugin-index.js:78073`）
- 插件：`segmentAgentItems`（`plugin-index.js:278685`）
- 插件：`ExplorationAccordion`（`plugin-index.js:278335`）
- 插件：reasoning deltas（`plugin-index.js:44789` / `plugin-index.js:44818`）

- 我们：`entryFromThreadItem`（[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)）
- 我们：`applyReasoningDelta` / `applyReasoningPartAdded`（[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)）
- 我们：`expandReasoningEntries` / `buildReasoningSegments`（[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)）
- 我们：`mergeReadingEntries` / `segmentExplorationItems`（[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)）
- 我们：`formatExplorationHeader`（[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)）
- 我们：`merge_turn_items`（`apps/gui/src-tauri/src/codex_rollout_restore.rs:819`）
- 我们：`parse_rollout_activity_by_turn`（`apps/gui/src-tauri/src/codex_rollout_restore.rs:459`）
