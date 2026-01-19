# GUI Slash 菜单实现文档

本文档记录 GUI 中 "/" 命令菜单的实现细节，包括 Commands、Prompts 和 Skills 三类内容的支持。

## 概述

参考 codex CLI (TUI2) 的实现，GUI 的 "/" 菜单支持三类内容：
1. **Commands** - 内置命令（如 Status, Model 等）
2. **Prompts** - 用户自定义 prompts（显示为 `prompts:name` 格式）
3. **Skills** - 技能列表

## 源码位置

### GUI 前端
| 文件 | 描述 |
|------|------|
| [`apps/gui/src/features/codex-chat/CodexChat.tsx`](../../../apps/gui/src/features/codex-chat/CodexChat.tsx) | 主聊天组件，包含 slash 菜单逻辑 |
| [`apps/gui/src/api/client.ts`](../../../apps/gui/src/api/client.ts) | API 客户端 |
| [`apps/gui/src/types/codex.ts`](../../../apps/gui/src/types/codex.ts) | 类型定义 |

### GUI 后端 (Tauri)
| 文件 | 描述 |
|------|------|
| [`apps/gui/src-tauri/src/lib.rs`](../../../apps/gui/src-tauri/src/lib.rs) | Tauri 命令定义 |

### Codex CLI 参考实现
| 文件 | 描述 |
|------|------|
| `github:openai/codex/codex-rs/tui2/src/bottom_pane/command_popup.rs` | 命令弹窗实现 |
| `github:openai/codex/codex-rs/tui2/src/bottom_pane/skill_popup.rs` | 技能弹窗实现 |
| `github:openai/codex/codex-rs/tui2/src/slash_command.rs` | 斜杠命令定义 |
| `github:openai/codex/codex-rs/core/src/custom_prompts.rs` | Prompts 加载逻辑 |
| `github:openai/codex/codex-rs/core/src/skills/loader.rs` | Skills 加载逻辑 |

---

## 数据结构

### CustomPrompt (Prompts)
```typescript
// apps/gui/src/types/codex.ts
interface CustomPrompt {
  name: string;
  description?: string;
  argumentHint?: string;
  path: string;
}
```

### SkillMetadata (Skills)
```typescript
// apps/gui/src/types/codex.ts
interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  path: string;
  scope: "user" | "repo" | "system" | "admin";
}
```

---

## Prompts 加载

### 后端实现
- **命令**: `codex_prompt_list`
- **源码**: `lib.rs:1160-1219`
- **目录**: `~/.codex/prompts/`
- **文件格式**: `.md` 文件，支持 YAML frontmatter

### Frontmatter 格式
```yaml
---
description: "Quick review command"
argument-hint: "[file] [priority]"
---

# Prompt body content
```

### 前端 API
```typescript
// apps/gui/src/api/client.ts
export async function codexPromptList(): Promise<PromptsListResponse> {
  return invoke<PromptsListResponse>("codex_prompt_list");
}
```

---

## Skills 加载

### 后端实现
- **命令**: `codex_skill_list`
- **源码**: `lib.rs:1104-1157`
- **通过 codex app-server 的 `skills/list` 方法获取**

### Skills 目录优先级
1. **Repo**: `.codex/skills` (项目级)
2. **User**: `$CODEX_HOME/skills` (用户级)
3. **System**: `$CODEX_HOME/skills/.system` (系统级)
4. **Admin**: `/etc/codex/skills` (管理员级, Unix only)

### SKILL.md 格式
```yaml
---
name: demo-skill
description: long description
metadata:
  short-description: short summary
---

# Skill body content
```

---

## Slash 菜单交互

### 触发方式
- 在输入框中输入 [`/`](../../../../../../../../..) 触发菜单
- 菜单显示时隐藏 [`/`](../../../../../../../../..) 字符

### 键盘导航
| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 上下移动选择 |
| `Tab` | 补全选中项 |
| `Enter` | 执行选中项 |
| `Escape` | 关闭菜单 |

### 模糊搜索
- 使用 `fuzzyMatch` 函数进行子序列匹配
- 支持高亮匹配字符
- 按匹配分数排序

### 索引计算
菜单项按以下顺序排列：
1. Commands (索引 0 ~ filteredSlashCommands.length - 1)
2. Prompts (索引 filteredSlashCommands.length ~ filteredSlashCommands.length + filteredPromptsForSlashMenu.length - 1)
3. Skills (索引 filteredSlashCommands.length + filteredPromptsForSlashMenu.length ~ total - 1)

---

## 选择行为

### Commands
- 执行对应的命令逻辑（如打开模型选择、显示状态等）

### Prompts
- 设置 `selectedPrompt` 状态
- 在输入框显示选中的 prompt 标签

### Skills
- 设置 `selectedSkill` 状态
- 在输入框显示选中的 skill 标签

---

## 相关状态

```typescript
// CodexChat.tsx 中的状态
const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
const [slashSearchQuery, setSlashSearchQuery] = useState('');
const [slashHighlightIndex, setSlashHighlightIndex] = useState(0);
const [skills, setSkills] = useState<SkillMetadata[]>([]);
const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
const [selectedSkill, setSelectedSkill] = useState<SkillMetadata | null>(null);
const [selectedPrompt, setSelectedPrompt] = useState<CustomPrompt | null>(null);
```

---

## 参考

- Codex TUI2 命令弹窗: `github:openai/codex/codex-rs/tui2/src/bottom_pane/command_popup.rs`
- Codex TUI2 技能弹窗: `github:openai/codex/codex-rs/tui2/src/bottom_pane/skill_popup.rs`
