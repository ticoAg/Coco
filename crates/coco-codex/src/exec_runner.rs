use serde::Deserialize;
use serde::Serialize;
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const DEFAULT_CODEX_BIN: &str = "codex";
const DEFAULT_ADAPTER_NAME: &str = "codex-exec";

const RECORDING_EVENTS_REL: &str = "./runtime/events.jsonl";
const RECORDING_STDERR_REL: &str = "./runtime/stderr.log";

const RUNTIME_DIR_NAME: &str = "runtime";
const ARTIFACTS_DIR_NAME: &str = "artifacts";
const CODEX_HOME_DIR_NAME: &str = "codex_home";

#[derive(Debug, Clone)]
pub struct CodexExecStartRequest {
    pub agent_dir: PathBuf,
    pub cwd: PathBuf,
    pub prompt: String,

    pub output_schema_path: PathBuf,

    pub codex_bin: PathBuf,
    pub codex_home: Option<PathBuf>,
}

impl CodexExecStartRequest {
    pub fn new(
        agent_dir: PathBuf,
        cwd: PathBuf,
        prompt: String,
        output_schema_path: PathBuf,
    ) -> Self {
        Self {
            agent_dir,
            cwd,
            prompt,
            output_schema_path,
            codex_bin: PathBuf::from(DEFAULT_CODEX_BIN),
            codex_home: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkerFinalStatus {
    Success,
    Blocked,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkerFinalOutput {
    pub status: WorkerFinalStatus,
    pub summary: String,
    #[serde(default)]
    pub artifacts: Option<serde_json::Value>,
    #[serde(default)]
    pub questions: Vec<String>,
    #[serde(default)]
    pub next_actions: Vec<String>,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SessionFile {
    adapter: String,
    vendor_session: VendorSession,
    recording: Recording,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct VendorSession {
    tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread_id: Option<String>,
    cwd: String,
    codex_home: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Recording {
    events: String,
    stderr: String,
}

#[derive(Debug, thiserror::Error)]
pub enum CodexExecError {
    #[error("codex binary not found on PATH")]
    CodexNotFound,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("join error: {0}")]
    Join(#[from] tokio::task::JoinError),
    #[error("worker final output is missing: {path}")]
    MissingFinalOutput { path: String },
}

pub struct CodexExecWorker {
    child: tokio::process::Child,
    stdout_task: JoinHandle<Result<(), CodexExecError>>,
    stderr_task: JoinHandle<Result<(), CodexExecError>>,
    thread_id: Arc<Mutex<Option<String>>>,
    final_output_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct CodexExecWorkerResult {
    pub thread_id: Option<String>,
    pub exit_code: Option<i32>,
    pub final_output: WorkerFinalOutput,
}

impl CodexExecWorker {
    pub async fn spawn(req: CodexExecStartRequest) -> Result<Self, CodexExecError> {
        let runtime_dir = req.agent_dir.join(RUNTIME_DIR_NAME);
        let artifacts_dir = req.agent_dir.join(ARTIFACTS_DIR_NAME);
        let events_path = runtime_dir.join("events.jsonl");
        let stderr_path = runtime_dir.join("stderr.log");
        let session_path = req.agent_dir.join("session.json");
        let final_output_path = artifacts_dir.join("final.json");

        let codex_home = req
            .codex_home
            .clone()
            .unwrap_or_else(|| req.agent_dir.join(CODEX_HOME_DIR_NAME));

        tokio::fs::create_dir_all(&runtime_dir).await?;
        tokio::fs::create_dir_all(&artifacts_dir).await?;
        tokio::fs::create_dir_all(&codex_home).await?;

        // Prevent stale final output from a previous run being mistaken as current output.
        let _ = tokio::fs::remove_file(&final_output_path).await;

        write_session_file(
            &session_path,
            SessionFile {
                adapter: DEFAULT_ADAPTER_NAME.to_string(),
                vendor_session: VendorSession {
                    tool: "codex".to_string(),
                    thread_id: None,
                    cwd: req.cwd.to_string_lossy().to_string(),
                    codex_home: path_to_portable_string(&req.agent_dir, &codex_home),
                },
                recording: Recording {
                    events: RECORDING_EVENTS_REL.to_string(),
                    stderr: RECORDING_STDERR_REL.to_string(),
                },
            },
        )
        .await?;

        let mut cmd = Command::new(&req.codex_bin);
        cmd.arg("exec")
            .arg("--json")
            .arg("-C")
            .arg(&req.cwd)
            .arg("--output-schema")
            .arg(&req.output_schema_path)
            .arg("--output-last-message")
            .arg(&final_output_path)
            .arg(&req.prompt)
            .env("CODEX_HOME", codex_home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&req.cwd);

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                append_line(&stderr_path, "codex not found on PATH").await?;
                return Err(CodexExecError::CodexNotFound);
            }
            Err(err) => return Err(CodexExecError::Io(err)),
        };

        let stdout = child
            .stdout
            .take()
            .expect("child.stdout must be piped for codex exec");
        let stderr = child
            .stderr
            .take()
            .expect("child.stderr must be piped for codex exec");

        let thread_id = Arc::new(Mutex::new(None));
        let thread_id_for_task = Arc::clone(&thread_id);

        let session_path_for_task = session_path.clone();
        let agent_dir_for_task = req.agent_dir.clone();
        let codex_home_for_task = req
            .codex_home
            .clone()
            .unwrap_or_else(|| req.agent_dir.join(CODEX_HOME_DIR_NAME));
        let cwd_for_task = req.cwd.clone();

        let stdout_task: JoinHandle<Result<(), CodexExecError>> = tokio::spawn(async move {
            let mut out = tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&events_path)
                .await?;

            let mut reader = BufReader::new(stdout).lines();
            while let Some(line) = reader.next_line().await? {
                out.write_all(line.as_bytes()).await?;
                out.write_all(b"\n").await?;

                if let Some(id) = extract_thread_id_from_event_line(&line) {
                    let mut guard = thread_id_for_task.lock().await;
                    if guard.is_none() {
                        *guard = Some(id.clone());
                        drop(guard);

                        write_session_file(
                            &session_path_for_task,
                            SessionFile {
                                adapter: DEFAULT_ADAPTER_NAME.to_string(),
                                vendor_session: VendorSession {
                                    tool: "codex".to_string(),
                                    thread_id: Some(id),
                                    cwd: cwd_for_task.to_string_lossy().to_string(),
                                    codex_home: path_to_portable_string(
                                        &agent_dir_for_task,
                                        &codex_home_for_task,
                                    ),
                                },
                                recording: Recording {
                                    events: RECORDING_EVENTS_REL.to_string(),
                                    stderr: RECORDING_STDERR_REL.to_string(),
                                },
                            },
                        )
                        .await?;
                    }
                }
            }

            Ok(())
        });

        let stderr_task: JoinHandle<Result<(), CodexExecError>> = tokio::spawn(async move {
            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&stderr_path)
                .await?;

            let mut reader = BufReader::new(stderr);
            let mut buf = Vec::with_capacity(8 * 1024);
            loop {
                buf.clear();
                let n = reader.read_until(b'\n', &mut buf).await?;
                if n == 0 {
                    break;
                }
                file.write_all(&buf).await?;
            }
            Ok(())
        });

        Ok(Self {
            child,
            stdout_task,
            stderr_task,
            thread_id,
            final_output_path,
        })
    }

    pub async fn kill(&mut self) -> Result<(), CodexExecError> {
        self.child.kill().await?;
        Ok(())
    }

    pub async fn wait(mut self) -> Result<CodexExecWorkerResult, CodexExecError> {
        let status = self.child.wait().await?;
        self.stdout_task.await??;
        self.stderr_task.await??;

        let exit_code = status.code();

        let content = match tokio::fs::read_to_string(&self.final_output_path).await {
            Ok(content) => content,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(CodexExecError::MissingFinalOutput {
                    path: self.final_output_path.to_string_lossy().to_string(),
                })
            }
            Err(err) => return Err(CodexExecError::Io(err)),
        };

        let final_output: WorkerFinalOutput = serde_json::from_str(&content)?;
        let thread_id = self.thread_id.lock().await.clone();

        Ok(CodexExecWorkerResult {
            thread_id,
            exit_code,
            final_output,
        })
    }
}

async fn write_session_file(path: &Path, session: SessionFile) -> Result<(), CodexExecError> {
    let json = serde_json::to_string_pretty(&session)?;
    tokio::fs::write(path, json).await?;
    Ok(())
}

async fn append_line(path: &Path, line: &str) -> Result<(), CodexExecError> {
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(line.as_bytes()).await?;
    file.write_all(b"\n").await?;
    Ok(())
}

fn extract_thread_id_from_event_line(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let event_type = value.get("type")?.as_str()?;
    if event_type != "thread.started" {
        return None;
    }
    value
        .get("thread_id")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_thread_id_from_thread_started_event() {
        let line = r#"{"type":"thread.started","thread_id":"thr_123"}"#;
        assert_eq!(
            extract_thread_id_from_event_line(line).as_deref(),
            Some("thr_123")
        );
    }

    #[test]
    fn extract_thread_id_ignores_other_events() {
        let line = r#"{"type":"turn.started"}"#;
        assert_eq!(extract_thread_id_from_event_line(line), None);
    }
}
