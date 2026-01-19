# /compact 流程与实现（tui2 / core）

> 目标：沉淀 Codex CLI（`github:openai/codex/codex-rs`）里 `/compact` 的端到端实现路径，精确到关键文件与行号，便于 Coco GUI 复刻同等行为。
>
> 注意：本文聚焦 “手动触发的 `/compact`”。自动触发的 auto-compact 属于同一机制的变体，放在文末附录。

## 1. /compact 是什么

在 Codex CLI 的语义里，`/compact` 用来对“当前会话上下文”做一次“压缩/总结”，以减少后续请求的上下文占用，避免触碰模型 context window 限制。

实现上存在两条路径：

1) **Local compaction（本地总结）**：用当前模型发起一次正常的 streaming turn，请模型根据“压缩提示词”输出一段 summary；然后 core 侧把 summary 变成一条特殊的 user message（带 prefix），并重建历史（保留一部分近期用户消息 + summary）。
2) **Remote compaction（远端压缩 endpoint）**：调用 `/v1/responses/compact`（unary 请求），由服务端返回一份“压缩后的 `ResponseItem` 列表”，core 侧直接替换历史。

两条路径由 core 根据 feature/provider 决定（详见第 4 节）。

## 2. 端到端触发链路（tui2 → protocol → core）

### 2.1 Slash command 定义（tui2）

`/compact` 在 `tui2` 中作为内建命令 `SlashCommand::Compact` 出现：

- 枚举定义：`github:openai/codex/codex-rs/tui2/src/slash_command.rs:12`
- 说明文案：`github:openai/codex/codex-rs/tui2/src/slash_command.rs:45`
- "任务运行时不可用"的 gating：`github:openai/codex/codex-rs/tui2/src/slash_command.rs:71`

### 2.2 /compact 的 dispatch（tui2）

当用户输入 `/compact` 并提交后，`tui2` 的 `ChatWidget` 会：

1) 清空 token 统计（UI 用）
2) 发送 `Op::Compact` 给 core

关键代码位置：

- `github:openai/codex/codex-rs/tui2/src/chatwidget.rs:1562`：
  - `self.clear_token_usage();`
  - `self.app_event_tx.send(AppEvent::CodexOp(Op::Compact));`

### 2.3 协议层 Op 定义（codex-protocol）

`/compact` 最终映射为协议操作 `Op::Compact`：

- `github:openai/codex/codex-rs/protocol/src/protocol.rs:205`（注释说明）
- `github:openai/codex/codex-rs/protocol/src/protocol.rs:208`（`Compact,` 枚举值）

### 2.4 core 侧 handler：注入 compact prompt 并启动任务

core 收到 `Op::Compact` 后的关键动作是：

1) 创建一个新的 `TurnContext`（携带 model/provider/config 等默认 turn 上下文）
2) 构造一个 `UserInput::Text`，其内容是 “compact prompt”（默认来自模板文件，可配置覆盖）
3) 启动 `CompactTask`

关键代码位置：

- handler：`github:openai/codex/codex-rs/core/src/codex.rs:2086`
  - `turn_context.compact_prompt()` 用于获取 prompt
  - `spawn_task(..., CompactTask)` 启动任务
- prompt 选择逻辑：`github:openai/codex/codex-rs/core/src/codex.rs:400`
  - `TurnContext::compact_prompt()` 默认落到 `compact::SUMMARIZATION_PROMPT`

> 小结：对 GUI 来说，“触发 `/compact`”的最小语义等价于：发一个 `Op::Compact`，由 core 自己决定用什么 prompt、走哪条实现路径、以及如何重写历史。

## 3. compact prompt 的来源与可配置性

### 3.1 默认 prompt 模板

默认压缩提示词来自：

- `github:openai/codex/codex-rs/core/templates/compact/prompt.md`

其语义是让模型输出一个“handoff summary”（供另一个 LLM 接手继续任务），而不是传统意义上的“聊天总结”。

### 3.2 summary prefix 模板

本地总结完成后，core 会给模型输出的 summary 加一个固定前缀，形成 summary message：

- `github:openai/codex/codex-rs/core/templates/compact/summary_prefix.md`

该前缀用于在后续 turn 中提示模型：“下面是上一个模型留下的 summary，请利用它继续工作”。

### 3.3 prompt 覆盖点

`TurnContext::compact_prompt()` 会优先使用 `turn_context.compact_prompt`（配置覆盖），否则使用 `compact::SUMMARIZATION_PROMPT`：

- `github:openai/codex/codex-rs/core/src/codex.rs:400`

## 4. CompactTask：remote vs local 的选择逻辑（核心分支点）

`CompactTask` 是 `/compact` 的实际执行任务。它会根据 `should_use_remote_compact_task(...)` 选择远端或本地路径：

