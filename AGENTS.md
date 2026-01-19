---
language: zh
type: AI Agent Guidance
note: 本文档为 AI Agent 核心行为准则。AI 需具备上下文感知能力，优先模仿现有代码风格。
---

<!-- OPENSPEC:START -->

# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:

- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:

- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# AI Agent 开发原则与协作规范
> 本项目作为 openai/codex 的下游应用存在，可以视其为基建，原子组件，独立工具，依赖其支持的功能
> openai/codex repo 已拉下来，位于 ~/Documents/myws/ags/codex，需要适配对接时优先从对应repo中查找源码，但不允许修改repo 源码
> 存在不支持的功能可在本项目中构建对应模块 adaptor 实现

## 一、 核心交互流程(最高优先级)

### 1. 方案先行，思维对齐 (Proposal & Alignment)

在执行修改前，请输出简要方案并等待确认：

- **变更摘要**：列出受影响的文件及核心逻辑变化
- **决策权交给开发者**：如果需求存在模糊，或技术方案存在副作用，提供选项交由开发者决策
- **文档系统同步**：在方案中明确本次变更如果影响文档系统`./docs`,需同步更新文档系统

### 2. 上下文感知 (Context Awareness)

- **阅读优于臆测**：实现功能前，先探索repo中功能相关的模块，确定修改目标
- **SDK 查证**：调用第三方库前，请查阅本地源码, 严禁凭猜测编写接口调用
- **AI 协议共享**: 主动阅读工作目录下可能存在的 `AGENTS.md/README.md/CONTRIBUTING/docs` 等文档，了解对应 repo/module 的工作模式

---

## 二、 架构与设计原则

## 2.1. 设计原则

- Single Responsibility Principle: 单一职责原则
- Open Closed Principle: 开闭原则
- Liskov Substitution Principle: 里式替换原则
- Interface Segregation Principle: 接口隔离原则
- Dependency Inversion Principle: 依赖反转原则
- Keep It Simple and Stupid: 保持简单
- You Ain't Gonna Need It: 拒绝过度设计, 仅实现当前需求，不为“未来可能”增加冗余抽象
- Don't Repeat Yourself: 不要重复
- Law of Demeter: 迪米特法则

---

## 三、 工程实施规范

### 文档系统同步

- **统一入口**：项目所有说明性文档统一收敛到 `./docs` 目录，并以 `./docs/README.md` 作为文档结构与索引的入口说明。
- **主动比对**：完成代码变更后，评估是否需要更新文档系统
- **事实同步**：如发现接口、配置、数据结构、错误码、运行行为等“事实类信息”不一致，请在本次变更中同步更新对应文档
- **覆盖整个文档系统**：文档同步要求适用于文档系统内的所有文档，而非仅限某一类；凡是被本次代码变更影响的说明性内容，都需要更新或明确标注原因。

## 开发 && 部署

针对项目具体情况提供简洁的,丰富的快速启动脚本,避免冗余操作,尽量自动化完成部署运维等

**注意**：动手写代码前，请自问：**“我是否已理解现有代码风格？我是否已向开发者确认了方案及潜在分歧？”**
