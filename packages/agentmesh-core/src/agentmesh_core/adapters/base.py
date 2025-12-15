# AgentMesh Adapter Interface (Python Protocol)

"""
Adapter 接口定义：抽象 CLI 工具（如 Codex）与 AgentMesh Orchestrator 之间的交互。

设计原则：
- 基于 Python Protocol（结构化子类型），不强制继承
- 异步优先（asyncio），便于并发管理多个 coder session
- 事件驱动：通过 AsyncIterator 暴露事件流
"""

from abc import abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, AsyncIterator, Protocol, runtime_checkable


# ============================================================
# 基础类型定义
# ============================================================

class SessionState(Enum):
    """Agent session 生命周期状态"""
    CREATED = "created"
    ACTIVE = "active"
    AWAITING = "awaiting"      # 待命沉默，保持上下文
    DORMANT = "dormant"        # 序列化休眠，需重新加载
    COMPLETED = "completed"
    FAILED = "failed"


class GateState(Enum):
    """人工介入点状态"""
    OPEN = "open"
    BLOCKED = "blocked"        # 等待人类决策
    APPROVED = "approved"
    REJECTED = "rejected"


class EventType(Enum):
    """AgentMesh 统一事件类型"""
    # Session 生命周期
    SESSION_STARTED = "session.started"
    SESSION_RESUMED = "session.resumed"
    SESSION_COMPLETED = "session.completed"
    SESSION_FAILED = "session.failed"
    
    # Turn 生命周期
    TURN_STARTED = "turn.started"
    TURN_COMPLETED = "turn.completed"
    TURN_INTERRUPTED = "turn.interrupted"
    
    # Item（过程产物）
    ITEM_MESSAGE = "item.message"
    ITEM_COMMAND = "item.command"
    ITEM_FILE_CHANGE = "item.fileChange"
    ITEM_TODO = "item.todo"
    ITEM_ERROR = "item.error"
    
    # Gate（人工介入）
    GATE_BLOCKED = "gate.blocked"
    GATE_APPROVED = "gate.approved"
    GATE_REJECTED = "gate.rejected"
    
    # Artifact（结构化产物）
    ARTIFACT_WRITTEN = "artifact.written"


@dataclass
class Event:
    """AgentMesh 事件基类"""
    type: EventType
    timestamp: str               # ISO 8601 格式
    session_id: str
    turn_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class SessionHandle:
    """Session 句柄：用于恢复或继续会话"""
    session_id: str
    adapter: str                 # adapter 名称，如 "codex-app-server"
    agent: str                   # agent spec 名称，如 "db"
    instance: str                # 实例 ID，如 "db-1"
    cwd: Path
    state: SessionState
    vendor_session: dict[str, Any] = field(default_factory=dict)  # 工具特定信息，如 threadId


@dataclass
class TurnInput:
    """一轮 turn 的输入"""
    text: str
    attachments: list[Path] = field(default_factory=list)
    overrides: dict[str, Any] = field(default_factory=dict)  # sandbox policy 等


@dataclass
class GateRequest:
    """人工介入请求"""
    gate_id: str
    type: str                    # applyPatch / execCommand / custom
    reason: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class GateDecision:
    """人工决策结果"""
    gate_id: str
    approved: bool
    comment: str | None = None
    constraints: dict[str, Any] = field(default_factory=dict)


# ============================================================
# Adapter Protocol 定义
# ============================================================

