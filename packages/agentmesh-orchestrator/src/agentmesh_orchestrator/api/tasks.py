"""
Task API Routes

实现 gui.md 第 3 节定义的任务相关 API：
- GET /api/tasks          - 任务列表
- GET /api/tasks/:taskId  - 任务详情
- GET /api/tasks/:taskId/events - 任务事件
- POST /api/tasks         - 创建新任务
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from agentmesh_orchestrator.models import (
    CreateTaskRequest,
    CreateTaskResponse,
    TaskDetail,
    TaskEvent,
    TaskSummary,
)
from agentmesh_orchestrator.services import TaskService

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def get_task_service() -> TaskService:
    """依赖注入：获取 TaskService 实例"""
    return TaskService()


# =============================================================================
# Response Models
# =============================================================================


class TaskListResponse(BaseModel):
    """任务列表响应"""
    tasks: list[TaskSummary]
    total: int


class TaskEventsResponse(BaseModel):
    """任务事件响应"""
    events: list[TaskEvent]
    total: int


# =============================================================================
# Routes
# =============================================================================


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    service: TaskService = Depends(get_task_service),
) -> TaskListResponse:
    """
    获取任务列表。

    扫描 .agentmesh/tasks/ 目录，返回所有任务的摘要信息。
    """
    tasks = service.list_tasks()
    return TaskListResponse(tasks=tasks, total=len(tasks))


@router.get("/{task_id}", response_model=TaskDetail)
async def get_task(
    task_id: str,
    service: TaskService = Depends(get_task_service),
) -> TaskDetail:
    """
    获取任务详情。

    读取 .agentmesh/tasks/<task_id>/task.yaml 文件。
    """
    task = service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return task


@router.get("/{task_id}/events", response_model=TaskEventsResponse)
async def get_task_events(
    task_id: str,
    type: str | None = Query(None, description="Filter by event type prefix"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum events to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    service: TaskService = Depends(get_task_service),
) -> TaskEventsResponse:
    """
    获取任务事件列表。

    读取 .agentmesh/tasks/<task_id>/events.jsonl 文件。
    支持按事件类型过滤和分页。
    """
    # 先检查任务是否存在
    task = service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    events = service.get_task_events(task_id, event_type=type, limit=limit, offset=offset)
    return TaskEventsResponse(events=events, total=len(events))


@router.post("", response_model=CreateTaskResponse, status_code=201)
async def create_task(
    request: CreateTaskRequest,
    service: TaskService = Depends(get_task_service),
) -> CreateTaskResponse:
    """
    创建新任务。

    在 .agentmesh/tasks/ 下创建新的任务目录，包含：
    - task.yaml: 任务配置
    - README.md: 任务说明
    - events.jsonl: 事件日志
    - shared/: 共享产物目录
    """
    try:
        task_id = service.create_task(request)
        return CreateTaskResponse(id=task_id, message="Task created successfully")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create task: {e}")
