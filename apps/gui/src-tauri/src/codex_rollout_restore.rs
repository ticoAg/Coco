use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};

use log::warn;
use serde_json::Value;
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::codex_patch_diff;

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
        Some(other) => extract_text_value(other)
            .map(|v| vec![v])
            .unwrap_or_default(),
        None => Vec::new(),
    }
}

const ROLLOUT_PLACEHOLDER_KEY: &str = "__rollout_placeholder";

fn rollout_placeholder(kind: &str) -> Value {
    serde_json::json!({ ROLLOUT_PLACEHOLDER_KEY: kind })
}

fn rollout_placeholder_kind(item: &Value) -> Option<&str> {
    item.get(ROLLOUT_PLACEHOLDER_KEY).and_then(|v| v.as_str())
}

fn normalize_type_key(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn item_type_key(item: &Value) -> Option<String> {
    item.get("type")
        .and_then(|v| v.as_str())
        .map(normalize_type_key)
}

fn item_key(item: &Value) -> Option<String> {
    let type_key = item_type_key(item)?;
    let id = item.get("id").and_then(|v| v.as_str())?;
    Some(format!("{type_key}:{id}"))
}

fn value_is_missing(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => true,
        Some(Value::String(text)) => text.is_empty(),
        Some(Value::Array(items)) => items.is_empty(),
        _ => false,
    }
}

fn normalize_reasoning_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_reasoning_text(item: &Value) -> Option<String> {
    if item_type_key(item).as_deref() != Some("reasoning") {
        return None;
    }
    let summary = extract_text_list(item.get("summary"));
    let content = extract_text_list(item.get("content"));
    if summary.is_empty() && content.is_empty() {
        return None;
    }
    let combined = [summary, content].concat().join("\n");
    Some(normalize_reasoning_text(&combined))
}

fn is_reasoning_item(item: &Value) -> bool {
    item_type_key(item).as_deref() == Some("reasoning")
}

fn should_update_status(base_status: Option<&Value>, rollout_status: Option<&Value>) -> bool {
    let Some(rollout_status) = rollout_status.and_then(|v| v.as_str()) else {
        return false;
    };
    match base_status.and_then(|v| v.as_str()) {
        None => true,
        Some("inProgress") => true,
        Some("completed") | Some("failed") | Some("declined") => false,
        Some(_) => rollout_status != "inProgress",
    }
}

fn merge_file_change_changes(base: &Value, rollout: &Value) -> Value {
    let (Some(base_changes), Some(rollout_changes)) =
        (base.as_array().cloned(), rollout.as_array().cloned())
    else {
        return base.clone();
    };

    if base_changes.is_empty() && !rollout_changes.is_empty() {
        return Value::Array(rollout_changes);
    }

    let mut merged = base_changes;
    for change in merged.iter_mut() {
        let Some(path) = change.get("path").and_then(|v| v.as_str()) else {
            continue;
        };
        let diff_missing = value_is_missing(change.get("diff"));
        let line_numbers_missing = value_is_missing(change.get("lineNumbersAvailable"));
        if !diff_missing && !line_numbers_missing {
            continue;
        }
        if let Some(rollout_match) = rollout_changes
            .iter()
            .find(|c| c.get("path").and_then(|v| v.as_str()) == Some(path))
        {
            if let Some(obj) = change.as_object_mut() {
                if diff_missing {
                    if let Some(rollout_diff) = rollout_match.get("diff") {
                        obj.insert("diff".to_string(), rollout_diff.clone());
                    }
                }
                if line_numbers_missing {
                    if let Some(rollout_line_numbers) = rollout_match.get("lineNumbersAvailable") {
                        obj.insert(
                            "lineNumbersAvailable".to_string(),
                            rollout_line_numbers.clone(),
                        );
                    }
                }
            }
        }
    }

    Value::Array(merged)
}

