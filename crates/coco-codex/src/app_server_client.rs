use serde::Serialize;
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::AtomicI64;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;
use tokio::process::Child;
use tokio::process::ChildStderr;
use tokio::process::ChildStdin;
use tokio::process::ChildStdout;
use tokio::process::Command;
use tokio::sync::broadcast;
use tokio::sync::oneshot;
use tokio::sync::Mutex;
use tokio::time::timeout;

const DEFAULT_CODEX_BIN: &str = "codex";
const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 30;

const DEFAULT_ADAPTER_NAME: &str = "codex-app-server";

const RUNTIME_DIR_NAME: &str = "runtime";
const CODEX_HOME_DIR_NAME: &str = "codex_home";

const REQUESTS_FILE_NAME: &str = "requests.jsonl";
const EVENTS_FILE_NAME: &str = "events.jsonl";
const STDERR_FILE_NAME: &str = "stderr.log";
const SESSION_FILE_NAME: &str = "session.json";

const RECORDING_REQUESTS_REL: &str = "./runtime/requests.jsonl";
const RECORDING_EVENTS_REL: &str = "./runtime/events.jsonl";
const RECORDING_STDERR_REL: &str = "./runtime/stderr.log";

#[derive(Debug, Clone)]
pub struct CodexAppServerSpawnRequest {
    pub agent_dir: PathBuf,
    pub cwd: PathBuf,

    /// Program to spawn. Defaults to `codex` (from PATH).
    pub codex_bin: PathBuf,

    /// Arguments passed to the spawned program. Defaults to `["app-server"]`.
    ///
    /// Notes:
    /// - This exists so tests (and advanced callers) can run a mock JSON-RPC server.
    /// - If you override this, you are responsible for including `app-server` if needed.
    pub codex_args: Vec<String>,

    /// When set, overrides the spawned process' CODEX_HOME. When not set, defaults to
    /// `agents/<instance>/codex_home`.
    pub codex_home: Option<PathBuf>,

    /// JSON-RPC request timeout. Defaults to 30s.
    pub request_timeout_secs: u64,
}

