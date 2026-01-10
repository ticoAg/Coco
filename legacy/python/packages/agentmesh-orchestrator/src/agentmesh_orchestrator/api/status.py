"""
Status API Routes

系统状态和实时事件流 API：
- GET /api/status  - 集群状态
- GET /api/stream  - SSE 实时事件流
"""

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["system"])


# =============================================================================
# Models
# =============================================================================


class ClusterStatus(BaseModel):
    """集群状态"""
    orchestrator: str  # "online" | "offline"
    codexAdapter: str  # "connected" | "disconnected"
    activeAgents: int
    maxAgents: int


# =============================================================================
# Routes
# =============================================================================


@router.get("/status", response_model=ClusterStatus)
async def get_cluster_status() -> ClusterStatus:
    """
    获取集群状态。

    返回 Orchestrator 运行状态、Adapter 连接状态、活跃 Agent 数量等。
    """
    # TODO: 实现真实状态检查
    return ClusterStatus(
        orchestrator="online",
        codexAdapter="disconnected",  # Codex Adapter 尚未实现
        activeAgents=0,
        maxAgents=10,
    )


@router.get("/stream")
async def event_stream() -> StreamingResponse:
    """
    SSE 实时事件流。

    推送任务状态更新、Gate 创建、产物变更等事件。
    客户端通过 EventSource 连接此端点接收实时更新。
    """
    return StreamingResponse(
        _generate_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


async def _generate_events() -> AsyncGenerator[str, None]:
    """
    生成 SSE 事件流。

    格式: data: {json}\n\n
    """
    # 发送初始连接成功事件
    yield _format_sse_event({
        "type": "connected",
        "data": {"message": "SSE connection established"}
    })

    # 保持连接，定期发送心跳
    # TODO: 集成真实事件发布/订阅机制
    while True:
        await asyncio.sleep(30)  # 30秒心跳间隔
        yield _format_sse_event({
            "type": "heartbeat",
            "data": {"timestamp": asyncio.get_event_loop().time()}
        })


def _format_sse_event(event: dict) -> str:
    """格式化 SSE 事件"""
    return f"data: {json.dumps(event)}\n\n"