fn merge_item_fields(base: &Value, rollout: &Value) -> Value {
    let (Some(base_obj), Some(rollout_obj)) = (base.as_object(), rollout.as_object()) else {
        return base.clone();
    };
    let mut merged = base_obj.clone();
    let type_key = item_type_key(base)
        .or_else(|| item_type_key(rollout))
        .unwrap_or_default();

    match type_key.as_str() {
        "commandexecution" => {
            if value_is_missing(base_obj.get("aggregatedOutput")) {
                if let Some(output) = rollout_obj.get("aggregatedOutput") {
                    merged.insert("aggregatedOutput".to_string(), output.clone());
                }
            }
            if value_is_missing(base_obj.get("exitCode")) {
                if let Some(exit_code) = rollout_obj.get("exitCode") {
                    merged.insert("exitCode".to_string(), exit_code.clone());
                }
            }
            if value_is_missing(base_obj.get("durationMs")) {
                if let Some(duration) = rollout_obj.get("durationMs") {
                    merged.insert("durationMs".to_string(), duration.clone());
                }
            }
            if should_update_status(base_obj.get("status"), rollout_obj.get("status")) {
                if let Some(status) = rollout_obj.get("status") {
                    merged.insert("status".to_string(), status.clone());
                }
            }
        }
        "mcptoolcall" => {
            if value_is_missing(base_obj.get("result")) {
                if let Some(result) = rollout_obj.get("result") {
                    merged.insert("result".to_string(), result.clone());
                }
            }
            if value_is_missing(base_obj.get("error")) {
                if let Some(error) = rollout_obj.get("error") {
                    merged.insert("error".to_string(), error.clone());
                }
            }
            if should_update_status(base_obj.get("status"), rollout_obj.get("status")) {
                if let Some(status) = rollout_obj.get("status") {
                    merged.insert("status".to_string(), status.clone());
                }
            }
        }
        "filechange" => {
            if let Some(rollout_changes) = rollout_obj.get("changes") {
                let merged_changes = merge_file_change_changes(
                    base_obj.get("changes").unwrap_or(&Value::Null),
                    rollout_changes,
                );
                if !value_is_missing(Some(&merged_changes)) {
                    merged.insert("changes".to_string(), merged_changes);
                }
            }
            if should_update_status(base_obj.get("status"), rollout_obj.get("status")) {
                if let Some(status) = rollout_obj.get("status") {
                    merged.insert("status".to_string(), status.clone());
                }
            }
        }
        _ => {}
    }

    Value::Object(merged)
}

fn dedupe_adjacent_reasoning(items: Vec<Value>) -> Vec<Value> {
    const MIN_COMPARE_LEN: usize = 8;
    let mut out: Vec<Value> = Vec::with_capacity(items.len());
    for item in items {
        if let Some(prev) = out.last() {
            if is_reasoning_item(prev) && is_reasoning_item(&item) {
                let prev_text = extract_reasoning_text(prev);
                let curr_text = extract_reasoning_text(&item);
                if let (Some(prev_text), Some(curr_text)) = (prev_text, curr_text) {
                    let prev_len = prev_text.len();
                    let curr_len = curr_text.len();
                    if prev_len >= MIN_COMPARE_LEN
                        && curr_len >= MIN_COMPARE_LEN
                        && (prev_text.contains(&curr_text) || curr_text.contains(&prev_text))
                    {
                        if prev_len >= curr_len {
                            continue;
                        }
                        out.pop();
                    }
                }
            }
        }
        out.push(item);
    }
    out
}