- 任务入口：`github:openai/codex/codex-rs/core/src/tasks/compact.rs:20`
- 分支判断：`github:openai/codex/codex-rs/core/src/tasks/compact.rs:28`

判断条件函数在 `core/src/compact.rs`：

- `github:openai/codex/codex-rs/core/src/compact.rs:35`
  - `provider.is_openai() && session.enabled(Feature::RemoteCompaction)`

这里涉及两个关键点：

1) `provider.is_openai()` 只检查 provider 的 **display name** 是否等于 `"OpenAI"`：
   - 常量：`github:openai/codex/codex-rs/core/src/model_provider_info.rs:31`
   - 判定：`github:openai/codex/codex-rs/core/src/model_provider_info.rs:253`
2) `Feature::RemoteCompaction` 的默认值在本 repo 中是 `default_enabled: true`：
   - 枚举定义注释写明 "ChatGPT auth only"：`github:openai/codex/codex-rs/core/src/features.rs:83`
   - 默认开启：`github:openai/codex/codex-rs/core/src/features.rs:388`

> 与官方文档的关系（你关心的 API key 模式）：官方文档描述 `remote_compaction` “ChatGPT auth only”，但代码的 gating 并没有显式检查 auth mode；是否真的“只在 ChatGPT auth 可用”，取决于服务端是否支持 API key 调用 `/v1/responses/compact`（第 6.4 节详细解释 base_url 选择）。

## 5. Local compaction（本地总结）实现细节

本地总结路径的实现集中在：

- `github:openai/codex/codex-rs/core/src/compact.rs`

### 5.1 关键步骤概览

本地总结大致流程：

1) 将 “compact prompt” 作为一次 turn 的 user input 记录进 history
2) 用当前模型对 “当前 history + compact prompt” 发起一次 streaming turn
3) 收集该 turn 的最后一条 assistant message 作为 summary（`summary_suffix`）
4) 拼接 `SUMMARY_PREFIX + summary_suffix` 形成 `summary_text`
5) 重建新历史：保留一部分近期 user messages + summary_text（作为 user message），再附加 ghost snapshots
6) 替换 history、更新 token usage、写 rollout、发送 `ContextCompacted` 事件与 warning

### 5.2 请求是怎么发起的（streaming）

`run_compact_task()` 会发送 `TurnStarted` 事件，然后调用 `run_compact_task_inner()`：

- 发送 `TurnStarted`：`github:openai/codex/codex-rs/core/src/compact.rs:52`
- 真正执行：`github:openai/codex/codex-rs/core/src/compact.rs:64`

在 `run_compact_task_inner()` 中，它用 `history.clone().for_prompt()` 作为 input，构建一个 `Prompt` 并发起 streaming：

- `Prompt { input: turn_input, ..Default::default() }`：`github:openai/codex/codex-rs/core/src/compact.rs:101`
- drain loop：`github:openai/codex/codex-rs/core/src/compact.rs:295`
  - 每个 `ResponseEvent::OutputItemDone` 会被写入 history：`github:openai/codex/codex-rs/core/src/compact.rs:310`
  - 收到 `Completed` 后返回：`github:openai/codex/codex-rs/core/src/compact.rs:317`

### 5.3 ContextWindowExceeded 时的处理（裁剪旧历史）

如果模型返回 “context window exceeded”，本地路径会从历史最前端开始丢弃 item，并重试：

- 分支入口：`github:openai/codex/codex-rs/core/src/compact.rs:97`
- 处理 `CodexErr::ContextWindowExceeded`：`github:openai/codex/codex-rs/core/src/compact.rs:123`

这里的策略是“尽量保留最近消息”：

- Trim from beginning（移除最老的 history item）：`github:openai/codex/codex-rs/core/src/compact.rs:125`
  - 实际删除：`history.remove_first_item()`：`github:openai/codex/codex-rs/core/src/compact.rs:129`

### 5.4 summary_text 是怎么生成的（关键：summary 存为 user message）

本地总结完成后，core 取 “本次 compact turn 的最后一条 assistant message” 作为 summary 内容：

- 取 summary：`github:openai/codex/codex-rs/core/src/compact.rs:162`
  - `get_last_assistant_message_from_turn(history_items)`
- 拼 summary_text：`github:openai/codex/codex-rs/core/src/compact.rs:163`
  - `format!("{SUMMARY_PREFIX}\n{summary_suffix}")`

接着会调用 `build_compacted_history(...)` 重建历史：

- `build_compacted_history`：`github:openai/codex/codex-rs/core/src/compact.rs:231`

这里有一个非常重要的实现细节：

- summary 被写成 `ResponseItem::Message { role: "user", content: InputText(summary_text) }`
  - 具体写入点：`github:openai/codex/codex-rs/core/src/compact.rs:286`

