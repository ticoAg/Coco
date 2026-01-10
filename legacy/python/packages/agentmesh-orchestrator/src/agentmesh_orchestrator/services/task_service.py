"""
TaskService: 任务目录操作逻辑

负责管理 .agentmesh/tasks/<task_id>/ 目录的读写操作。

目录结构:
  .agentmesh/tasks/<task_id>/
    README.md       # 任务入口
    task.yaml       # 状态机、拓扑、gating
    events.jsonl    # 事件流
    shared/         # 共享产物
    agents/         # Agent 实例产出
"""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from agentmesh_orchestrator.models import (
    AgentInstance,
    CreateTaskRequest,
    Gate,
    GateState,
    Milestone,
    Task,
    TaskConfig,
    TaskDetail,
    TaskEvent,
    TaskState,
    TaskSummary,
    TaskTopology,
)


class TaskService:
    """任务目录管理服务"""

    def __init__(self, workspace_root: Path | None = None):
        """
        初始化 TaskService。

        Args:
            workspace_root: 工作区根目录，默认为当前目录
        """
        self.workspace_root = workspace_root or Path.cwd()
        self.tasks_dir = self.workspace_root / ".agentmesh" / "tasks"

    def _ensure_tasks_dir(self) -> None:
        """确保 tasks 目录存在"""
        self.tasks_dir.mkdir(parents=True, exist_ok=True)

    def _get_task_dir(self, task_id: str) -> Path:
        """获取任务目录路径"""
        return self.tasks_dir / task_id

    def _parse_task_yaml(self, task_dir: Path) -> Task | None:
        """解析 task.yaml 文件"""
        task_yaml_path = task_dir / "task.yaml"
        if not task_yaml_path.exists():
            return None

        try:
            with open(task_yaml_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)

            if not data:
                return None

            # 转换 YAML 数据到 Task 模型
            return Task(
                id=data.get("id", task_dir.name),
                title=data.get("title", ""),
                description=data.get("description", ""),
                topology=TaskTopology(data.get("topology", "squad")),
                state=TaskState(data.get("state", "created")),
                created_at=self._parse_datetime(data.get("createdAt")),
                updated_at=self._parse_datetime(data.get("updatedAt")),
                milestones=[
                    Milestone(**m) for m in data.get("milestones", [])
                ],
                roster=[
                    AgentInstance(**a) for a in data.get("roster", [])
                ],
                gates=[
                    Gate(**g) for g in data.get("gates", [])
                ],
                config=TaskConfig(**data.get("config", {})) if data.get("config") else TaskConfig(),
            )
        except Exception as e:
            print(f"Error parsing task.yaml for {task_dir.name}: {e}")
            return None

    def _parse_datetime(self, value: str | datetime | None) -> datetime:
        """解析日期时间字符串"""
        if value is None:
            return datetime.utcnow()
        if isinstance(value, datetime):
            return value
        try:
            # 支持 ISO 8601 格式
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return datetime.utcnow()

    def _task_to_summary(self, task: Task) -> TaskSummary:
        """将 Task 转换为 TaskSummary"""
        active_gates = sum(1 for g in task.gates if g.state == GateState.BLOCKED)
        return TaskSummary(
            id=task.id,
            title=task.title,
            state=task.state,
            topology=task.topology,
            createdAt=task.created_at,
            updatedAt=task.updated_at,
            agentCount=len(task.roster),
            activeGates=active_gates,
        )

    def _task_to_detail(self, task: Task) -> TaskDetail:
        """将 Task 转换为 TaskDetail"""
        return TaskDetail(
            id=task.id,
            title=task.title,
            description=task.description,
            topology=task.topology,
            state=task.state,
            createdAt=task.created_at,
            updatedAt=task.updated_at,
            milestones=task.milestones,
            roster=task.roster,
            gates=task.gates,
            config=task.config,
        )

    # =========================================================================
    # 公开 API
    # =========================================================================

    def list_tasks(self) -> list[TaskSummary]:
        """
        列出所有任务。

        扫描 .agentmesh/tasks/ 目录，返回任务摘要列表。
        """
        self._ensure_tasks_dir()
        tasks: list[TaskSummary] = []

        for task_dir in self.tasks_dir.iterdir():
            if not task_dir.is_dir():
                continue

            # 跳过隐藏文件和占位符
            if task_dir.name.startswith(".") or task_dir.name == "placeholder":
                continue

            task = self._parse_task_yaml(task_dir)
            if task:
                tasks.append(self._task_to_summary(task))

        # 按更新时间倒序排列
        tasks.sort(key=lambda t: t.updated_at, reverse=True)
        return tasks

    def get_task(self, task_id: str) -> TaskDetail | None:
        """
        获取任务详情。

        Args:
            task_id: 任务 ID

        Returns:
            TaskDetail 或 None (如果任务不存在)
        """
        task_dir = self._get_task_dir(task_id)
        if not task_dir.exists():
            return None

        task = self._parse_task_yaml(task_dir)
        if not task:
            return None

        return self._task_to_detail(task)

    def get_task_events(
        self,
        task_id: str,
        event_type: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[TaskEvent]:
        """
        获取任务事件列表。

        Args:
            task_id: 任务 ID
            event_type: 可选的事件类型过滤
            limit: 返回的最大事件数
            offset: 偏移量

        Returns:
            事件列表
        """
        task_dir = self._get_task_dir(task_id)
        events_path = task_dir / "events.jsonl"

        if not events_path.exists():
            return []

        events: list[TaskEvent] = []

        try:
            with open(events_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        data = json.loads(line)
                        event = TaskEvent(
                            ts=self._parse_datetime(data.get("ts")),
                            type=data.get("type", ""),
                            taskId=data.get("taskId", task_id),
                            agentInstance=data.get("agentInstance"),
                            turnId=data.get("turnId"),
                            payload=data.get("payload", {}),
                            by=data.get("by"),
                            path=data.get("path"),
                        )

                        # 应用类型过滤
                        if event_type and not event.type.startswith(event_type):
                            continue

                        events.append(event)
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            print(f"Error reading events for {task_id}: {e}")
            return []

        # 应用分页
        return events[offset : offset + limit]

    def create_task(self, request: CreateTaskRequest) -> str:
        """
        创建新任务。

        Args:
            request: 创建任务请求

        Returns:
            新任务 ID
        """
        self._ensure_tasks_dir()

        # 生成任务 ID
        task_id = f"task-{uuid.uuid4().hex[:8]}"
        task_dir = self._get_task_dir(task_id)
        task_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.utcnow()
        now_iso = now.isoformat() + "Z"

        # 创建 task.yaml
        task_data: dict[str, Any] = {
            "id": task_id,
            "title": request.title,
            "description": request.description,
            "topology": request.topology.value,
            "state": TaskState.CREATED.value,
            "createdAt": now_iso,
            "updatedAt": now_iso,
            "milestones": [
                {"id": m.id, "title": m.title, "state": m.state}
                for m in request.milestones
            ],
            "roster": [
                {
                    "instance": a.instance,
                    "agent": a.agent,
                    "state": a.state.value,
                    "assignedMilestone": a.assigned_milestone,
                    "skills": a.skills,
                }
                for a in request.roster
            ],
            "gates": [],
            "config": {
                "maxConcurrentAgents": request.config.max_concurrent_agents if request.config else 3,
                "timeoutSeconds": request.config.timeout_seconds if request.config else 3600,
                "autoApprove": request.config.auto_approve if request.config else False,
            },
        }

        task_yaml_path = task_dir / "task.yaml"
        with open(task_yaml_path, "w", encoding="utf-8") as f:
            yaml.dump(task_data, f, allow_unicode=True, default_flow_style=False)

        # 创建 README.md
        readme_content = f"""# {request.title}

> {request.description or "No description provided."}

## Task Status

- **ID**: `{task_id}`
- **State**: created
- **Topology**: {request.topology.value}
- **Created**: {now_iso}

## Milestones

{self._format_milestones_md(request.milestones)}

## Roster

{self._format_roster_md(request.roster)}

---

> See [task.yaml](./task.yaml) for full configuration.
"""
        readme_path = task_dir / "README.md"
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(readme_content)

        # 创建 events.jsonl 初始事件
        events_path = task_dir / "events.jsonl"
        initial_event = {
            "ts": now_iso,
            "type": "task.created",
            "taskId": task_id,
            "by": "user",
        }
        with open(events_path, "w", encoding="utf-8") as f:
            f.write(json.dumps(initial_event) + "\n")

        # 创建 shared 目录
        shared_dir = task_dir / "shared"
        shared_dir.mkdir(exist_ok=True)

        # 创建 context-manifest.yaml
        manifest_path = shared_dir / "context-manifest.yaml"
        with open(manifest_path, "w", encoding="utf-8") as f:
            yaml.dump(
                {
                    "version": "1.0",
                    "globalContext": [],
                    "taskContext": [],
                },
                f,
                allow_unicode=True,
            )

        # 创建 human-notes.md
        notes_path = shared_dir / "human-notes.md"
        with open(notes_path, "w", encoding="utf-8") as f:
            f.write(f"# Human Notes for {task_id}\n\n")
            f.write("Add your notes, constraints, and context here.\n")

        return task_id

    def _format_milestones_md(self, milestones: list[Milestone]) -> str:
        """格式化里程碑为 Markdown 表格"""
        if not milestones:
            return "No milestones defined."

        lines = ["| ID | Title | State |", "|---|---|---|"]
        for m in milestones:
            state_icon = {"done": "[x]", "in_progress": "[-]", "pending": "[ ]"}.get(m.state, "[ ]")
            lines.append(f"| {m.id} | {m.title} | {state_icon} {m.state} |")
        return "\n".join(lines)

    def _format_roster_md(self, roster: list[AgentInstance]) -> str:
        """格式化阵容为 Markdown 表格"""
        if not roster:
            return "No agents assigned."

        lines = ["| Instance | Agent | State |", "|---|---|---|"]
        for a in roster:
            lines.append(f"| {a.instance} | {a.agent} | {a.state.value} |")
        return "\n".join(lines)

    def append_event(self, task_id: str, event: dict[str, Any]) -> bool:
        """
        追加事件到任务的 events.jsonl。

        Args:
            task_id: 任务 ID
            event: 事件数据

        Returns:
            是否成功
        """
        task_dir = self._get_task_dir(task_id)
        events_path = task_dir / "events.jsonl"

        if not task_dir.exists():
            return False

        try:
            # 确保事件有时间戳和 taskId
            if "ts" not in event:
                event["ts"] = datetime.utcnow().isoformat() + "Z"
            if "taskId" not in event:
                event["taskId"] = task_id

            with open(events_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(event) + "\n")
            return True
        except Exception as e:
            print(f"Error appending event for {task_id}: {e}")
            return False

    def update_task_state(self, task_id: str, state: TaskState) -> bool:
        """
        更新任务状态。

        Args:
            task_id: 任务 ID
            state: 新状态

        Returns:
            是否成功
        """
        task_dir = self._get_task_dir(task_id)
        task_yaml_path = task_dir / "task.yaml"

        if not task_yaml_path.exists():
            return False

        try:
            with open(task_yaml_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)

            data["state"] = state.value
            data["updatedAt"] = datetime.utcnow().isoformat() + "Z"

            with open(task_yaml_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

            return True
        except Exception as e:
            print(f"Error updating task state for {task_id}: {e}")
            return False
