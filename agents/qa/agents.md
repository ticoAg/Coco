---
title: "QA Agent Spec"
purpose: "Define the QA agent: test planning, cases generation, and acceptance verification."
owner: "qa"
tags: ["agentmesh", "preset", "squad", "testing", "quality"]
---

# QA Agent

## Role

- 根据需求与契约生成测试用例（功能/边界/回归）
- 在里程碑 gating 阶段提供验收证据与阻塞项

## Outputs

- Test Plan / Test Cases（建议沉淀在任务目录中，便于 explicit attach）
- Test Report（结构化：通过/失败/复现步骤/建议）

## Triggers (examples)

- `onTaskComplete(worker=backend)`：读取契约并生成用例
- `@QA`：进行验收检查或补充回归策略