fn push_from_queue(
    queue: &mut VecDeque<usize>,
    base_items: &[Value],
    used: &mut [bool],
    merged: &mut Vec<Value>,
) {
    while let Some(idx) = queue.pop_front() {
        if idx < base_items.len() && !used[idx] {
            merged.push(base_items[idx].clone());
            used[idx] = true;
            break;
        }
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

fn extract_output_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.to_string(),
        Value::Object(map) => {
            if let Some(text) = map.get("content").and_then(|v| v.as_str()) {
                return text.to_string();
            }
            if let Some(text) = map.get("output").and_then(|v| v.as_str()) {
                return text.to_string();
            }
            let stdout = map.get("stdout").and_then(|v| v.as_str()).unwrap_or("");
            let stderr = map.get("stderr").and_then(|v| v.as_str()).unwrap_or("");
            if !stdout.is_empty() || !stderr.is_empty() {
                return [stdout, stderr].join("");
            }
            String::new()
        }
        _ => String::new(),
    }
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

fn extract_cwd_from_resume_response(res: &Value) -> Option<PathBuf> {
    res.get("cwd")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .or_else(|| {
            res.get("thread")
                .and_then(|t| t.get("cwd"))
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
        })
}

async fn parse_rollout_activity_by_turn(
    rollout_path: &Path,
    turn_count: usize,
    cwd: Option<&Path>,
) -> std::io::Result<Vec<Vec<Value>>> {
    let target_turn_count = turn_count.max(1);
    let mut turns: Vec<Vec<Value>> = Vec::with_capacity(target_turn_count);

    let file = File::open(rollout_path).await?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    // Turn alignment by the persisted EventMsg user_message boundaries.
    // build_turns_from_event_msgs treats each user_message as a new turn.
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
                turns.push(Vec::new());
            }
            if ev_type == "thread_rolled_back" {
                let num_turns = payload
                    .get("num_turns")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as usize;
                let new_len = turns.len().saturating_sub(num_turns);
                if new_len != turns.len() {
                    turns.truncate(new_len);
                    // Pending call ids from rolled-back turns should no longer match.
                    pending_by_call_id.retain(|_, idx| idx.turn_index < new_len);
                }
            }
            continue;
        }

        if line_type != "response_item" {
            continue;
        }

        let item_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // Only attach activity items after the first user turn is established.
        let turn_index = if turns.is_empty() {
            continue;
        } else {
            turns.len().saturating_sub(1)
        };

        match item_type {
            "reasoning" => {
                let summary = extract_text_list(payload.get("summary"));
                let content = extract_text_list(payload.get("content"));
                if summary.is_empty() && content.is_empty() {
                    continue;
                }
                if !summary.is_empty() && content.is_empty() {
                    let id = format!(
                        "rollout-reasoning-{}-{}",
                        turn_index,
                        turns[turn_index].len() + 1
                    );
                    let item = serde_json::json!({
                        "type": "reasoning",
                        "id": id,
                        "summary": summary,
                        "content": Vec::<String>::new(),
                    });
                    turns[turn_index].push(item);
                }
                turns[turn_index].push(rollout_placeholder("reasoning"));
            }
            "message" => {
                let role = payload.get("role").and_then(|v| v.as_str()).unwrap_or("");
                let placeholder = match role {
                    "assistant" => Some("agentMessage"),
                    "user" => Some("userMessage"),
                    _ => None,
                };
                if let Some(kind) = placeholder {
                    turns[turn_index].push(rollout_placeholder(kind));
                }
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
                    turns[turn_index].push(item);
                    let idx = turns[turn_index].len().saturating_sub(1);
                    pending_by_call_id.insert(
                        turns[turn_index][idx]
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
                        turns[turn_index].push(item);
                        let idx = turns[turn_index].len().saturating_sub(1);
                        pending_by_call_id.insert(
                            turns[turn_index][idx]
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
                    let mut changes: Vec<Value> = Vec::with_capacity(segments.len());
                    for seg in segments {
                        let (diff, line_numbers_available) =
                            codex_patch_diff::enrich_file_change_diff(
                                &seg.path, &seg.kind, &seg.diff, cwd,
                            )
                            .await;
                        changes.push(serde_json::json!({
                            "path": seg.path,
                            "kind": seg.kind,
                            "diff": diff,
                            "lineNumbersAvailable": line_numbers_available,
                        }));
                    }
                    let item = serde_json::json!({
                        "type": "fileChange",
                        "id": call_id,
                        "changes": changes,
                        "status": normalize_status(status),
                    });
                    turns[turn_index].push(item);
                    let idx = turns[turn_index].len().saturating_sub(1);
                    pending_by_call_id.insert(
                        turns[turn_index][idx]
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
                        format!("websearch-{}-{}", turn_index, turns[turn_index].len() + 1)
                    });

                let item = serde_json::json!({
                    "type": "webSearch",
                    "id": id,
                    "query": query,
                });
                turns[turn_index].push(item);
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
                    .map(extract_output_text)
                    .unwrap_or_default();
                let success = payload
                    .get("output")
                    .and_then(|o| o.get("success"))
                    .and_then(|v| v.as_bool());

                let Some(pending) = pending_by_call_id.get(&call_id).cloned() else {
                    continue;
                };

                match pending.kind {
                    PendingKind::Command => {
                        if let Some(item) = turns
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
                        if let Some(item) = turns
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
                if let Some(item) = turns
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

    // `thread.turns` from the app server is authoritative; rollout is append-only so it can
    // contain rolled-back turns that should not be shown. Align by taking the latest N turns.
    if turns.len() > target_turn_count {
        turns = turns.split_off(turns.len().saturating_sub(target_turn_count));
    }
    if turns.len() < target_turn_count {
        let missing = target_turn_count.saturating_sub(turns.len());
        let mut padded: Vec<Vec<Value>> = vec![Vec::new(); missing];
        padded.extend(turns);
        turns = padded;
    }

    Ok(turns)
}

fn merge_turn_items(target_items: &mut Vec<Value>, rollout_items: Vec<Value>) {
    if rollout_items.is_empty() {
        return;
    }

    let base_items = std::mem::take(target_items);
    let mut key_to_index: HashMap<String, usize> = HashMap::new();
    let mut reasoning_queue: VecDeque<usize> = VecDeque::new();
    let mut agent_queue: VecDeque<usize> = VecDeque::new();
    let mut user_queue: VecDeque<usize> = VecDeque::new();

    for (idx, item) in base_items.iter().enumerate() {
        if let Some(type_key) = item_type_key(item) {
            match type_key.as_str() {
                "reasoning" => reasoning_queue.push_back(idx),
                "agentmessage" => agent_queue.push_back(idx),
                "usermessage" => user_queue.push_back(idx),
                _ => {}
            }
        }
        if let Some(key) = item_key(item) {
            key_to_index.entry(key).or_insert(idx);
        }
    }

    let mut used = vec![false; base_items.len()];
    let mut merged: Vec<Value> = Vec::with_capacity(base_items.len() + rollout_items.len());

    for item in rollout_items {
        if let Some(kind) = rollout_placeholder_kind(&item) {
            match kind {
                "reasoning" => {
                    push_from_queue(&mut reasoning_queue, &base_items, &mut used, &mut merged)
                }
                "agentMessage" => {
                    push_from_queue(&mut agent_queue, &base_items, &mut used, &mut merged)
                }
                "userMessage" => {
                    push_from_queue(&mut user_queue, &base_items, &mut used, &mut merged)
                }
                _ => {}
            }
            continue;
        }

        if let Some(key) = item_key(&item) {
            if let Some(&idx) = key_to_index.get(&key) {
                if !used[idx] {
                    let merged_item = merge_item_fields(&base_items[idx], &item);
                    merged.push(merged_item);
                    used[idx] = true;
                    continue;
                }
            }
        }

        merged.push(item);
    }

    for (idx, item) in base_items.into_iter().enumerate() {
        if !used[idx] {
            merged.push(item);
        }
    }

    *target_items = dedupe_adjacent_reasoning(merged);
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

    let cwd = extract_cwd_from_resume_response(&res);
    let activity_by_turn =
        match parse_rollout_activity_by_turn(&rollout_path, turn_count, cwd.as_deref()).await {
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
        merge_turn_items(items, additional);
    }

    Ok(res)
}