impl CodexAppServerSpawnRequest {
    pub fn new(agent_dir: PathBuf, cwd: PathBuf) -> Self {
        Self {
            agent_dir,
            cwd,
            codex_bin: PathBuf::from(DEFAULT_CODEX_BIN),
            codex_args: vec!["app-server".to_string()],
            codex_home: None,
            request_timeout_secs: DEFAULT_REQUEST_TIMEOUT_SECS,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexJsonRpcEvent {
    pub kind: String,
    pub message: Value,
}

#[derive(Debug, thiserror::Error)]
pub enum CodexAppServerError {
    #[error("codex binary not found on PATH")]
    CodexNotFound,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("request timed out after {timeout_secs}s: {method}")]
    RequestTimeout { method: String, timeout_secs: u64 },
    #[error("response channel closed: {method}")]
    ResponseChannelClosed { method: String },
    #[error("server error for {method}: {message}")]
    ServerError { method: String, message: String },
    #[error("thread id missing from thread response")]
    MissingThreadId,
}

#[derive(Debug, Serialize)]
struct JsonRpcRequest<'a> {
    id: i64,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcNotification<'a> {
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    id: i64,
    result: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionFile {
    adapter: String,
    vendor_session: VendorSession,
    recording: Recording,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VendorSession {
    tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    forked_from_thread_id: Option<String>,
    cwd: String,
    codex_home: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Recording {
    requests: String,
    events: String,
    stderr: String,
}

#[derive(Clone)]
pub struct CodexAppServerClient {
    inner: Arc<CodexAppServerInner>,
}

struct CodexAppServerInner {
    child: Mutex<Child>,
    send_lock: Mutex<()>,
    stdin: Mutex<ChildStdin>,
    requests_log: Mutex<tokio::fs::File>,
    pending: Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>,
    next_request_id: AtomicI64,
    request_timeout_secs: u64,
    events_tx: broadcast::Sender<CodexJsonRpcEvent>,

    // Session/recording metadata.
    agent_dir: PathBuf,
    session_path: PathBuf,
    codex_home: PathBuf,
    cwd: PathBuf,
    thread_id: Mutex<Option<String>>,
    forked_from_thread_id: Mutex<Option<String>>,
    events_path: PathBuf,
    stderr_path: PathBuf,
}

impl CodexAppServerClient {
    pub async fn spawn(req: CodexAppServerSpawnRequest) -> Result<Self, CodexAppServerError> {
        let runtime_dir = req.agent_dir.join(RUNTIME_DIR_NAME);
        let requests_path = runtime_dir.join(REQUESTS_FILE_NAME);
        let events_path = runtime_dir.join(EVENTS_FILE_NAME);
        let stderr_path = runtime_dir.join(STDERR_FILE_NAME);
        let session_path = req.agent_dir.join(SESSION_FILE_NAME);

        let codex_home = req
            .codex_home
            .clone()
            .unwrap_or_else(|| req.agent_dir.join(CODEX_HOME_DIR_NAME));

        tokio::fs::create_dir_all(&runtime_dir).await?;
        tokio::fs::create_dir_all(&codex_home).await?;

        let requests_log = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&requests_path)
            .await?;

        write_session_file(
            &session_path,
            SessionFile {
                adapter: DEFAULT_ADAPTER_NAME.to_string(),
                vendor_session: VendorSession {
                    tool: "codex".to_string(),
                    thread_id: None,
                    forked_from_thread_id: None,
                    cwd: req.cwd.to_string_lossy().to_string(),
                    codex_home: path_to_portable_string(&req.agent_dir, &codex_home),
                },
                recording: Recording {
                    requests: RECORDING_REQUESTS_REL.to_string(),
                    events: RECORDING_EVENTS_REL.to_string(),
                    stderr: RECORDING_STDERR_REL.to_string(),
                },
            },
        )
        .await?;

        let mut cmd = Command::new(&req.codex_bin);
        for arg in &req.codex_args {
            cmd.arg(arg);
        }

        cmd.kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("CODEX_HOME", &codex_home)
            .current_dir(&req.cwd);

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(CodexAppServerError::CodexNotFound)
            }
            Err(err) => return Err(CodexAppServerError::Io(err)),
        };

        let stdin = child
            .stdin
            .take()
            .expect("codex app-server stdin must be piped");
        let stdout = child
            .stdout
            .take()
            .expect("codex app-server stdout must be piped");
        let stderr = child.stderr.take();

        let (events_tx, _events_rx) = broadcast::channel(128);

        let inner = Arc::new(CodexAppServerInner {
            child: Mutex::new(child),
            send_lock: Mutex::new(()),
            stdin: Mutex::new(stdin),
            requests_log: Mutex::new(requests_log),
            pending: Mutex::new(HashMap::new()),
            next_request_id: AtomicI64::new(-1),
            request_timeout_secs: req.request_timeout_secs,
            events_tx,
            agent_dir: req.agent_dir.clone(),
            session_path,
            codex_home,
            cwd: req.cwd.clone(),
            thread_id: Mutex::new(None),
            forked_from_thread_id: Mutex::new(None),
            events_path,
            stderr_path,
        });

        tokio::spawn(run_stdout_loop(Arc::clone(&inner), stdout));
        if let Some(stderr) = stderr {
            tokio::spawn(run_stderr_loop(Arc::clone(&inner), stderr));
        }

        let client = Self { inner };
        client.initialize().await?;
        Ok(client)
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<CodexJsonRpcEvent> {
        self.inner.events_tx.subscribe()
    }

    pub async fn thread_id(&self) -> Option<String> {
        self.inner.thread_id.lock().await.clone()
    }

    pub async fn request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, CodexAppServerError> {
        let id = self.inner.next_request_id.fetch_sub(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.inner.pending.lock().await;
            pending.insert(id, tx);
        }

        let request = JsonRpcRequest { id, method, params };
        if let Err(err) = self.send_json(&request).await {
            let mut pending = self.inner.pending.lock().await;
            pending.remove(&id);
            return Err(err);
        }

        let res = timeout(
            std::time::Duration::from_secs(self.inner.request_timeout_secs),
            rx,
        )
        .await
        .map_err(|_| CodexAppServerError::RequestTimeout {
            method: method.to_string(),
            timeout_secs: self.inner.request_timeout_secs,
        })?
        .map_err(|_| CodexAppServerError::ResponseChannelClosed {
            method: method.to_string(),
        })?;

        match res {
            Ok(value) => Ok(value),
            Err(message) => Err(CodexAppServerError::ServerError {
                method: method.to_string(),
                message,
            }),
        }
    }

    pub async fn notify(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), CodexAppServerError> {
        let notification = JsonRpcNotification { method, params };
        self.send_json(&notification).await
    }

    pub async fn respond(&self, request_id: i64, result: Value) -> Result<(), CodexAppServerError> {
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

    pub async fn thread_list(&self, params: Option<Value>) -> Result<Value, CodexAppServerError> {
        self.request("thread/list", params).await
    }

    pub async fn model_list(&self, params: Option<Value>) -> Result<Value, CodexAppServerError> {
        self.request("model/list", params).await
    }

    pub async fn config_read(&self, params: Option<Value>) -> Result<Value, CodexAppServerError> {
        self.request("config/read", params).await
    }

    pub async fn thread_start(&self, params: Option<Value>) -> Result<String, CodexAppServerError> {
        let result = self.request("thread/start", params).await?;
        let thread_id = extract_thread_id_from_thread_result(&result)?;
        self.set_thread_id(Some(thread_id.clone()), None).await?;
        Ok(thread_id)
    }

    pub async fn thread_resume(
        &self,
        thread_id: &str,
        params_overrides: Option<Value>,
    ) -> Result<(), CodexAppServerError> {
        let mut params = json!({ "threadId": thread_id });
        if let Some(overrides) = params_overrides {
            merge_json_objects(&mut params, overrides);
        }
        let result = self.request("thread/resume", Some(params)).await?;
        let resolved_thread_id =
            extract_thread_id_from_thread_result(&result).unwrap_or_else(|_| thread_id.to_string());
        self.set_thread_id(Some(resolved_thread_id), None).await?;
        Ok(())
    }

    pub async fn thread_fork(
        &self,
        source_thread_id: &str,
        params_overrides: Option<Value>,
    ) -> Result<String, CodexAppServerError> {
        let mut params = json!({ "threadId": source_thread_id });
        if let Some(overrides) = params_overrides {
            merge_json_objects(&mut params, overrides);
        }
        let result = self.request("thread/fork", Some(params)).await?;
        let new_thread_id = extract_thread_id_from_thread_result(&result)?;
        self.set_thread_id(
            Some(new_thread_id.clone()),
            Some(source_thread_id.to_string()),
        )
        .await?;
        Ok(new_thread_id)
    }

    pub async fn thread_rollback(&self, num_turns: u32) -> Result<(), CodexAppServerError> {
        let Some(thread_id) = self.thread_id().await else {
            return Ok(());
        };
        let params = json!({
            "threadId": thread_id,
            "numTurns": num_turns,
        });
        let _ = self.request("thread/rollback", Some(params)).await?;
        Ok(())
    }

    pub async fn turn_start(&self, params: Value) -> Result<Value, CodexAppServerError> {
        self.request("turn/start", Some(params)).await
    }

    pub async fn turn_interrupt(&self, params: Value) -> Result<Value, CodexAppServerError> {
        self.request("turn/interrupt", Some(params)).await
    }

    async fn initialize(&self) -> Result<(), CodexAppServerError> {
        let params = json!({
            "clientInfo": {
                "name": "codex_cli_rs",
                "title": "Coco",
                "version": env!("CARGO_PKG_VERSION"),
            }
        });

        let _ = self.request("initialize", Some(params)).await?;
        self.notify("initialized", None).await?;
        Ok(())
    }

    async fn send_json<T: Serialize>(&self, msg: &T) -> Result<(), CodexAppServerError> {
        let line = serde_json::to_string(msg)?;
        let _guard = self.inner.send_lock.lock().await;
        {
            let mut stdin = self.inner.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.write_all(b"\n").await?;
            stdin.flush().await?;
        }
        {
            let mut log = self.inner.requests_log.lock().await;
            log.write_all(line.as_bytes()).await?;
            log.write_all(b"\n").await?;
            log.flush().await?;
        }
        Ok(())
    }

    async fn set_thread_id(
        &self,
        thread_id: Option<String>,
        forked_from_thread_id: Option<String>,
    ) -> Result<(), CodexAppServerError> {
        {
            let mut guard = self.inner.thread_id.lock().await;
            *guard = thread_id.clone();
        }
        {
            let mut guard = self.inner.forked_from_thread_id.lock().await;
            *guard = forked_from_thread_id.clone();
        }

        write_session_file(
            &self.inner.session_path,
            SessionFile {
                adapter: DEFAULT_ADAPTER_NAME.to_string(),
                vendor_session: VendorSession {
                    tool: "codex".to_string(),
                    thread_id,
                    forked_from_thread_id,
                    cwd: self.inner.cwd.to_string_lossy().to_string(),
                    codex_home: path_to_portable_string(
                        &self.inner.agent_dir,
                        &self.inner.codex_home,
                    ),
                },
                recording: Recording {
                    requests: RECORDING_REQUESTS_REL.to_string(),
                    events: RECORDING_EVENTS_REL.to_string(),
                    stderr: RECORDING_STDERR_REL.to_string(),
                },
            },
        )
        .await?;

        Ok(())
    }
}

async fn write_session_file(path: &Path, session: SessionFile) -> Result<(), CodexAppServerError> {
    let json = serde_json::to_string_pretty(&session)?;
    tokio::fs::write(path, json).await?;
    Ok(())
}

fn extract_thread_id_from_thread_result(result: &Value) -> Result<String, CodexAppServerError> {
    let thread_id = result
        .get("thread")
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str())
        .ok_or(CodexAppServerError::MissingThreadId)?;
    Ok(thread_id.to_string())
}

fn merge_json_objects(target: &mut Value, overlay: Value) {
    let Some(target_obj) = target.as_object_mut() else {
        return;
    };
    let Some(overlay_obj) = overlay.as_object() else {
        return;
    };
    for (k, v) in overlay_obj {
        target_obj.insert(k.clone(), v.clone());
    }
}

fn path_to_portable_string(base_dir: &Path, path: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(base_dir) {
        if rel.as_os_str().is_empty() {
            return ".".to_string();
        }
        return format!("./{}", rel.to_string_lossy());
    }
    path.to_string_lossy().to_string()
}

async fn run_stdout_loop(inner: Arc<CodexAppServerInner>, stdout: ChildStdout) {
    let mut events_file = match tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&inner.events_path)
        .await
    {
        Ok(file) => file,
        Err(_) => return,
    };

    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();

    loop {
        buf.clear();
        let bytes_read = match reader.read_until(b'\n', &mut buf).await {
            Ok(n) => n,
            Err(_) => break,
        };
        if bytes_read == 0 {
            break;
        }

        let line = String::from_utf8_lossy(&buf);
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Raw recording is always best-effort; parsing can fail on stray output.
        let _ = events_file.write_all(line.as_bytes()).await;
        let _ = events_file.write_all(b"\n").await;

        let parsed: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(err) => {
                let _ = inner.events_tx.send(CodexJsonRpcEvent {
                    kind: "parse_error".to_string(),
                    message: json!({
                        "error": err.to_string(),
                        "line": line,
                    }),
                });
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
            }
            let _ = inner.events_tx.send(CodexJsonRpcEvent {
                kind: "response".to_string(),
                message: parsed,
            });
            continue;
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
            }
            let _ = inner.events_tx.send(CodexJsonRpcEvent {
                kind: "error".to_string(),
                message: parsed,
            });
            continue;
        }

