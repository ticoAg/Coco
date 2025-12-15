# AgentMesh Orchestrator
"""
AgentMesh Orchestrator Package

后端编排服务，为 GUI 提供任务管理 API。
"""

from agentmesh_orchestrator.main import app, create_app

__version__ = "0.1.0"
__all__ = ["app", "create_app"]
