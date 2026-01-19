# Codex Worker Prompt（可复用模板）

> 目的：让 Coco 以“prompt + 结构化输出协议”的方式，把 `codex exec --json` 当作一个可编排的 subagent worker。
>
> 适用：[`docs/coco/subagents.md`](../subagents.md) 的并行 worker 架构。
>
> 执行闭环与 evidence-first 约定见：[`docs/coco/execution.md`](../execution.md)。

## 1. 约束：你是 subagent，不是主控

对 worker 来说最重要的约束是：**产出可合并的变更与可编排的结构化结果**，而不是自己做全局决策。

建议在 prompt 中明确：

- 你只负责本子任务目标（子目标），不要“扩需求”
- 如果遇到阻塞点，输出 `status=blocked` 并写清楚 `questions`
- 不要在本分支/worktree 上做合并操作（不要 `git merge/rebase/push`），只提交可被主控合并的变更

## 2. 输出协议（强制）

Coco 建议通过 `--output-schema schemas/worker-output.schema.json` 强制最终输出结构化 JSON。

worker 在最后一条消息必须输出一个 JSON 对象，字段语义参考：

- [`schemas/worker-output.schema.json`](../../../schemas/worker-output.schema.json)

## 3. 推荐 Prompt 模板（给 Controller 拼接用）

> 注意：这不是 Codex 的系统 prompt，而是 Controller（或上层编排器）传给 worker 的任务 prompt 模板（你可以在程序里做填充）。

```
你是一个子代理（subagent worker）。你只负责完成下面这个子任务。

## 子任务目标
{{SUBTASK_GOAL}}

## 工作区与提交约束
- 你在独立 git worktree 中工作：{{WORKTREE_PATH}}
- 产出应该能被主控通过 cherry-pick/patch 合并
- 不要执行 git merge/rebase/push

## 可用上下文（显式共享）
{{EXPLICIT_ATTACHMENTS}}

## 完成标准（Definition of Done）
{{DOD}}

## 输出要求（必须遵守）
最后请只输出一个 JSON 对象，满足 `schemas/worker-output.schema.json`：
- 成功：status=success，并给出 summary + artifacts（branch/worktreePath/touchedFiles 可选）+ nextActions
- 阻塞：status=blocked，并给出 questions（明确问什么、为什么需要）
- 失败：status=failed，并给出 errors（简要）+ nextActions（如何排障/重试）

## 证据要求（强烈建议）
为了让主控不必吞下大量过程日志，请在 `summary` 或 `nextActions` 中用“可复盘指针”的方式写出关键依据（Controller 可据此生成 Evidence Index）：

- 代码证据：`path:line`（或 `path:startLine-endLine`）
- 命令证据：命令本身 + 你认为关键的输出/错误摘要（必要时指出 `runtime/events.jsonl` / `stderr.log` 中可检索的关键词）
```

## 4. 经验规则（可选放到 prompt）

为提高可预测性，建议在 prompt 里加入：

- 优先小步提交、避免“大而全”改动
- 改完后跑最相关的测试/构建命令，并在 `nextActions` 里写出你跑了什么、结果如何
- 如果你需要主控再 spawn 另一个 subagent，写进 `nextActions`（例如“建议再开一个 agent 去定位 X”）
