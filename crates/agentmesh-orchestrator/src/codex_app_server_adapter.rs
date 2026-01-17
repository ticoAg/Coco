use crate::OrchestratorError;
use agentmesh_codex::CodexAppServerClient;
use agentmesh_codex::CodexAppServerSpawnRequest;
use agentmesh_codex::CodexJsonRpcEvent;
use serde_json::Value;
use tokio::sync::broadcast;

/// Thin wrapper around `agentmesh-codex`'s app-server client so the orchestrator layer
/// can treat "session/thread/turn/approval" as a stable semantic API.
#[derive(Clone)]
pub struct CodexAppServerAdapter {
    client: CodexAppServerClient,
}

impl CodexAppServerAdapter {
    /// Spawn `codex app-server` and create a new thread via `thread/start`.
    pub async fn start(
        spawn_req: CodexAppServerSpawnRequest,
        thread_start_params: Option<Value>,
    ) -> Result<Self, OrchestratorError> {
        let client = CodexAppServerClient::spawn(spawn_req).await?;
        let _ = client.thread_start(thread_start_params).await?;
        Ok(Self { client })
    }

    /// Spawn `codex app-server` and resume an existing thread via `thread/resume`.
    pub async fn resume(
        spawn_req: CodexAppServerSpawnRequest,
        thread_id: &str,
        params_overrides: Option<Value>,
    ) -> Result<Self, OrchestratorError> {
        let client = CodexAppServerClient::spawn(spawn_req).await?;
        client.thread_resume(thread_id, params_overrides).await?;
        Ok(Self { client })
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<CodexJsonRpcEvent> {
        self.client.subscribe_events()
    }

    pub async fn thread_id(&self) -> Option<String> {
        self.client.thread_id().await
    }

    pub async fn fork(
        &self,
        source_thread_id: &str,
        params_overrides: Option<Value>,
    ) -> Result<String, OrchestratorError> {
        Ok(self
            .client
            .thread_fork(source_thread_id, params_overrides)
            .await?)
    }

    pub async fn rollback(&self, num_turns: u32) -> Result<(), OrchestratorError> {
        self.client.thread_rollback(num_turns).await?;
        Ok(())
    }

    pub async fn start_turn(&self, params: Value) -> Result<Value, OrchestratorError> {
        Ok(self.client.turn_start(params).await?)
    }

    pub async fn interrupt_turn(&self, params: Value) -> Result<Value, OrchestratorError> {
        Ok(self.client.turn_interrupt(params).await?)
    }

    pub async fn respond_approval(
        &self,
        request_id: i64,
        result: Value,
    ) -> Result<(), OrchestratorError> {
        self.client.respond(request_id, result).await?;
        Ok(())
    }

    pub async fn shutdown(&self) {
        self.client.shutdown().await;
    }
}