        // Server-initiated request (method + id + params), e.g. approvals.
        if parsed.get("method").is_some() && parsed.get("id").is_some() {
            let _ = inner.events_tx.send(CodexJsonRpcEvent {
                kind: "request".to_string(),
                message: parsed,
            });
            continue;
        }

        // Notification (method + params, no id).
        if parsed.get("method").is_some() {
            let _ = inner.events_tx.send(CodexJsonRpcEvent {
                kind: "notification".to_string(),
                message: parsed,
            });
            continue;
        }

        let _ = inner.events_tx.send(CodexJsonRpcEvent {
            kind: "unknown".to_string(),
            message: parsed,
        });
    }

    // If stdout closes, fail any pending requests.
    let mut pending = inner.pending.lock().await;
    for (_, tx) in pending.drain() {
        let _ = tx.send(Err("codex app-server closed stdout".to_string()));
    }
}

async fn run_stderr_loop(inner: Arc<CodexAppServerInner>, stderr: ChildStderr) {
    let mut file = match tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&inner.stderr_path)
        .await
    {
        Ok(file) => file,
        Err(_) => return,
    };

    let mut reader = BufReader::new(stderr);
    let mut buf = Vec::with_capacity(8 * 1024);

    loop {
        buf.clear();
        let n = match reader.read_until(b'\n', &mut buf).await {
            Ok(n) => n,
            Err(_) => break,
        };
        if n == 0 {
            break;
        }

        let _ = file.write_all(&buf).await;
        let line = String::from_utf8_lossy(&buf);
        let line = line.trim();
        if !line.is_empty() {
            let _ = inner.events_tx.send(CodexJsonRpcEvent {
                kind: "stderr".to_string(),
                message: json!({ "line": line }),
            });
        }
    }
}

