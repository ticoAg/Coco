use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::fs;

const MAX_FILE_BYTES: u64 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PatchKind {
    Add,
    Delete,
    Update,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PatchLineKind {
    Context,
    Add,
    Delete,
}

#[derive(Debug, Clone)]
struct PatchLine {
    kind: PatchLineKind,
    text: String,
}

#[derive(Debug, Clone)]
struct PatchHunk {
    lines: Vec<PatchLine>,
}

fn normalize_patch_kind(kind: &Value) -> PatchKind {
    if let Some(raw) = kind.as_str() {
        return match raw.to_lowercase().as_str() {
            "add" => PatchKind::Add,
            "delete" => PatchKind::Delete,
            _ => PatchKind::Update,
        };
    }
    if let Some(obj) = kind.as_object() {
        if let Some(raw_type) = obj.get("type").and_then(|v| v.as_str()) {
            return match raw_type.to_lowercase().as_str() {
                "add" => PatchKind::Add,
                "delete" => PatchKind::Delete,
                _ => PatchKind::Update,
            };
        }
    }
    PatchKind::Update
}

fn extract_move_path(kind: &Value) -> Option<String> {
    let obj = kind.as_object()?;
    obj.get("move_path")
        .or_else(|| obj.get("movePath"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn should_skip_meta(line: &str) -> bool {
    line.starts_with("*** Begin Patch")
        || line.starts_with("*** End Patch")
        || line.starts_with("*** Update File:")
        || line.starts_with("*** Add File:")
        || line.starts_with("*** Delete File:")
        || line.starts_with("*** Move to:")
        || line.starts_with("diff --git ")
        || line.starts_with("Index:")
        || line.starts_with("--- ")
        || line.starts_with("+++ ")
}

fn parse_apply_patch_hunks(diff: &str) -> Vec<PatchHunk> {
    let mut hunks: Vec<PatchHunk> = Vec::new();
    let mut current: Vec<PatchLine> = Vec::new();
    let mut in_hunk = false;

    for raw in diff.lines() {
        let line = raw.trim_end_matches('\r');
        if should_skip_meta(line) {
            continue;
        }
        if line.starts_with("@@") {
            if !current.is_empty() {
                hunks.push(PatchHunk { lines: current });
                current = Vec::new();
            }
            in_hunk = true;
            continue;
        }

        let (kind, text) = if let Some(stripped) = line.strip_prefix('+') {
            (PatchLineKind::Add, stripped)
        } else if let Some(stripped) = line.strip_prefix('-') {
            (PatchLineKind::Delete, stripped)
        } else if let Some(stripped) = line.strip_prefix(' ') {
            (PatchLineKind::Context, stripped)
        } else if in_hunk || !current.is_empty() {
            (PatchLineKind::Context, line)
        } else {
            continue;
        };

        current.push(PatchLine {
            kind,
            text: text.to_string(),
        });
    }

    if !current.is_empty() {
        hunks.push(PatchHunk { lines: current });
    }
    hunks
}

fn collect_lines_by_kind(hunks: &[PatchHunk], kind: PatchLineKind) -> Vec<String> {
    let mut out = Vec::new();
    for hunk in hunks {
        for line in &hunk.lines {
            if line.kind == kind {
                out.push(line.text.clone());
            }
        }
    }
    out
}

fn match_hunk_start(file_lines: &[String], hunk: &PatchHunk, search_start: usize) -> Option<usize> {
    let pattern: Vec<&str> = hunk
        .lines
        .iter()
        .filter(|line| line.kind != PatchLineKind::Delete)
        .map(|line| line.text.as_str())
        .collect();
    if pattern.is_empty() {
        return None;
    }
    if pattern.len() > file_lines.len() {
        return None;
    }
    let limit = file_lines.len().saturating_sub(pattern.len());
    for idx in search_start..=limit {
        let mut matches = true;
        for (offset, needle) in pattern.iter().enumerate() {
            if file_lines[idx + offset] != *needle {
                matches = false;
                break;
            }
        }
        if matches {
            return Some(idx);
        }
    }
    None
}

fn build_unified_diff_from_hunks(hunks: &[PatchHunk], file_lines: &[String]) -> Option<String> {
    if hunks.is_empty() {
        return None;
    }
    let mut out = String::new();
    let mut offset: isize = 0;
    let mut search_start = 0usize;

    for hunk in hunks {
        let start_idx = match_hunk_start(file_lines, hunk, search_start)?;
        let new_start = start_idx as isize + 1;
        let old_start = new_start + offset;
        if old_start < 1 {
            return None;
        }

        let mut old_line = old_start;
        let mut new_line = new_start;
        let mut old_count = 0isize;
        let mut new_count = 0isize;
        let mut hunk_lines: Vec<String> = Vec::new();

        for line in &hunk.lines {
            match line.kind {
                PatchLineKind::Context => {
                    hunk_lines.push(format!(" {}", line.text));
                    old_line += 1;
                    new_line += 1;
                    old_count += 1;
                    new_count += 1;
                }
                PatchLineKind::Delete => {
                    hunk_lines.push(format!("-{}", line.text));
                    old_line += 1;
                    old_count += 1;
                }
                PatchLineKind::Add => {
                    hunk_lines.push(format!("+{}", line.text));
                    new_line += 1;
                    new_count += 1;
                }
            }
        }

        if hunk_lines.is_empty() {
            return None;
        }

        out.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            old_start, old_count, new_start, new_count
        ));
        out.push_str(&hunk_lines.join("\n"));
        out.push('\n');

        offset = old_line - new_line;
        let pattern_len = hunk
            .lines
            .iter()
            .filter(|line| line.kind != PatchLineKind::Delete)
            .count();
        search_start = start_idx + pattern_len;
    }

    Some(out.trim_end_matches('\n').to_string())
}

fn build_unified_diff_for_add_delete(lines: &[String], kind: PatchKind) -> Option<String> {
    if kind != PatchKind::Add && kind != PatchKind::Delete {
        return None;
    }
    let mut out = String::new();
    let count = lines.len();
    let (old_start, old_count, new_start, new_count) = if kind == PatchKind::Add {
        (0, 0, 1, count)
    } else {
        (1, count, 0, 0)
    };

    out.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        old_start, old_count, new_start, new_count
    ));
    for (idx, line) in lines.iter().enumerate() {
        let prefix = if kind == PatchKind::Add { "+" } else { "-" };
        out.push_str(prefix);
        out.push_str(line);
        if idx + 1 < lines.len() {
            out.push('\n');
        }
    }
    Some(out)
}

