use serde::Serialize;
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::AtomicI64;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;
use tokio::process::Child;
use tokio::process::ChildStderr;
use tokio::process::ChildStdin;
use tokio::process::ChildStdout;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::sync::oneshot;
use tokio::time::timeout;

const EVENT_NAME: &str = "codex_app_server";
const DEFAULT_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexJsonRpcEvent {
    pub kind: String,
    pub message: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcRequest<'a> {
    pub id: i64,
    pub method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcNotification<'a> {
    pub method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    pub id: i64,
    pub result: Value,
}

#[derive(Clone)]
pub struct CodexAppServer {
    inner: Arc<CodexAppServerInner>,
}

struct CodexAppServerInner {
    app: tauri::AppHandle,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>,
    next_request_id: AtomicI64,
}

impl CodexAppServer {
    pub async fn spawn(app: tauri::AppHandle, cwd: &Path) -> Result<Self, String> {
        let mut cmd = Command::new("codex");
        cmd.arg("app-server")
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(cwd);

        let mut child = cmd.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => "codex not found on PATH".to_string(),
            _ => e.to_string(),
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "codex app-server stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "codex app-server stdout unavailable".to_string())?;
        let stderr = child.stderr.take();

        let inner = Arc::new(CodexAppServerInner {
            app: app.clone(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_request_id: AtomicI64::new(-1),
        });

        tokio::spawn(run_stdout_loop(Arc::clone(&inner), stdout));
        if let Some(stderr) = stderr {
            tokio::spawn(run_stderr_loop(Arc::clone(&inner), stderr));
        }

        let server = Self { inner };
        server.initialize().await?;
        Ok(server)
    }

    async fn initialize(&self) -> Result<(), String> {
        let params = json!({
            "clientInfo": {
                "name": "agentmesh_gui",
                "title": "AgentMesh GUI",
                "version": env!("CARGO_PKG_VERSION"),
            }
        });

        let _ = self.request("initialize", Some(params)).await?;
        self.notify("initialized", None).await?;
        Ok(())
    }

    pub async fn request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self
            .inner
            .next_request_id
            .fetch_sub(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.inner.pending.lock().await;
            pending.insert(id, tx);
        }

        let request = JsonRpcRequest { id, method, params };
        self.send_json(&request).await?;

        let res = timeout(std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS), rx)
            .await
            .map_err(|_| format!("{method} timed out after {DEFAULT_TIMEOUT_SECS}s"))?
            .map_err(|_| format!("{method} response channel closed"))?;

        match res {
            Ok(value) => Ok(value),
            Err(err) => Err(err),
        }
    }

    pub async fn notify(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        let notification = JsonRpcNotification { method, params };
        self.send_json(&notification).await
    }

    pub async fn respond(&self, request_id: i64, result: Value) -> Result<(), String> {
        let response = JsonRpcResponse {
            id: request_id,
            result,
        };
        self.send_json(&response).await
    }

    pub async fn shutdown(&self) {
        let mut child = self.inner.child.lock().await;
        let _ = child.start_kill();
        let _ = child.wait().await;
    }

    async fn send_json<T: Serialize>(&self, msg: &T) -> Result<(), String> {
        let line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        let mut stdin = self.inner.stdin.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

async fn run_stdout_loop(inner: Arc<CodexAppServerInner>, stdout: ChildStdout) {
    let mut reader = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        if line.trim().is_empty() {
            continue;
        }

        let parsed: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(err) => {
                let _ = inner.app.emit(
                    EVENT_NAME,
                    CodexJsonRpcEvent {
                        kind: "error".to_string(),
                        message: json!({
                            "type": "parse_error",
                            "error": err.to_string(),
                            "line": line,
                        }),
                    },
                );
                continue;
            }
        };

        // Response to a client request (id + result).
        if parsed.get("result").is_some() {
            if let Some(id) = parsed.get("id").and_then(as_i64) {
                let result = parsed.get("result").cloned().unwrap_or(Value::Null);
                let tx = {
                    let mut pending = inner.pending.lock().await;
                    pending.remove(&id)
                };
                if let Some(tx) = tx {
                    let _ = tx.send(Ok(result));
                }
                continue;
            }
        }

        // Error response to a client request (id + error).
        if parsed.get("error").is_some() {
            if let Some(id) = parsed.get("id").and_then(as_i64) {
                let message = parsed
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error")
                    .to_string();

                let tx = {
                    let mut pending = inner.pending.lock().await;
                    pending.remove(&id)
                };
                if let Some(tx) = tx {
                    let _ = tx.send(Err(message));
                }
                continue;
            }
        }

        // Server-initiated request (method + id + params), e.g. approvals.
        if parsed.get("method").is_some() && parsed.get("id").is_some() {
            let _ = inner.app.emit(
                EVENT_NAME,
                CodexJsonRpcEvent {
                    kind: "request".to_string(),
                    message: parsed,
                },
            );
            continue;
        }

        // Notification (method + params, no id).
        if parsed.get("method").is_some() {
            let _ = inner.app.emit(
                EVENT_NAME,
                CodexJsonRpcEvent {
                    kind: "notification".to_string(),
                    message: parsed,
                },
            );
            continue;
        }

        // Unknown message.
        let _ = inner.app.emit(
            EVENT_NAME,
            CodexJsonRpcEvent {
                kind: "unknown".to_string(),
                message: parsed,
            },
        );
    }

    // If stdout closes, surface and fail any pending requests.
    let mut pending = inner.pending.lock().await;
    for (_, tx) in pending.drain() {
        let _ = tx.send(Err("codex app-server closed stdout".to_string()));
    }
}

async fn run_stderr_loop(inner: Arc<CodexAppServerInner>, stderr: ChildStderr) {
    let mut reader = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let _ = inner.app.emit(
            EVENT_NAME,
            CodexJsonRpcEvent {
                kind: "stderr".to_string(),
                message: json!({ "line": line }),
            },
        );
    }
}

fn as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse::<i64>().ok(),
        _ => None,
    }
}
