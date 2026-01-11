# Auto context（IDE 上下文）原理整理

> 来源：本地 VSCode 插件 webview bundle：
> `~/.vscode-insiders/extensions/openai.chatgpt-0.5.58-darwin-arm64/webview/assets/index-C-orm5fu.js`。
> 以下仅覆盖 webview 前端逻辑，插件后端（extension）实现未在此文件中体现。

## 功能概览

Auto context 是一个“IDE 上下文自动引入”的可切换能力：

- 在编写消息时由插件侧收集 IDE 最近文件/上下文，并注入到模型输入。
- UI 通过按钮（Pill）与 Slash Command 两种入口控制开关。
- 仅在 IDE IPC 连接就绪时可用，否则按钮不显示/命令不可用。

## 状态与持久化

- 持久化存储：`persistedAtom("composer-auto-context-enabled", true)`。
- 默认值：`true`（首次进入时为开启）。
- 触发开关时同时更新本地状态与持久化原子，保证刷新后仍保留用户偏好。

## IDE IPC 获取链路

### 1) 运行环境判定

- `useWindowType()` 区分 `electron` 与 `extension`。
- 若为 `electron`：会读取 workspace roots；若为 `extension`：直接允许 IDE 上下文请求。

### 2) Workspace root 获取

- `useFetchFromVSCode("active-workspace-roots")` 仅在 `electron` 下启用。
- 使用第一个 root 作为 `workspaceRoot`（`roots[0]`）。

### 3) IDE context 拉取

- `useFetchFromVSCode("ide-context", { params, queryConfig })`。
- `queryConfig.enabled` 仅在满足以下条件时为 `true`：
  - `windowType === "extension"`，或
  - `windowType === "electron" && workspaceRoot 存在`
- 传参规则：
  - `electron` 且有 root：`{ workspaceRoot }`
  - 其他情况：不传 `params`
- 返回结构中取 `ideContext` 字段作为上下文结果。

## 连接状态与自动降级

- `useIdeContextIpcStatus(isAutoContextOn, setIsAutoContextOn)` 负责判断 IDE IPC 状态：
  - 监听 `client-status-changed` 广播，触发重新拉取。
  - `electron`：根据 `useIdeContext()` 的 `isFetching/isSuccess/isError` 生成 `loading/connected/no-connection`。
  - `extension`：直接视为 `connected`（并提供一个 noop `refetch`）。
- 断连降级：当 `isAutoContextOn == true` 且 `isError == true` 时，自动关闭 Auto context。

## UI 与交互入口

### AutoContextButton（Pill）

- 连接状态为 `connected` 时才显示按钮；否则组件直接返回 `null`。
- Tooltip 内容：
  - “Include recent files”
  - “and other context”
  - 连接成功提示 “Connected to your IDE.”
- 点击按钮：切换 `isAutoContextOn`，并同步更新持久化状态。

### Slash Command

- 通过 `useProvideSlashCommand` 注册命令：`id: "auto-context"`。
- 标题文案随状态切换：
  - `enableAutoContext` / `disableAutoContext`
- 命令在未连接时不可用（`enabled: false`）。

## 安全获取与错误处理

- `fetchIdeContextSafe(...)` 封装了 `fetchFromVSCode("ide-context")`：
  - 异常时记录日志：`[Composer] failed to fetch ide-context: ...`
  - 返回 `null`，避免影响主流程。

## GUI 复用要点（建议）

1. **持久化开关**：使用本地存储键（等价于 `composer-auto-context-enabled`）保持用户偏好。
2. **连接优先**：只有 IDE IPC 成功时才允许自动上下文生效，断连即降级关闭。
3. **上下文拉取的参数化**：在桌面端（electron）场景下带 workspace root；其他场景可无参。
4. **双入口一致性**：按钮与命令应共享同一开关状态，且都受连接状态 gating。
5. **错误兜底**：获取失败应返回空并提示日志，不阻塞 UI 主流程。

## 关键标识符速查

- 持久化键：`composer-auto-context-enabled`
- IPC 请求：`active-workspace-roots`、`ide-context`
- IPC 广播：`client-status-changed`
- Slash command id：`auto-context`
