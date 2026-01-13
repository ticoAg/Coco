use std::collections::HashMap;
use std::path::{Path, PathBuf};

use log::warn;
use serde_json::Value;
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, BufReader};

fn resolve_codex_home() -> PathBuf {
    if let Ok(v) = std::env::var("CODEX_HOME") {
        if !v.trim().is_empty() {
            return PathBuf::from(v);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home).join(".codex");
        }
    }
    PathBuf::from("/.codex")
}

fn normalize_status(status: &str) -> &'static str {
    match status {
        "in_progress" | "inProgress" => "inProgress",
        "completed" => "completed",
        "failed" => "failed",
        "declined" => "declined",
        _ => "completed",
    }
}

fn looks_like_mcp_tool_name(name: &str) -> bool {
    // Heuristic: MCP tools are fully qualified (server.tool).
    // Exclude common non-MCP function tools that also contain dots.
    if !name.contains('.') {
        return false;
    }
    if name.starts_with("container.") || name.starts_with("web.") || name.starts_with("browser.") {
        return false;
    }
    true
}

fn split_mcp_tool_name(name: &str) -> Option<(String, String)> {
    let mut parts = name.splitn(2, '.');
    let server = parts.next()?.trim();
    let tool = parts.next()?.trim();
    if server.is_empty() || tool.is_empty() {
        return None;
    }
    Some((server.to_string(), tool.to_string()))
}

fn parse_json_string(s: &str) -> Option<Value> {
    serde_json::from_str::<Value>(s).ok()
}

fn extract_text_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.to_string()),
        Value::Object(map) => map
            .get("text")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        _ => None,
    }
}

fn extract_text_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items.iter().filter_map(extract_text_value).collect(),
        Some(other) => extract_text_value(other).map(|v| vec![v]).unwrap_or_default(),
        None => Vec::new(),
    }
}