也就是说：**summary 不是“assistant message”，而是“带 prefix 的 user message”。**

### 5.5 哪些 user messages 会被保留（过滤规则）

`collect_user_messages(...)` 从 history 中抽取 user message 文本用于“保留近期用户信息”：

- `collect_user_messages`：`github:openai/codex/codex-rs/core/src/compact.rs:211`
- 它会跳过 summary message（通过 `is_summary_message` 判断）：`github:openai/codex/codex-rs/core/src/compact.rs:227`

此外，哪些东西算 “user message” 由 `crate::event_mapping::parse_turn_item` 决定，它会过滤掉：

- `<environment_context>...` 这类 session prefix：`github:openai/codex/codex-rs/core/src/event_mapping.rs:24`
- `AGENTS.md instructions` / `skills` 注入：`github:openai/codex/codex-rs/core/src/event_mapping.rs:31`
- 以及 user 直接发起的 `!shell`（避免被当作"自然语言上下文"带入）：`github:openai/codex/codex-rs/core/src/event_mapping.rs:50`

对应实现位置：

- `parse_user_message(...)`：`github:openai/codex/codex-rs/core/src/event_mapping.rs:30`
- session prefix 判定：`github:openai/codex/codex-rs/core/src/event_mapping.rs:24`

### 5.6 “保留多少期用户消息”的策略（token 上限）

`build_compacted_history_with_limit(...)` 会从最近的 user messages 倒序回溯，最多保留 `COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000` tokens 的用户文本：

- 上限常量：`github:openai/codex/codex-rs/core/src/compact.rs:33`
- 算 token 并选择：`github:openai/codex/codex-rs/core/src/compact.rs:250`
- 超限时会对最老的一条做截断后停止：`github:openai/codex/codex-rs/core/src/compact.rs:262`

### 5.7 结果落地：替换 history、rollout、事件与 warning

本地总结完成后会：

1) `replace_history(new_history)`
2) `recompute_token_usage(...)`
3) 写入 rollout：`RolloutItem::Compacted { message: summary_text, replacement_history: None }`
4) 发送 `ContextCompacted`
5) 发送 warning（提示多次 compact 可能降低准确性）

对应代码：

- `replace_history`：`github:openai/codex/codex-rs/core/src/compact.rs:174`
- ghost snapshots（保留 `/undo`）：`github:openai/codex/codex-rs/core/src/compact.rs:168`
- rollout：`github:openai/codex/codex-rs/core/src/compact.rs:177`
- `ContextCompacted`：`github:openai/codex/codex-rs/core/src/compact.rs:183`
- warning：`github:openai/codex/codex-rs/core/src/compact.rs:186`

## 6. Remote compaction（/v1/responses/compact）实现细节

remote 路径主要在：

- `github:openai/codex/codex-rs/core/src/compact_remote.rs`
- `github:openai/codex/codex-rs/core/src/client.rs`
- `github:openai/codex/codex-rs/codex-api/src/endpoint/compact.rs`

### 6.1 远端 compaction 的“输入”是什么

远端 compaction 会把当前 `history.for_prompt()` 直接作为 payload 的 `input` 发送给 compact endpoint：

- 构造 Prompt：`github:openai/codex/codex-rs/core/src/compact_remote.rs:53`
  - `input: history.for_prompt()`
  - `base_instructions_override: turn_context.base_instructions.clone()`
  - tools 为空：`tools: vec![]`
- 发起请求：`github:openai/codex/codex-rs/core/src/compact_remote.rs:61`
  - `turn_context.client.compact_conversation_history(&prompt)`

### 6.2 compact endpoint 请求是怎么拼的

`ModelClient::compact_conversation_history(...)` 会构造一个 `ApiCompactionInput`：

- `github:openai/codex/codex-rs/core/src/client.rs:354`
  - `model: &self.get_model()`
  - `input: &prompt.input`
  - `instructions: &instructions`

其中 `instructions` 来自：

- `prompt.get_full_instructions(&self.get_model_info())`：`github:openai/codex/codex-rs/core/src/client.rs:372`
  - 即：由“当前模型的 base instructions / override”决定

endpoint 路径来自 `codex-api` 的实现：

- `github:openai/codex/codex-rs/codex-api/src/endpoint/compact.rs:39`
  - 对 `WireApi::Responses` 返回 `"responses/compact"`

> 因此，最终 HTTP 路径通常是：`<base_url>/v1/responses/compact`。

### 6.3 远端 compaction 的“输出”是什么（replacement history）

compact endpoint 返回的是一个新的 `Vec<ResponseItem>`（完整替代 history 的内容），core 会：

1) 合并 ghost snapshots（保证 `/undo` 还能工作）
2) `replace_history(new_history.clone())`
3) 写 rollout：`replacement_history: Some(new_history)`（注意：message 字段为空串）
4) 发送 `ContextCompacted`

