//! Codex adapter implementation (WIP).
//!
//! This crate will own:
//! - spawning `codex exec --json` workers
//! - parsing JSONL thread events
//! - emitting structured events/artifacts for AgentMesh

pub struct CodexAdapter;

impl CodexAdapter {
    pub fn new() -> Self {
        Self
    }
}
