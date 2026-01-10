//! Codex adapter implementation.
//!
//! Current MVP scope: spawn `codex exec --json` workers and persist raw runtime
//! recordings + structured final output into the Task Directory.

mod exec_runner;

pub use exec_runner::CodexExecError;
pub use exec_runner::CodexExecStartRequest;
pub use exec_runner::CodexExecWorker;
pub use exec_runner::CodexExecWorkerResult;
pub use exec_runner::WorkerFinalOutput;
pub use exec_runner::WorkerFinalStatus;