fn parse_exec_command_from_args(arguments: &str) -> (String, Option<String>) {
    let parsed = parse_json_string(arguments);
    let cmd = parsed
        .as_ref()
        .and_then(|v| v.get("cmd"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| arguments.to_string());
    let cwd = parsed
        .as_ref()
        .and_then(|v| v.get("workdir").or_else(|| v.get("cwd")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    (cmd, cwd)
}

#[derive(Debug, Clone)]
struct PatchFileSegment {
    path: String,
    kind: Value,
    diff: String,
}

fn parse_apply_patch_segments(patch: &str) -> Vec<PatchFileSegment> {
    let mut segments: Vec<PatchFileSegment> = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_kind: Option<Value> = None;
    let mut current_lines: Vec<String> = Vec::new();

    let flush = |segments: &mut Vec<PatchFileSegment>,
                 current_path: &mut Option<String>,
                 current_kind: &mut Option<Value>,
                 current_lines: &mut Vec<String>| {
        let Some(path) = current_path.take() else {
            current_lines.clear();
            current_kind.take();
            return;
        };
        let kind = current_kind
            .take()
            .unwrap_or_else(|| serde_json::json!({ "type": "update" }));
        let diff = current_lines.join("\n");
        segments.push(PatchFileSegment { path, kind, diff });
        current_lines.clear();
    };

    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("*** Update File: ") {
            flush(
                &mut segments,
                &mut current_path,
                &mut current_kind,
                &mut current_lines,
            );
            current_path = Some(rest.trim().to_string());
            current_kind = Some(serde_json::json!({ "type": "update", "move_path": null }));
            current_lines.push(line.to_string());
            continue;
        }
        if let Some(rest) = line.strip_prefix("*** Add File: ") {
            flush(
                &mut segments,
                &mut current_path,
                &mut current_kind,
                &mut current_lines,
            );
            current_path = Some(rest.trim().to_string());
            current_kind = Some(serde_json::json!({ "type": "add" }));
            current_lines.push(line.to_string());
            continue;
        }
        if let Some(rest) = line.strip_prefix("*** Delete File: ") {
            flush(
                &mut segments,
                &mut current_path,
                &mut current_kind,
                &mut current_lines,
            );
            current_path = Some(rest.trim().to_string());
            current_kind = Some(serde_json::json!({ "type": "delete" }));
            current_lines.push(line.to_string());
            continue;
        }
        if let Some(rest) = line.strip_prefix("*** Move to: ") {
            // Attach move target to the current update segment if present.
            if let Some(kind) = current_kind.as_mut() {
                if kind.get("type").and_then(|v| v.as_str()) == Some("update") {
                    *kind = serde_json::json!({ "type": "update", "move_path": rest.trim() });
                }
            }
            current_lines.push(line.to_string());
            continue;
        }

        if current_path.is_some() {
            current_lines.push(line.to_string());
        }
    }

    flush(
        &mut segments,
        &mut current_path,
        &mut current_kind,
        &mut current_lines,
    );
    segments
}

#[derive(Debug, Clone, Copy)]
enum PendingKind {
    Command,
    Mcp,
    ApplyPatch,
}

#[derive(Debug, Clone)]
struct PendingIndex {
    turn_index: usize,
    item_index: usize,
    kind: PendingKind,
}

fn extract_turn_count_from_resume_response(res: &Value) -> usize {
    res.get("thread")
        .and_then(|t| t.get("turns"))
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0)
}

fn extract_rollout_path_from_resume_response(res: &Value) -> Option<PathBuf> {
    res.get("thread")
        .and_then(|t| t.get("path"))
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
}

async fn parse_rollout_activity_by_turn(
    rollout_path: &Path,
    turn_count: usize,
) -> std::io::Result<Vec<Vec<Value>>> {
    let mut per_turn: Vec<Vec<Value>> = vec![Vec::new(); turn_count.max(1)];

    let file = File::open(rollout_path).await?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    // Turn alignment by the persisted EventMsg user_message boundaries.
    // build_turns_from_event_msgs treats each user_message as a new turn.
    let mut current_turn_index: isize = -1;
    let mut pending_by_call_id: HashMap<String, PendingIndex> = HashMap::new();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let payload = v.get("payload").unwrap_or(&Value::Null);

        if line_type == "event_msg" {
            let ev_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if ev_type == "user_message" {
                current_turn_index += 1;
            }
            continue;
        }

        if line_type != "response_item" {
            continue;
        }

        let item_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // Only attach activity items after the first user turn is established.
        let turn_index = if current_turn_index < 0 {
            continue;
        } else {
            usize::try_from(current_turn_index).unwrap_or(0)
        };
        let turn_index = turn_index.min(per_turn.len().saturating_sub(1));

        match item_type {
            "reasoning" => {
                let summary = extract_text_list(payload.get("summary"));
                let content = extract_text_list(payload.get("content"));
                if summary.is_empty() && content.is_empty() {
                    continue;
                }
                let id = payload
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        format!(
                            "reasoning-{}-{}",
                            turn_index,
                            per_turn[turn_index].len() + 1
                        )
                    });
                let item = serde_json::json!({
                    "type": "reasoning",
                    "id": id,
                    "summary": summary,
                    "content": content,
                });
                per_turn[turn_index].push(item);
            }
            "function_call" => {
                let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let arguments = payload
                    .get("arguments")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let call_id = payload
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if call_id.is_empty() {
                    continue;
                }

                if name == "exec_command" {
                    let (cmd, cwd) = parse_exec_command_from_args(arguments);
                    let item = serde_json::json!({
                        "type": "commandExecution",
                        "id": call_id,
                        "command": cmd,
                        "cwd": cwd.unwrap_or_else(|| "".to_string()),
                        "processId": null,
                        "status": "inProgress",
                        "commandActions": [],
                        "aggregatedOutput": null,
                        "exitCode": null,
                        "durationMs": null,
                    });
                    per_turn[turn_index].push(item);
                    let idx = per_turn[turn_index].len().saturating_sub(1);
                    pending_by_call_id.insert(
                        per_turn[turn_index][idx]
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        PendingIndex {
                            turn_index,
                            item_index: idx,
                            kind: PendingKind::Command,
                        },
                    );
                    continue;
                }

                if looks_like_mcp_tool_name(name) {
                    if let Some((server, tool)) = split_mcp_tool_name(name) {
                        let args_value = parse_json_string(arguments)
                            .unwrap_or_else(|| Value::String(arguments.to_string()));
                        let item = serde_json::json!({
                            "type": "mcpToolCall",
                            "id": call_id,
                            "server": server,
                            "tool": tool,
                            "status": "inProgress",
                            "arguments": args_value,
                            "result": null,
                            "error": null,
                            "durationMs": null,
                        });
                        per_turn[turn_index].push(item);
                        let idx = per_turn[turn_index].len().saturating_sub(1);
                        pending_by_call_id.insert(
                            per_turn[turn_index][idx]
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            PendingIndex {
                                turn_index,
                                item_index: idx,
                                kind: PendingKind::Mcp,
                            },
                        );
                    }
                }
            }
            "custom_tool_call" => {
                let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let call_id = payload
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if call_id.is_empty() {
                    continue;
                }
                if name == "apply_patch" {
                    let input = payload.get("input").and_then(|v| v.as_str()).unwrap_or("");
                    let status = payload
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("completed");
                    let segments = parse_apply_patch_segments(input);
                    let changes: Vec<Value> = segments
                        .into_iter()
                        .map(|seg| {
                            serde_json::json!({
                                "path": seg.path,
                                "kind": seg.kind,
                                "diff": seg.diff,
                            })
                        })
                        .collect();
                    let item = serde_json::json!({
                        "type": "fileChange",
                        "id": call_id,
                        "changes": changes,
                        "status": normalize_status(status),
                    });
                    per_turn[turn_index].push(item);
                    let idx = per_turn[turn_index].len().saturating_sub(1);
                    pending_by_call_id.insert(
                        per_turn[turn_index][idx]
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        PendingIndex {
                            turn_index,
                            item_index: idx,
                            kind: PendingKind::ApplyPatch,
                        },
                    );
                }
            }
            "web_search_call" | "web_search" | "web_search_call.done" => {
                // Be liberal in what we accept; rollout formats may vary.
                let query = payload
                    .get("action")
                    .and_then(|a| a.get("query"))
                    .and_then(|q| q.as_str())
                    .or_else(|| payload.get("query").and_then(|q| q.as_str()))
                    .unwrap_or("")
                    .to_string();

                if query.is_empty() {
                    continue;
                }

                let id = payload
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        format!(
                            "websearch-{}-{}",
                            turn_index,
                            per_turn[turn_index].len() + 1
                        )
                    });

                let item = serde_json::json!({
                    "type": "webSearch",
                    "id": id,
                    "query": query,
                });
                per_turn[turn_index].push(item);
            }
            "function_call_output" => {
                let call_id = payload
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if call_id.is_empty() {
                    continue;
                }
                let content = payload
                    .get("output")
                    .and_then(|o| o.get("content"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let success = payload
                    .get("output")
                    .and_then(|o| o.get("success"))
                    .and_then(|v| v.as_bool());

                let Some(pending) = pending_by_call_id.get(&call_id).cloned() else {
                    continue;
                };

                match pending.kind {
                    PendingKind::Command => {
                        if let Some(item) = per_turn
                            .get_mut(pending.turn_index)
                            .and_then(|t| t.get_mut(pending.item_index))
                        {
                            if let Some(obj) = item.as_object_mut() {
                                obj.insert("aggregatedOutput".to_string(), Value::String(content));
                                obj.insert(
                                    "status".to_string(),
                                    Value::String(if success == Some(false) {
                                        "failed".into()
                                    } else {
                                        "completed".into()
                                    }),
                                );
                            }
                        }
                    }
                    PendingKind::Mcp => {
                        if let Some(item) = per_turn
                            .get_mut(pending.turn_index)
                            .and_then(|t| t.get_mut(pending.item_index))
                        {
                            if let Some(obj) = item.as_object_mut() {
                                obj.insert(
                                    "status".to_string(),
                                    Value::String(if success == Some(false) {
                                        "failed".into()
                                    } else {
                                        "completed".into()
                                    }),
                                );
                                obj.insert(
                                    "result".to_string(),
                                    serde_json::json!({
                                        "content": [{ "type": "text", "text": content }],
                                        "structuredContent": null,
                                    }),
                                );
                            }
                        }
                    }
                    _ => {}
                }
            }
            "custom_tool_call_output" => {
                // For apply_patch and similar; we currently don't need to map output beyond status.
                let call_id = payload
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if call_id.is_empty() {
                    continue;
                }
                let output = payload.get("output").and_then(|v| v.as_str()).unwrap_or("");

                if output.is_empty() {
                    continue;
                }

                let Some(pending) = pending_by_call_id.get(&call_id).cloned() else {
                    continue;
                };
                if !matches!(pending.kind, PendingKind::ApplyPatch) {
                    continue;
                }
                // Best effort: mark failed if output contains a clear failure marker.
                let failed = output.to_lowercase().contains("error")
                    || output.to_lowercase().contains("failed");
                if let Some(item) = per_turn
                    .get_mut(pending.turn_index)
                    .and_then(|t| t.get_mut(pending.item_index))
                {
                    if let Some(obj) = item.as_object_mut() {
                        obj.insert(
                            "status".to_string(),
                            Value::String(if failed {
                                "failed".into()
                            } else {
                                "completed".into()
                            }),
                        );
                    }
                }
            }
            _ => {}
        }
    }

    Ok(per_turn)
}

