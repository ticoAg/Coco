# AgentMesh
AgentMesh 是一个供应商无关的多 Code Agent 编排框架，用于协调多个异构 agent（如 Codex、Claude、Gemini、Qwen）高效完成复杂开发任务。它支持 Swarm 并发协作（fork/join 聚合结果）与 Squad 分层协作（里程碑推进），并提供 Agent 生命周期与 Silent/Wake 机制，减少噪音与上下文开销。AgentMesh 强调“显式共享”的上下文协议：通过 Global/Task/Private 作用域与结构化通信，只在需要时共享必要信息，提升协作效率与可控性。
