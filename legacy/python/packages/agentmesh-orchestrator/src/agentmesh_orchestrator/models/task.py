"""
AgentMesh Task 数据模型

基于 task.yaml 结构和 gui.md API 规范定义的 Pydantic 模型。
"""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TaskState(str, Enum):
    """任务状态"""
    CREATED = "created"
    WORKING = "working"
    GATE_BLOCKED = "gate.blocked"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskTopology(str, Enum):
    """协作拓扑模式"""
    SWARM = "swarm"      # 蜂群模式 - 并发 Debug / 信息搜集
    SQUAD = "squad"      # 小队模式 - 全栈开发


class AgentInstanceState(str, Enum):
    """Agent 实例状态"""
    CREATED = "created"
    ACTIVE = "active"
    AWAITING = "awaiting"
    DORMANT = "dormant"
    COMPLETED = "completed"
    FAILED = "failed"


class GateState(str, Enum):
    """Gate 状态"""
    OPEN = "open"
    BLOCKED = "blocked"
    APPROVED = "approved"
    REJECTED = "rejected"


# =============================================================================
# 子结构模型
# =============================================================================

class Milestone(BaseModel):
    """里程碑"""
    id: str
    title: str
    state: str = "pending"  # pending / in_progress / done


class AgentInstance(BaseModel):
    """Agent 实例配置"""
    instance: str           # 实例 ID, 如 "architect-1"
    agent: str              # Agent spec 名称, 如 "architect"
    state: AgentInstanceState = AgentInstanceState.CREATED
    assigned_milestone: str | None = Field(None, alias="assignedMilestone")
    skills: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class Gate(BaseModel):
    """人工介入点"""
    id: str
    type: str               # applyPatch / execCommand / custom
    state: GateState = GateState.OPEN
    reason: str = ""
    agent_instance: str | None = Field(None, alias="agentInstance")
    created_at: datetime | None = Field(None, alias="createdAt")
    resolved_at: datetime | None = Field(None, alias="resolvedAt")
    decision: str | None = None  # approved / rejected
    comment: str | None = None

    model_config = {"populate_by_name": True}


class TaskConfig(BaseModel):
    """任务配置"""
    max_concurrent_agents: int = Field(3, alias="maxConcurrentAgents")
    timeout_seconds: int = Field(3600, alias="timeoutSeconds")
    auto_approve: bool = Field(False, alias="autoApprove")

    model_config = {"populate_by_name": True}


# =============================================================================
# Task 完整模型 (对应 task.yaml)
# =============================================================================

class Task(BaseModel):
    """完整的任务模型 (对应 task.yaml)"""
    id: str
    title: str
    description: str = ""
    topology: TaskTopology = TaskTopology.SQUAD
    state: TaskState = TaskState.CREATED
    created_at: datetime = Field(default_factory=datetime.utcnow, alias="createdAt")
    updated_at: datetime = Field(default_factory=datetime.utcnow, alias="updatedAt")
    milestones: list[Milestone] = Field(default_factory=list)
    roster: list[AgentInstance] = Field(default_factory=list)
    gates: list[Gate] = Field(default_factory=list)
    config: TaskConfig = Field(default_factory=TaskConfig)

    model_config = {"populate_by_name": True}


# =============================================================================
# API 响应模型
# =============================================================================

class TaskSummary(BaseModel):
    """任务摘要 (用于列表展示)"""
    id: str
    title: str
    state: TaskState
    topology: TaskTopology
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")
    agent_count: int = Field(0, alias="agentCount")
    active_gates: int = Field(0, alias="activeGates")

    model_config = {"populate_by_name": True, "by_alias": True}


class TaskDetail(BaseModel):
    """任务详情 (用于详情页)"""
    id: str
    title: str
    description: str
    topology: TaskTopology
    state: TaskState
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")
    milestones: list[Milestone]
    roster: list[AgentInstance]
    gates: list[Gate]
    config: TaskConfig

    model_config = {"populate_by_name": True, "by_alias": True}


class TaskEvent(BaseModel):
    """任务事件 (来自 events.jsonl)"""
    ts: datetime
    type: str
    task_id: str = Field(..., alias="taskId")
    agent_instance: str | None = Field(None, alias="agentInstance")
    turn_id: str | None = Field(None, alias="turnId")
    payload: dict[str, Any] = Field(default_factory=dict)
    by: str | None = None
    path: str | None = None

    model_config = {"populate_by_name": True, "by_alias": True}


# =============================================================================
# API 请求模型
# =============================================================================

class CreateTaskRequest(BaseModel):
    """创建任务请求"""
    title: str
    description: str = ""
    topology: TaskTopology = TaskTopology.SQUAD
    milestones: list[Milestone] = Field(default_factory=list)
    roster: list[AgentInstance] = Field(default_factory=list)
    config: TaskConfig | None = None


class CreateTaskResponse(BaseModel):
    """创建任务响应"""
    id: str
    message: str = "Task created successfully"