对应代码：

- 合并 ghost snapshots：`github:openai/codex/codex-rs/core/src/compact_remote.rs:45`
- replace：`github:openai/codex/codex-rs/core/src/compact_remote.rs:69`
- rollout：`github:openai/codex/codex-rs/core/src/compact_remote.rs:72`
- `ContextCompacted`：`github:openai/codex/codex-rs/core/src/compact_remote.rs:79`

与本地总结不同点：

- remote 路径不会发送 "Heads up..." warning（`compact_remote.rs` 中没有对应事件）。
- remote 路径的 error 处理是"转成 `ErrorEvent` 并结束"，不会 fallback：
  - `github:openai/codex/codex-rs/core/src/compact_remote.rs:30`

### 6.4 API key vs ChatGPT auth：base_url 的选择（为什么官方说 ChatGPT only）

remote compaction 是否“可用”，不仅取决于 feature gating，还取决于请求最终打到哪里。

`ModelProviderInfo::to_api_provider(auth_mode)` 决定默认 base_url：

- ChatGPT auth：`https://chatgpt.com/backend-api/codex`
- 非 ChatGPT（如 API key）：`https://api.openai.com/v1`

对应实现：

- `github:openai/codex/codex-rs/core/src/model_provider_info.rs:130`
  - 选择 base_url：`github:openai/codex/codex-rs/core/src/model_provider_info.rs:134`

因此，在 **API key 模式** 下，即使 `Feature::RemoteCompaction` 开启且 provider 名字是 `"OpenAI"`，代码仍可能发起：

- `https://api.openai.com/v1/responses/compact`

而官方文档强调 “ChatGPT auth only”，通常意味着：

- `responses/compact` 可能只对 ChatGPT backend 可用，或 API key 需要额外前提（服务端策略）
- 对 API key 环境而言，remote path 可能会失败并抛 `ErrorEvent`（当前代码没有自动 fallback 回 local）

> GUI 复刻建议：如果你希望“与 Codex CLI 完全一致”，则保留该行为（失败就报错）；如果你希望体验更稳，可以在 GUI 层做“remote 失败则尝试 local”的策略，但这属于行为差异，需要你显式决定。

## 7. tui2 如何呈现 compaction 的结果

core 完成 compaction 后会发送 `EventMsg::ContextCompacted`，tui2 的处理是显示一条 agent message：

- `github:openai/codex/codex-rs/tui2/src/chatwidget.rs:1990`
  - `self.on_agent_message("Context compacted".to_owned())`

也就是说：tui2 并不会在 UI 层显式“重建消息列表”；history 的重写发生在 core 内部，后续 turn 的请求自然会基于新 history 继续。

对 Coco GUI 的启示：

- 如果 GUI 维护的“消息列表”只是事件流渲染（类似 tui2），那么 `ContextCompacted` 只需要展示提示即可。
- 如果 GUI 维护一个“可回放的完整对话副本”，则需要你定义：`ContextCompacted` 后 UI 应该展示什么（例如：只展示 summary + 最近 N 条用户消息，还是保留原始记录但标记已压缩）。

### 7.1 事件序列（GUI 复刻时的最小事件闭环）

tui2 侧的任务/回合生命周期（无论 local 还是 remote）都是通过以下事件驱动：

- Turn started（开始执行 compact task）：`github:openai/codex/codex-rs/tui2/src/chatwidget.rs:1913`
- Turn complete（compact 任务结束）：`github:openai/codex/codex-rs/tui2/src/chatwidget.rs:1914`
- Context compacted（历史已被替换）：`github:openai/codex/codex-rs/tui2/src/chatwidget.rs:1990`
- Warning / Error（本地会额外 warning；远端失败可能 error）：`github:openai/codex/codex-rs/tui2/src/chatwidget.rs:1921`

> 注意：`ContextCompacted` 是一个独立事件，不等价于 `TurnComplete`。

## 8. 附录：auto-compact（自动触发）的入口点（可选）

本仓库中还存在“自动触发 compaction”的机制（当 token usage 超过阈值时，在下一次用户输入前触发）：

- 本地 auto-compact 入口：`github:openai/codex/codex-rs/core/src/compact.rs:42`（`run_inline_auto_compact_task`）
- 远端 auto-compact 入口：`github:openai/codex/codex-rs/core/src/compact_remote.rs:14`（`run_inline_remote_auto_compact_task`）

它们与手动 `/compact` 共用同一套核心实现：差异主要在“触发时机”和“是否发 TurnStarted / warning / rollout 的内容”。

## 9. 外部参考

- OpenAI Codex（配置/Supported features）：`https://developers.openai.com/codex/config-basic/#supported-features`
