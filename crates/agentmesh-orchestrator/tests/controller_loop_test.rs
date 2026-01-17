use agentmesh_core::task::CreateTaskRequest;
use agentmesh_core::task::TaskTopology;
use agentmesh_orchestrator::ControllerOptions;
use agentmesh_orchestrator::ControllerOutcome;
use agentmesh_orchestrator::Orchestrator;
use agentmesh_orchestrator::OrchestratorActions;
use agentmesh_orchestrator::OrchestratorSubtask;
use std::fs;
use std::path::PathBuf;

fn write_executable(path: &PathBuf, content: &str) {
    fs::write(path, content).expect("write mock executable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)
            .expect("stat mock executable")
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).expect("chmod mock executable");
    }
}

#[test]
fn controller_loop_spawns_workers_writes_stateboard_and_joined_reports() {
    let tmp = std::env::temp_dir().join(format!(
        "agentmesh-controller-loop-test-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).expect("create tmp dir");

    // A tiny "codex exec" stub that writes the final output file expected by the orchestrator.
    let mock_codex = tmp.join("mock_codex.sh");
    write_executable(
        &mock_codex,
        r#"#!/usr/bin/env bash
set -euo pipefail

out=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "--output-last-message" ]]; then
    out="${args[$((i+1))]}"
  fi
done

if [[ -z "$out" ]]; then
  echo "missing --output-last-message" >&2
  exit 2
fi

mkdir -p "$(dirname "$out")"
cat > "$out" <<'EOF'
{
  "status": "success",
  "summary": "mock success",
  "questions": [],
  "nextActions": []
}
EOF

echo '{"type":"thread.started","threadId":"thr_mock"}'
"#,
    );

    let orchestrator = Orchestrator::new(tmp.clone());
    let created = orchestrator
        .create_task(CreateTaskRequest {
            title: "controller loop test".to_string(),
            description: "".to_string(),
            topology: TaskTopology::Swarm,
            milestones: Vec::new(),
            roster: Vec::new(),
            config: None,
        })
        .expect("create task");

    let actions = OrchestratorActions {
        session_goal: "verify controller loop artifacts".to_string(),
        tasks: vec![
            OrchestratorSubtask {
                task_id: "t1".to_string(),
                agent_instance: None,
                title: "task 1".to_string(),
                agent: "worker".to_string(),
                adapter: "codex-exec".to_string(),
                prompt: "do thing 1".to_string(),
                mode: None,
                forked_from_thread_id: None,
                cwd: None,
                output_schema_path: None,
            },
            OrchestratorSubtask {
                task_id: "t2".to_string(),
                agent_instance: None,
                title: "task 2".to_string(),
                agent: "worker".to_string(),
                adapter: "codex-exec".to_string(),
                prompt: "do thing 2".to_string(),
                mode: None,
                forked_from_thread_id: None,
                cwd: None,
                output_schema_path: None,
            },
        ],
    };

    let mut opts = ControllerOptions::new(&tmp);
    opts.codex_bin = mock_codex.clone();
    opts.default_cwd = tmp.clone();

    let result = orchestrator
        .controller_run_actions(&created.id, actions, opts)
        .expect("controller run should succeed");

    assert_eq!(result.outcome, ControllerOutcome::Done);
    assert!(result.joined_summary.is_some());

    let task_dir = tmp.join(".agentmesh").join("tasks").join(&created.id);
    let state_board_path = task_dir.join("shared").join("state-board.md");
    let state_board = fs::read_to_string(&state_board_path).expect("read state-board.md");
    assert!(state_board.contains("sessionGoal: verify controller loop artifacts"));
    assert!(state_board.contains("controllerState: `done`"));
    assert!(state_board.contains("## Subtasks"));

    let joined_md = task_dir
        .join("shared")
        .join("reports")
        .join("joined-summary.md");
    assert!(joined_md.exists(), "joined-summary.md should exist");

    let evidence_index = task_dir.join("shared").join("evidence").join("index.json");
    let evidence_content = fs::read_to_string(&evidence_index).expect("read evidence index");
    let entries: Vec<serde_json::Value> =
        serde_json::from_str(&evidence_content).expect("parse evidence index json");
    assert_eq!(
        entries.len(),
        2,
        "should emit one evidence entry per worker"
    );

    let events_path = task_dir.join("events.jsonl");
    let events = fs::read_to_string(&events_path).expect("read events.jsonl");
    assert!(
        events.contains("\"type\":\"controller.state.changed\""),
        "controller state events should be appended"
    );

    let _ = fs::remove_dir_all(&tmp);
}