@runtime_checkable
class Adapter(Protocol):
    """
    AgentMesh Adapter 接口协议。
    
    实现者需要提供与特定 CLI 工具（如 Codex）交互的能力，包括：
    - Session 管理（创建、恢复、销毁）
    - Turn 执行（发送输入、接收事件流）
    - Gate 处理（接收 approval 请求、回传决策）
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Adapter 名称，如 'codex-app-server' / 'codex-exec' / 'stub'"""
        ...
    
    # --------------------------------------------------------
    # Session 管理
    # --------------------------------------------------------
    
    @abstractmethod
    async def start_session(
        self,
        agent: str,
        instance: str,
        cwd: Path,
        agent_spec_path: Path | None = None,
        skills: list[str] | None = None,
    ) -> SessionHandle:
        """
        创建新的 coder session。
        
        Args:
            agent: Agent spec 名称（对应 agents/*/agents.md）
            instance: 实例 ID（如 "db-1"）
            cwd: 工作目录
            agent_spec_path: 可选的 agents.md 路径
            skills: 预装的 skill 列表
        
        Returns:
            SessionHandle: 可用于后续操作的句柄
        """
        ...
    
    @abstractmethod
    async def resume_session(self, handle: SessionHandle) -> SessionHandle:
        """
        恢复已有 session（从 Awaiting/Dormant 状态）。
        
        Args:
            handle: 之前保存的 SessionHandle
        
        Returns:
            SessionHandle: 更新后的句柄
        """
        ...
    
    @abstractmethod
    async def stop_session(self, handle: SessionHandle) -> None:
        """
        停止并清理 session。
        
        对于 Codex，这会终止后台进程并保存 rollout。
        """
        ...
    
    # --------------------------------------------------------
    # Turn 执行
    # --------------------------------------------------------
    
    @abstractmethod
    async def start_turn(
        self,
        handle: SessionHandle,
        input: TurnInput,
    ) -> AsyncIterator[Event]:
        """
        启动一轮 turn 并返回事件流。
        
        事件流会一直产出直到 turn 完成或被中断。
        如果遇到 GATE_BLOCKED 事件，调用方应调用 respond_gate() 后继续消费事件流。
        
        Args:
            handle: Session 句柄
            input: 本轮输入
        
        Yields:
            Event: 事件流（TURN_STARTED -> ITEM_* / GATE_BLOCKED -> TURN_COMPLETED）
        """
        ...
    
    @abstractmethod
    async def interrupt_turn(self, handle: SessionHandle, turn_id: str) -> None:
        """
        中断正在执行的 turn。
        
        中断后，事件流会产出 TURN_INTERRUPTED 并结束。
        """
        ...
    
    # --------------------------------------------------------
    # Gate 处理
    # --------------------------------------------------------
    
    @abstractmethod
    async def respond_gate(
        self,
        handle: SessionHandle,
        decision: GateDecision,
    ) -> None:
        """
        回应 gate 请求（allow/deny）。
        
        调用后，turn 的事件流会继续产出后续事件。
        """
        ...
    
    # --------------------------------------------------------
    # 辅助方法
    # --------------------------------------------------------
    
    @abstractmethod
    async def get_session_state(self, handle: SessionHandle) -> SessionState:
        """获取 session 当前状态"""
        ...
    
    @abstractmethod
    async def list_skills(self, cwd: Path) -> list[dict[str, Any]]:
        """
        列出指定目录下可用的 skills。
        
        Returns:
            list[dict]: 每个 skill 包含 name, description, path 等字段
        """
        ...


# ============================================================
# Stub Adapter（用于测试编排逻辑）
# ============================================================

class StubAdapter:
    """
    Stub Adapter：模拟 agent 输出，用于验证编排逻辑。
    
    不启动真实 Codex 进程，而是根据预设规则返回模拟事件。
    """
    
    @property
    def name(self) -> str:
        return "stub"
    
    async def start_session(
        self,
        agent: str,
        instance: str,
        cwd: Path,
        agent_spec_path: Path | None = None,
        skills: list[str] | None = None,
    ) -> SessionHandle:
        import uuid
        from datetime import datetime
        
        session_id = f"stub-{uuid.uuid4().hex[:8]}"
        return SessionHandle(
            session_id=session_id,
            adapter=self.name,
            agent=agent,
            instance=instance,
            cwd=cwd,
            state=SessionState.ACTIVE,
            vendor_session={"created_at": datetime.utcnow().isoformat()},
        )
    
    async def resume_session(self, handle: SessionHandle) -> SessionHandle:
        handle.state = SessionState.ACTIVE
        return handle
    
    async def stop_session(self, handle: SessionHandle) -> None:
        handle.state = SessionState.COMPLETED
    
    async def start_turn(
        self,
        handle: SessionHandle,
        input: TurnInput,
    ) -> AsyncIterator[Event]:
        import uuid
        from datetime import datetime
        
        turn_id = f"turn-{uuid.uuid4().hex[:8]}"
        now = datetime.utcnow().isoformat() + "Z"
        
        # 模拟事件序列
        yield Event(
            type=EventType.TURN_STARTED,
            timestamp=now,
            session_id=handle.session_id,
            turn_id=turn_id,
            payload={"input": input.text},
        )
        
        yield Event(
            type=EventType.ITEM_MESSAGE,
            timestamp=now,
            session_id=handle.session_id,
            turn_id=turn_id,
            payload={"role": "agent", "content": f"[Stub] Received: {input.text[:50]}..."},
        )
        
        yield Event(
            type=EventType.TURN_COMPLETED,
            timestamp=now,
            session_id=handle.session_id,
            turn_id=turn_id,
            payload={"status": "completed"},
        )
    
    async def interrupt_turn(self, handle: SessionHandle, turn_id: str) -> None:
        pass  # Stub 无需实际中断
    
    async def respond_gate(
        self,
        handle: SessionHandle,
        decision: GateDecision,
    ) -> None:
        pass  # Stub 无 gate
    
    async def get_session_state(self, handle: SessionHandle) -> SessionState:
        return handle.state
    
    async def list_skills(self, cwd: Path) -> list[dict[str, Any]]:
        return []  # Stub 不返回 skills