fn inject_turn_items(target_items: &mut Vec<Value>, additional: Vec<Value>) {
    for item in additional {
        let item_type = item.get("type").and_then(|v| v.as_str());
        let item_id = item.get("id").and_then(|v| v.as_str());
        if item_type.is_none() || item_id.is_none() {
            continue;
        }
        let exists = target_items.iter().any(|existing| {
            existing.get("type").and_then(|v| v.as_str()) == item_type
                && existing.get("id").and_then(|v| v.as_str()) == item_id
        });
        if !exists {
            target_items.push(item);
        }
    }
}

pub async fn augment_thread_resume_response(res: Value, thread_id: &str) -> Result<Value, String> {
    let mut res = res;

    let turn_count = extract_turn_count_from_resume_response(&res);
    if turn_count == 0 {
        return Ok(res);
    }

    let rollout_path = extract_rollout_path_from_resume_response(&res);
    let rollout_path = rollout_path.or_else(|| {
        // Fallback: search by filename substring under ~/.codex/sessions (best effort).
        // This is intentionally lightweight and only used when the app-server response has no path.
        let codex_home = resolve_codex_home();
        let sessions_root = codex_home.join("sessions");
        if !sessions_root.exists() {
            return None;
        }
        let needle = thread_id;
        let mut stack = vec![sessions_root];
        while let Some(dir) = stack.pop() {
            let entries = std::fs::read_dir(&dir).ok()?;
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    if name.contains(needle) && name.ends_with(".jsonl") {
                        return Some(path);
                    }
                }
            }
        }
        None
    });

    let Some(rollout_path) = rollout_path else {
        return Ok(res);
    };

    let activity_by_turn = match parse_rollout_activity_by_turn(&rollout_path, turn_count).await {
        Ok(v) => v,
        Err(err) => {
            warn!(
                "Failed to parse Codex rollout for activity restore (thread_id={} path={}): {}",
                thread_id,
                rollout_path.display(),
                err
            );
            return Ok(res);
        }
    };

    let Some(thread) = res.get_mut("thread") else {
        return Ok(res);
    };
    let Some(turns) = thread.get_mut("turns").and_then(|v| v.as_array_mut()) else {
        return Ok(res);
    };

    for (idx, turn) in turns.iter_mut().enumerate() {
        let Some(items) = turn.get_mut("items").and_then(|v| v.as_array_mut()) else {
            continue;
        };
        let additional = activity_by_turn.get(idx).cloned().unwrap_or_default();
        inject_turn_items(items, additional);
    }

    Ok(res)
}
