# Codex App-Server JSON-RPC API 文档

本文档记录 codex app-server 支持的所有 JSON-RPC 方法及其在 GUI 中的接入状态。

## 概述

GUI 通过 Tauri 后端与 codex app-server 进程通信，使用 JSON-RPC 协议。

### 源码位置

| 组件 | 路径 |
|------|------|
| Tauri 后端命令 | `apps/gui/src-tauri/src/lib.rs` |
| Codex App Server 客户端 | `apps/gui/src-tauri/src/codex_app_server.rs` |
| AgentMesh app-server adapter client（可复用） | `crates/agentmesh-codex/src/app_server_client.rs` |
| Orchestrator wrapper（语义 API：start/resume/fork/turn/...） | `crates/agentmesh-orchestrator/src/codex_app_server_adapter.rs` |
| 前端 API 客户端 | `apps/gui/src/api/client.ts` |
| 前端类型定义 | `apps/gui/src/types/codex.ts` |
| Codex 协议定义 | `github:openai/codex/codex-rs/app-server-protocol/src/protocol/v2.rs`（v2）与 `.../protocol/common.rs`（共享类型/通知） |

---

## 已接入的方法

### 1. thread/list
- **描述**: 列出所有会话线程
- **Tauri 命令**: `codex_thread_list`
- **前端 API**: `apiClient.codexThreadList()`
- **源码**: `lib.rs:805`

### 2. thread/start
- **描述**: 启动新的会话线程
- **Tauri 命令**: `codex_thread_start`
- **前端 API**: `apiClient.codexThreadStart()`
- **源码**: `lib.rs:931`

### 3. thread/resume
- **描述**: 恢复已存在的会话线程
- **Tauri 命令**: `codex_thread_resume`
- **前端 API**: `apiClient.codexThreadResume()`
- **源码**: `lib.rs:953`
- **备注（历史 Activity 恢复）**:
  - Codex app-server 的 `thread/resume` 在某些版本/场景下可能只返回 `userMessage/agentMessage/reasoning`（即历史 `turn.items` 不含命令/文件变更/MCP/WebSearch）。
  - 为了在 GUI 的 “Finished working” 展开后能稳定看到历史过程（command/fileChange/webSearch/mcp），AgentMesh 会在 Tauri 后端对 `thread/resume` 的返回做一次“补全”：读取 `thread.path` 指向的 rollout JSONL（位于 `~/.codex/sessions/.../rollout-*.jsonl`），按 `event_msg.user_message` 的 turn 边界重建 activity items，并注入到 `thread.turns[].items`。
  - 目前补全的 block 类型：`commandExecution`（exec_command）、`fileChange`（apply_patch，整段 patch 作为 diff）、`mcpToolCall`（`server.tool`）、`webSearch`（web_search_call）。
  - `fileChange.changes` 可能包含 `lineNumbersAvailable`，当后端能根据当前 workspace 文件反推行号时，会把 `diff` 改写为带 `@@` 行号的 unified diff；否则保持原 diff 并让前端隐藏行号。

### 4. thread/fork
- **描述**: 从现有会话创建一个新的分支
- **Tauri 命令**: `codex_thread_fork`
- **前端 API**: `apiClient.codexThreadFork()`
- **源码**: `lib.rs:965`

### 5. thread/rollback
- **描述**: 回滚会话历史（回退最近 N 个 turns；MVP：N=1）
- **Tauri 命令**: `codex_thread_rollback`
- **前端 API**: `apiClient.codexThreadRollback()`
- **源码**: `lib.rs:997`
- **重要语义**: rollback 只修改 thread 的历史，不会回滚本地文件修改

### 6. turn/start
- **描述**: 在会话中开始新的对话轮次
- **Tauri 命令**: `codex_turn_start`
- **前端 API**: `apiClient.codexTurnStart()`
- **源码**: `lib.rs:1027`
- **参数**:
  ```typescript
  {
    threadId: string;
    text: string;
    model?: string;
    effort?: string;
    approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
  }
  ```

### 7. turn/interrupt
- **描述**: 中断正在进行的对话轮次
- **Tauri 命令**: `codex_turn_interrupt`
- **前端 API**: `apiClient.codexTurnInterrupt()`
- **源码**: `lib.rs:1068`

### 8. model/list
- **描述**: 列出所有可用的模型
- **Tauri 命令**: `codex_model_list`
- **前端 API**: `apiClient.codexModelList()`
- **源码**: `lib.rs:1098`

### 9. config/read
- **描述**: 读取有效配置
- **Tauri 命令**: `codex_config_read_effective`
- **前端 API**: `apiClient.codexConfigReadEffective()`
- **源码**: `lib.rs:1110`

### 10. config/batchWrite
- **描述**: 批量写入配置
- **Tauri 命令**: `codex_config_write_chat_defaults`
- **前端 API**: `apiClient.codexConfigWriteChatDefaults()`
- **源码**: `lib.rs:1123`

### 11. set profile
- **描述**: 设置当前 GUI 会话使用的 Codex profile，并在下次请求时重启 app-server
- **Tauri 命令**: `codex_set_profile`
- **前端 API**: `apiClient.codexSetProfile()`
- **源码**: `lib.rs:1182`

### 12. skills/list
- **描述**: 列出所有可用的技能
- **Tauri 命令**: `codex_skill_list`
- **前端 API**: `apiClient.codexSkillList()`
- **源码**: `lib.rs:1268`

---

## 尚未接入的方法

### 1. thread/archive
- **描述**: 归档/删除会话
- **协议定义**: `app-server-protocol/src/protocol/v2.rs`（`ThreadArchiveParams`）
- **参数**: `{ "threadId": "string" }`
- **用途**: 清理不需要的会话历史
- **建议**: 添加"删除会话"功能

---

## 服务器通知 (Notifications)

App-server 会向客户端发送以下通知：

| 通知 | 描述 | 协议定义 |
|------|------|----------|
| `thread/started` | 线程已启动 | `common.rs:542` |
| `turn/started` | 对话轮次已开始 | `common.rs:544` |
| `turn/completed` | 对话轮次已完成 | `common.rs:545` |
| `thread/compacted` | 上下文已压缩 | `common.rs:563` |

---

## 服务器请求 (Requests)

App-server 可能向客户端发送需要响应的请求（如审批请求）：

- 客户端通过 `codex.respond(request_id, result)` 方法响应
- GUI 中通过 `codexRespondApproval` 命令处理

---

## 参考资料

- Codex App-Server README: `github:openai/codex/codex-rs/app-server/README.md`
- 协议测试用例: `github:openai/codex/codex-rs/app-server/tests/`