async fn read_file_lines(path: &Path) -> Option<Vec<String>> {
    let meta = fs::metadata(path).await.ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let content = fs::read_to_string(path).await.ok()?;
    Some(content.lines().map(|line| line.to_string()).collect())
}

fn resolve_target_path(path: &str, cwd: Option<&Path>) -> Option<PathBuf> {
    let raw = Path::new(path);
    if raw.is_absolute() {
        return Some(raw.to_path_buf());
    }
    let base = cwd?;
    Some(base.join(raw))
}

pub async fn enrich_file_change_diff(
    path: &str,
    kind: &Value,
    diff: &str,
    cwd: Option<&Path>,
) -> (String, bool) {
    let patch_kind = normalize_patch_kind(kind);
    let hunks = parse_apply_patch_hunks(diff);

    if patch_kind == PatchKind::Add || patch_kind == PatchKind::Delete {
        let line_kind = if patch_kind == PatchKind::Add {
            PatchLineKind::Add
        } else {
            PatchLineKind::Delete
        };
        let lines = collect_lines_by_kind(&hunks, line_kind);
        if let Some(unified) = build_unified_diff_for_add_delete(&lines, patch_kind) {
            return (unified, true);
        }
        return (diff.to_string(), false);
    }

    let target_path = extract_move_path(kind).unwrap_or_else(|| path.to_string());
    let Some(full_path) = resolve_target_path(&target_path, cwd) else {
        return (diff.to_string(), false);
    };
    let Some(file_lines) = read_file_lines(&full_path).await else {
        return (diff.to_string(), false);
    };
    let Some(unified) = build_unified_diff_from_hunks(&hunks, &file_lines) else {
        return (diff.to_string(), false);
    };
    (unified, true)
}
