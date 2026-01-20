use notify::event::{EventKind, ModifyKind};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

const THREAD_FS_EVENT: &str = "codex_thread_fs_update";
const DEBOUNCE_MS: u64 = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadWatchEvent {
    pub thread_id: String,
    pub path: String,
    pub updated_at_ms: Option<u64>,
}

#[derive(Default)]
pub struct ThreadWatchState {
    watcher: Option<RecommendedWatcher>,
    thread_id: Option<String>,
    path: Option<PathBuf>,
}

impl ThreadWatchState {
    pub fn start(
        &mut self,
        app: tauri::AppHandle,
        thread_id: String,
        path: PathBuf,
    ) -> Result<(), String> {
        if self.is_watching(&thread_id, &path) {
            return Ok(());
        }
        self.stop();

        let watch_dir = path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let watched_path = Arc::new(path);
        let watched_thread = Arc::new(thread_id);
        let last_emit = Arc::new(Mutex::new(Instant::now() - Duration::from_millis(DEBOUNCE_MS)));

        let app_handle = app.clone();
        let watched_path_for_event = Arc::clone(&watched_path);
        let watched_thread_for_event = Arc::clone(&watched_thread);
        let last_emit_for_event = Arc::clone(&last_emit);
        let mut watcher = notify::recommended_watcher(move |res| {
            let event = match res {
                Ok(event) => event,
                Err(_) => return,
            };
            if !is_relevant_event(&event.kind) {
                return;
            }
            if !event_matches_path(&event.paths, &watched_path_for_event) {
                return;
            }
            let now = Instant::now();
            let mut guard = match last_emit_for_event.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            if now.duration_since(*guard) < Duration::from_millis(DEBOUNCE_MS) {
                return;
            }
            *guard = now;

            let updated_at_ms = modified_ms(&watched_path_for_event);
            let payload = CodexThreadWatchEvent {
                thread_id: watched_thread_for_event.to_string(),
                path: watched_path_for_event.to_string_lossy().to_string(),
                updated_at_ms,
            };
            let _ = app_handle.emit(THREAD_FS_EVENT, payload);
        })
        .map_err(|e| e.to_string())?;

        watcher
            .watch(&watch_dir, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;

        self.watcher = Some(watcher);
        self.thread_id = Some((*watched_thread).to_string());
        self.path = Some((*watched_path).clone());
        Ok(())
    }

    pub fn stop(&mut self) {
        self.watcher = None;
        self.thread_id = None;
        self.path = None;
    }

    pub fn is_watching(&self, thread_id: &str, path: &Path) -> bool {
        let same_thread = self.thread_id.as_deref() == Some(thread_id);
        let same_path = self.path.as_deref() == Some(path);
        same_thread && same_path
    }
}

fn is_relevant_event(kind: &EventKind) -> bool {
    match kind {
        EventKind::Create(_) | EventKind::Remove(_) => true,
        EventKind::Modify(modify) => matches!(modify, ModifyKind::Data(_) | ModifyKind::Name(_) | ModifyKind::Any),
        _ => false,
    }
}

fn event_matches_path(paths: &[PathBuf], target: &Path) -> bool {
    paths.iter().any(|path| path == target)
        || paths.iter().any(|path| path.file_name() == target.file_name())
}

fn to_epoch_ms(ts: std::time::SystemTime) -> Option<u64> {
    ts.duration_since(std::time::SystemTime::UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
}

fn modified_ms(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(to_epoch_ms)
}
