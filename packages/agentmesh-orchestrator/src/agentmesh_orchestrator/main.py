"""
AgentMesh Orchestrator - FastAPI Application

本地后台服务，为 GUI 提供任务管理 API。

主要功能：
- 任务列表/详情/事件查询
- 任务创建
- CORS 支持 (允许 localhost:5173 前端访问)
"""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agentmesh_orchestrator.api import status_router, tasks_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """应用生命周期管理"""
    # Startup
    workspace_root = Path.cwd()
    tasks_dir = workspace_root / ".agentmesh" / "tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    print(f"AgentMesh Orchestrator starting...")
    print(f"  Workspace: {workspace_root}")
    print(f"  Tasks dir: {tasks_dir}")
    yield
    # Shutdown
    print("AgentMesh Orchestrator shutting down...")


def create_app() -> FastAPI:
    """创建 FastAPI 应用实例"""
    app = FastAPI(
        title="AgentMesh Orchestrator",
        description="Backend service for AgentMesh GUI - manages task directories and agent sessions.",
        version="0.1.0",
        lifespan=lifespan,
    )

    # 配置 CORS - 允许前端开发服务器访问
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",      # Vite dev server
            "http://127.0.0.1:5173",
            "http://localhost:3000",      # Alternative dev port
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 注册路由
    app.include_router(tasks_router)
    app.include_router(status_router)

    # 健康检查端点
    @app.get("/health", tags=["system"])
    async def health_check() -> dict[str, str]:
        """健康检查"""
        return {"status": "ok", "service": "agentmesh-orchestrator"}

    # API 根端点
    @app.get("/api", tags=["system"])
    async def api_root() -> dict[str, str]:
        """API 根端点"""
        return {
            "service": "agentmesh-orchestrator",
            "version": "0.1.0",
            "docs": "/docs",
        }

    return app


# 创建默认应用实例
app = create_app()
