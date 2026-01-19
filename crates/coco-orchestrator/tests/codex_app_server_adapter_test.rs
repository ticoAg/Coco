use coco_codex::CodexAppServerSpawnRequest;
use coco_orchestrator::CodexAppServerAdapter;
use std::fs;
use std::path::PathBuf;

fn mock_server_script() -> String {
    r#"
import json, sys

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
        else:
            send({'id': rid, 'error': {'message': 'unknown method: ' + mid}})
        continue

    # notifications and client responses are ignored for this mock
"#
    .to_string()
}

#[tokio::test]
async fn adapter_start_sets_thread_id_and_records() {
    let tmp = std::env::temp_dir().join(format!(
        "coco-orchestrator-codex-adapter-test-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&tmp);
    tokio::fs::create_dir_all(&tmp).await.unwrap();

    let agent_dir = tmp.join("agents").join("a1");
    tokio::fs::create_dir_all(&agent_dir).await.unwrap();

    let mut spawn_req = CodexAppServerSpawnRequest::new(agent_dir.clone(), tmp.clone());
    spawn_req.codex_bin = PathBuf::from("python3");
    spawn_req.codex_args = vec!["-u".to_string(), "-c".to_string(), mock_server_script()];
    spawn_req.request_timeout_secs = 5;

    let adapter = CodexAppServerAdapter::start(spawn_req, None)
        .await
        .expect("spawn + thread/start should succeed");

    let thread_id = adapter.thread_id().await;
    assert_eq!(thread_id.as_deref(), Some("thr_test"));

    let session = tokio::fs::read_to_string(agent_dir.join("session.json"))
        .await
        .unwrap();
    assert!(session.contains("\"threadId\": \"thr_test\""));

    adapter.shutdown().await;
    let _ = fs::remove_dir_all(&tmp);
}
