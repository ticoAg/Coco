# gpt-5.2-codex vs gpt-5.2：/compact 相关差异点（由代码可确定）

> 目标：解释在 Codex CLI 中，`gpt-5.2-codex` 与 `gpt-5.2` 在 `/compact` 上会出现哪些差异，以及差异来自哪里（精确到实现位置）。
>
> 重要前提：`tui2` 对 `/compact` 的 dispatch **不区分模型**。差异主要来自 core 对 “模型元数据（ModelInfo）” 与 “feature/provider” 的处理。

## 1. 先说结论：/compact 的 UI 入口没有模型分支

在 `tui2` 中，`/compact` 固定触发 `Op::Compact`：

- `github:openai/codex/codex-rs/tui2/src/chatwidget.rs:1562`

也就是说：

- **不会存在** “tui2 对 gpt-5.2-codex 做了特殊处理”的代码分支
- 任何差异都发生在 core 执行 `CompactTask` 以及模型请求参数构造阶段

## 2. 差异点 A：base instructions 不同（会影响 local 与 remote compaction）

### 2.1 gpt-5.2-codex 的 base instructions

`gpt-5.2-codex` 的 base instructions 来自：

- `github:openai/codex/codex-rs/core/gpt-5.2-codex_prompt.md`

在 `ModelInfo` 映射中设置：

- `github:openai/codex/codex-rs/core/src/models_manager/model_info.rs:178`
  - `base_instructions: GPT_5_2_CODEX_INSTRUCTIONS.to_string()`

### 2.2 gpt-5.2 的 base instructions

`gpt-5.2` 的 base instructions 来自：

- `github:openai/codex/codex-rs/core/gpt_5_2_prompt.md`

在 `ModelInfo` 映射中设置：

- `github:openai/codex/codex-rs/core/src/models_manager/model_info.rs:236`
  - `base_instructions: GPT_5_2_INSTRUCTIONS.to_string()`

### 2.3 为什么这会影响 /compact

1) **Local compaction** 本质是一次普通 streaming turn：模型会读到其 base instructions，因此输出 summary 的风格/内容会受影响（详见 `flow-and-implementation.md` 第 5 节）。
2) **Remote compaction** 会把 `instructions` 字段一并发送给 `/responses/compact`：
   - `github:openai/codex/codex-rs/core/src/client.rs:372`（计算 instructions）
   - `github:openai/codex/codex-rs/core/src/client.rs:375`（payload 中携带 instructions）

因此 remote compaction 的输出（replacement history）也可能随模型 instructions 改变。

## 3. 差异点 B：verbosity 支持不同（主要影响 local compaction 输出长度）

在 `ModelInfo` 映射中：

- `gpt-5.2-codex`：`support_verbosity: false`
  - `github:openai/codex/codex-rs/core/src/models_manager/model_info.rs:178`
- `gpt-5.2`：`support_verbosity: true` 且默认 `Verbosity::Low`
  - `github:openai/codex/codex-rs/core/src/models_manager/model_info.rs:239`

streaming 请求会在支持 verbosity 时序列化 `text.verbosity`：

- `github:openai/codex/codex-rs/core/src/client.rs:236`
- 生成 text param：`github:openai/codex/codex-rs/core/src/client.rs:248`

对 `/compact` 的影响：

- 当走 **local compaction**（streaming）时，`gpt-5.2` 可能更倾向输出更“短/收敛”的文本（再叠加 compact prompt 本身也要求 concise）。
- 当走 **remote compaction** 时，当前实现的 compact endpoint payload 不包含 `text.verbosity`（`client.rs` 的 `compact_conversation_history` 只发 model/input/instructions），因此 verbosity 差异对 remote compaction 的影响（如果有）只能间接体现在 instructions/服务端实现上，而不是直接字段控制。

## 4. 差异点 C：truncation policy 不同（影响“上下文保留/裁剪”与触发压力）

`ModelInfo` 中的 truncation policy：

- `gpt-5.2-codex`：`TruncationPolicyConfig::tokens(10_000)`
  - `github:openai/codex/codex-rs/core/src/models_manager/model_info.rs:187`
- `gpt-5.2`：`TruncationPolicyConfig::bytes(10_000)`
  - `github:openai/codex/codex-rs/core/src/models_manager/model_info.rs:247`

这会影响：

- history 记录与工具输出等在进入 prompt 前的裁剪策略（token-based vs byte-based）
- 从而间接影响“何时更需要 /compact”以及 compact 时可用上下文的形态

> 注：truncation policy 对 `/compact` 的影响属于“系统层间接影响”，不等价于“compact 算法不同”。compact 算法本身（local vs remote）不因模型而分叉。

## 5. 差异点 D：API key 模式下的模型可见性/可选性（极易造成“差异错觉”）

在本 repo 的 model presets 中：

- `gpt-5.2-codex`：`supported_in_api: false`
  - `github:openai/codex/codex-rs/core/src/models_manager/model_presets.rs:14`
- `gpt-5.2`：`supported_in_api: true`
  - `github:openai/codex/codex-rs/core/src/models_manager/model_presets.rs:94`

并且 core 会根据 auth mode 过滤可见模型：

- `github:openai/codex/codex-rs/core/src/models_manager/manager.rs:275`
  - 非 ChatGPT auth（例如 API key）时：只保留 `supported_in_api == true` 的模型

这意味着在 **API key 模式** 下：

- 你在 picker/UI 里可能根本看不到 `gpt-5.2-codex`（除非走别的模型来源或手动配置）
- 因此你观测到的 `/compact` 行为“差异”很可能来自“实际根本没在用 gpt-5.2-codex”，而不是 `/compact` 对不同模型做了分支

## 6. 差异点 E：remote_compaction 的“可用性”与官方约束（API key 重点）

官方文档描述 `remote_compaction` 是 “ChatGPT auth only”，但代码 gating 目前是：

- `provider.is_openai() && session.enabled(Feature::RemoteCompaction)`
  - `github:openai/codex/codex-rs/core/src/compact.rs:35`

其中 `provider.is_openai()` 仅检查 provider name 是否为 `"OpenAI"`：

- `github:openai/codex/codex-rs/core/src/model_provider_info.rs:253`

而真正决定请求打到哪里的是：

- `ModelProviderInfo::to_api_provider(auth_mode)` 的默认 base_url
  - `github:openai/codex/codex-rs/core/src/model_provider_info.rs:130`

对 API key 模式而言，这可能导致 remote compaction 走到：

- `https://api.openai.com/v1/responses/compact`（服务端是否允许/支持取决于 OpenAI 当期策略）

因此，API key 场景下你在实现 GUI 时，需要显式决定：

- 是否要完全复刻 Codex CLI 当前行为（可能尝试 remote，失败则报错）
- 还是要做一个“遵循官方约束”的实现（API key 直接禁用 remote_compaction，只走 local）

两种策略的差别来自“产品选择”，不是现有代码已强制保证的行为。

## 7. 外部参考

- OpenAI Codex（配置/Supported features）：`https://developers.openai.com/codex/config-basic/#supported-features`
