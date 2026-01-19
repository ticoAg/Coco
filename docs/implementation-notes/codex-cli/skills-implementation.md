# Skills 实现机制

本文档记录 Codex CLI（TUI2）中 Skills 的选择、发送和注入机制，便于 Coco GUI 对齐实现。

## 概述

Skills 是可重用的指令集，用户可以通过 `$skill-name` 语法引用，系统会自动读取对应的 SKILL.md 文件内容并注入到对话上下文中。

## 核心数据结构

### SkillMetadata

```typescript
// 前端类型定义 (types/codex.ts)
interface SkillMetadata {
  name: string;           // skill 名称
  description: string;    // 完整描述
  shortDescription?: string; // 简短描述（用于菜单显示）
  path: string;           // SKILL.md 文件路径
  scope: "user" | "repo" | "system" | "admin";
}
```

### UserInput 类型

```typescript
// 发送给后端的输入类型
type CodexUserInput =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string };  // skill 必须包含 name 和 path
```

## 选择流程

### 1. 触发方式

- **`$` 键触发**：在输入框中按 `$` 键打开 skill 选择菜单
- **[`/`](../../../../../../../../..) 菜单**：在 slash 命令菜单中也可以选择 skills（显示在 Commands 和 Prompts 之后）

### 2. 选择行为

选择 skill 后：
- **不插入文本**：不再将 `$skill-name` 插入到输入框
- **设置状态**：将完整的 `SkillMetadata` 对象保存到 `selectedSkill` 状态
- **显示标签**：在输入框上方显示带图标的标签（闪电图标 + skill 名称）

```typescript
// 选择函数
const executeSkillSelection = useCallback((skill: SkillMetadata) => {
  setIsSkillMenuOpen(false);
  setSkillSearchQuery('');
  setSelectedSkill(skill);  // 保存完整对象，包含 path
  setTimeout(() => textareaRef.current?.focus(), 0);
}, []);
```

## 发送流程

### 1. 构建 input 数组

发送消息时，需要构建 `CodexUserInput[]` 数组：

```typescript
const codexInput: CodexUserInput[] = [];

// 1. 添加文本输入
codexInput.push({ type: 'text', text: outgoingText });

// 2. 添加 skill（必须包含 name 和 path）
if (selectedSkill) {
  codexInput.push({
    type: 'skill',
    name: selectedSkill.name,
    path: selectedSkill.path  // 关键：path 用于后端读取 SKILL.md
  });
}
```

### 2. API 调用

```typescript
// 前端 API
await apiClient.codexTurnStart(threadId, codexInput, model, effort, approvalPolicy);

// 后端 Tauri 命令
#[tauri::command]
async fn codex_turn_start(
    thread_id: String,
    input: Vec<serde_json::Value>,  // 接收 input 数组
    model: Option<String>,
    effort: Option<String>,
    approval_policy: Option<String>,
) -> Result<serde_json::Value, String>
```

### 3. JSON-RPC 请求格式

```json
{
  "method": "turn/start",
  "params": {
    "threadId": "xxx",
    "input": [
      { "type": "text", "text": "用户输入的文本" },
      { "type": "skill", "name": "skill-creator", "path": "/path/to/SKILL.md" }
    ],
    "model": "...",
    "effort": "...",
    "approvalPolicy": "..."
  }
}
```

## 后端注入机制

### 1. Skill 内容读取

后端收到 skill 输入后，会读取对应的 SKILL.md 文件：

```rust
// codex-rs/core/src/skills/injection.rs
pub(crate) async fn build_skill_injections(
    inputs: &[UserInput],
    skills: Option<&SkillLoadOutcome>,
) -> SkillInjections {
    for skill in mentioned_skills {
        match fs::read_to_string(&skill.path).await {
            Ok(contents) => {
                result.items.push(ResponseItem::from(SkillInstructions {
                    name: skill.name,
                    path: skill.path.to_string_lossy().into_owned(),
                    contents,
                }));
            }
            // ...
        }
    }
}
```

### 2. 注入格式

Skill 内容被包装成特殊的 XML 格式，作为 user 角色的消息发送给 AI：

```xml
<skill>
<name>skill-creator</name>
<path>/repo/.codex/skills/skill-creator/SKILL.md</path>
[SKILL.md 文件的完整内容]
</skill>
```

### 3. 前缀常量

```rust
// codex-rs/core/src/user_instructions.rs
pub const SKILL_INSTRUCTIONS_PREFIX: &str = "<skill";
```

## UI 显示

### 输入框标签

选中 skill 后，在输入框上方显示标签：

```tsx
{selectedSkill ? (
  <div className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
    <Zap className="h-3.5 w-3.5" />
    <span className="max-w-[120px] truncate">{selectedSkill.name}</span>
    <button onClick={() => setSelectedSkill(null)}>
      <X className="h-3 w-3" />
    </button>
  </div>
) : null}
```

### 消息气泡中的附件

发送后，消息气泡中显示 skill 标签：

```tsx
{att.type === 'skill' ? (
  <div className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-primary/20 text-primary">
    <Zap className="h-3 w-3" />
    <span>{att.name}</span>
  </div>
) : null}
```

## 与 TUI2 的对比

| 特性 | TUI2 | Coco GUI |
|------|------|---------------|
| 触发方式 | `$skill-name` 文本检测 | `$` 键打开菜单选择 |
| 选择后行为 | 文本中保留 `$skill-name` | 显示为标签，不插入文本 |
| 发送格式 | `UserInput::Skill { name, path }` | `{ type: 'skill', name, path }` |
| 多 skill 支持 | 支持（检测文本中所有 `$xxx`） | 当前仅支持单个 |

## 注意事项

1. **path 必须传递**：skill 的 path 是后端读取 SKILL.md 的关键，必须在发送时包含
2. **发送后清空**：发送消息后需要清空 `selectedSkill` 状态
3. **UI 一致性**：skill 标签使用主题色（primary），与文件（白色）和 prompt（蓝色）区分

## 相关文件

- 前端类型：[`apps/gui/src/types/codex.ts`](../../../apps/gui/src/types/codex.ts)
- API 客户端：[`apps/gui/src/api/client.ts`](../../../apps/gui/src/api/client.ts)
- 聊天组件：[`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx)
- 后端命令：[`apps/gui/src-tauri/src/lib.rs`](../../../apps/gui/src-tauri/src/lib.rs)
- TUI2 实现：`github:openai/codex/codex-rs/tui2/src/chatwidget.rs`
- 注入逻辑：`github:openai/codex/codex-rs/core/src/skills/injection.rs`
