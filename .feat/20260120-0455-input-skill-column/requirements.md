---
summary: "输入框 skill 标签布局问题 - 需求与验收范围"
doc_type: requirements
slug: "input-skill-column"
notes_dir: ".feat/20260120-0455-input-skill-column"
base_branch: "dev"
feature_branch: "feat/input-skill-column"
worktree: "../Coco-feat-input-skill-column"
created_at_utc: "2026-01-20T04:55:28Z"
---
# 需求文档：输入框 skill 标签占列

## Status
- Current: vFinal (confirmed 2026-01-20)
- Base branch: dev
- Feature branch: feat/input-skill-column
- Worktree: ../Coco-feat-input-skill-column
- Created (UTC): 2026-01-20T04:55:28Z

## v0 (draft) - 2026-01-20T04:55:28Z

### 目标
- 在 Codex Chat 输入区域中，skill/prompt 小 block 作为“文本单位”与输入框同一行呈现（空间充足时），不再单独占一列。
- block 的特殊性仅体现在容器样式与可删除能力，不引入额外布局占列。
- 不改变 skill/prompt 的选择/发送逻辑，只修复布局表现。

### 非目标
- 不重做技能选择菜单或相关业务逻辑。
- 不调整消息发送、后端协议或权限逻辑。

### 验收标准
- 选中 skill 或 prompt 后，输入区域在常规窗口宽度下不再出现“标签单独占一行/占列”的布局。
- 同时选择 prompt + skill 时，两个 block 与输入框仍能同列显示，输入文本可见且不被遮挡。
- 窄宽度允许换行，但不应出现“block 被固定为单独一列”的异常布局。

### 待确认问题
- 无

### 方案 / 权衡
- 方案 A：调整输入区域 flex 布局参数（例如 flex-wrap、basis、min-width），保持标签与 textarea 同行。
  - 优点：改动小，符合“inline tags”注释意图。
  - 风险：极窄宽度仍可能换行，需要定义可接受行为。
- 方案 B：将 skill/prompt 标签移到上方附件区域（独立一行），输入框保持独占一行。
  - 优点：避免与 textarea 争抢宽度。
  - 风险：交互位置改变，可能偏离现有预期。

### 验证计划
- 手动：在常规窗口宽度下选择 skill，观察标签与输入框同列；同时选择 prompt + skill 验证布局。
- （待确认）如有 UI 测试框架，补充快照/布局断言。

## vFinal - 2026-01-20

### 确认结论
- prompt/skill 的小 block 作为“普通单词”参与同一行排版，可随文本自然换行。
- block 仅通过容器样式体现特殊性，可删除，但不应额外占列或强制换行。

### 备注
- 允许在窄宽度下换行，不要求强制单行或横向滚动。
