# AgentMesh Adapters

"""
AgentMesh Adapter 模块：抽象 CLI 工具与 Orchestrator 之间的交互。

可用 Adapter：
- StubAdapter: 用于测试编排逻辑（不启动真实进程）
- CodexAdapter: 对接 codex app-server（待实现）
"""

from .base import (
    Adapter,
    Event,
    EventType,
    GateDecision,
    GateRequest,
    GateState,
    SessionHandle,
    SessionState,
    StubAdapter,
    TurnInput,
)

__all__ = [
    "Adapter",
    "Event",
    "EventType",
    "GateDecision",
    "GateRequest",
    "GateState",
    "SessionHandle",
    "SessionState",
    "StubAdapter",
    "TurnInput",
]
