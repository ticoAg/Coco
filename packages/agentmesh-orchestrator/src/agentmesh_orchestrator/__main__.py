"""
AgentMesh Orchestrator - Module Entry Point

支持通过 `python -m agentmesh_orchestrator` 启动服务。
或通过 `just backend dev` 启动。
"""

import uvicorn


def main() -> None:
    """启动 Orchestrator 服务"""
    uvicorn.run(
        "agentmesh_orchestrator.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["packages/agentmesh-orchestrator/src"],
    )


if __name__ == "__main__":
    main()