fn as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse::<i64>().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn mock_server_script() -> String {
        // A tiny JSON-RPC over stdio loop that supports:
        // - initialize (request) + initialized (notification)
        // - thread/start (request)
        // - model/list, config/read (request)
        // It also emits one notification after initialized.
        r#"
import json, sys, time

def send(obj):
    sys.stdout.write(json.dumps(obj, separators=(',', ':')) + "\n")
    sys.stdout.flush()

for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    msg = json.loads(raw)

    if 'method' in msg and 'id' in msg:
        mid = msg['method']
        rid = msg['id']
        if mid == 'initialize':
            send({'id': rid, 'result': {'ok': True}})
        elif mid == 'thread/start':
            send({'id': rid, 'result': {'thread': {'id': 'thr_test'}}})
        elif mid == 'model/list':
            send({'id': rid, 'result': {'data': [{'id': 'gpt-5'}]}})
        elif mid == 'config/read':
            send({'id': rid, 'result': {'config': {'foo': 'bar'}}})
        else:
            send({'id': rid, 'error': {'message': 'unknown method: ' + mid}})
        continue

    if msg.get('method') == 'initialized':
        send({'method': 'thread/started', 'params': {'threadId': 'thr_test'}})
        continue

    # Ignore notifications and responses from client.
"#
        .to_string()
    }

    #[tokio::test]
    async fn spawn_request_records_and_session_updates() {
        let tmp =
            std::env::temp_dir().join(format!("coco-codex-app-server-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        tokio::fs::create_dir_all(&tmp).await.unwrap();

        let agent_dir = tmp.join("agents").join("a1");
        tokio::fs::create_dir_all(&agent_dir).await.unwrap();

        let mut req = CodexAppServerSpawnRequest::new(agent_dir.clone(), tmp.clone());
        req.codex_bin = PathBuf::from("python3");
        req.codex_args = vec!["-u".to_string(), "-c".to_string(), mock_server_script()];
        req.request_timeout_secs = 5;

        let client = CodexAppServerClient::spawn(req).await.unwrap();

        let _ = client.model_list(None).await.unwrap();
        let _ = client.config_read(None).await.unwrap();
        let thread_id = client.thread_start(None).await.unwrap();
        assert_eq!(thread_id, "thr_test");

        let session_path = agent_dir.join(SESSION_FILE_NAME);
        let session_content = tokio::fs::read_to_string(&session_path).await.unwrap();
        assert!(session_content.contains("\"threadId\": \"thr_test\""));

        let requests_path = agent_dir.join(RUNTIME_DIR_NAME).join(REQUESTS_FILE_NAME);
        let requests = tokio::fs::read_to_string(&requests_path).await.unwrap();
        assert!(requests.contains("\"method\":\"initialize\""));
        assert!(requests.contains("\"method\":\"model/list\""));
        assert!(requests.contains("\"method\":\"config/read\""));
        assert!(requests.contains("\"method\":\"thread/start\""));

        let events_path = agent_dir.join(RUNTIME_DIR_NAME).join(EVENTS_FILE_NAME);
        let events = tokio::fs::read_to_string(&events_path).await.unwrap();
        assert!(events.contains("\"result\""));

        client.shutdown().await;
        let _ = fs::remove_dir_all(&tmp);
    }
}
