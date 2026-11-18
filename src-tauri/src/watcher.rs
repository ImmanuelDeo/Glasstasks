use crate::indexer::{normalize_rel_path, VaultIndexer};
use crate::models::{SourceScopeMode, VaultConfig};
use crate::parser::compute_sha256;
use crate::sync::SyncEngine;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub struct VaultWatcherManager {
    active_watcher: Mutex<Option<Debouncer<notify::RecommendedWatcher>>>,
}

impl VaultWatcherManager {
    pub fn new() -> Self {
        Self {
            active_watcher: Mutex::new(None),
        }
    }

    pub fn start_watching(
        &self,
        app_handle: AppHandle,
        config: VaultConfig,
        custom_status_map: HashMap<String, String>,
        indexer: Arc<VaultIndexer>,
        sync_engine: Arc<SyncEngine>,
    ) -> Result<(), String> {
        let vault_root = Path::new(&config.vault_path).to_path_buf();
        if !vault_root.exists() {
            return Err("Folder vault tidak tersedia untuk dipantau.".to_string());
        }

        let watch_root = vault_root.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(220),
            move |res: DebounceEventResult| {
                let event_start = Instant::now();
                match res {
                    Ok(events) => {
                        let mut changed_rel_paths = std::collections::HashSet::new();
                        for ev in events {
                            let path = &ev.path;
                            if let Ok(rel) = path.strip_prefix(&vault_root) {
                                let norm = normalize_rel_path(&rel.to_string_lossy());
                                if is_path_in_scope(&norm, &config) {
                                    changed_rel_paths.insert((norm, path.clone()));
                                }
                            }
                        }

                        let mut external_change_detected = false;
                        for (rel_path, full_path) in changed_rel_paths {
                            if full_path.exists() {
                                if let Ok(content) = fs::read_to_string(&full_path) {
                                    let current_hash = compute_sha256(&content);
                                    if sync_engine.is_self_write(&rel_path, &current_hash) {
                                        // Ignore self-triggered write event to prevent feedback loops
                                        continue;
                                    }
                                }
                            }
                            indexer.reindex_single_file(
                                &vault_root,
                                &rel_path,
                                &custom_status_map,
                            );
                            external_change_detected = true;
                        }

                        if external_change_detected {
                            let tasks = indexer.all_tasks_sorted_by_source();
                            let latency_ms = event_start.elapsed().as_secs_f64() * 1000.0;
                            let _ = app_handle.emit(
                                "vault-tasks-updated",
                                serde_json::json!({
                                    "tasks": tasks,
                                    "latencyMs": latency_ms
                                }),
                            );
                        }
                    }
                    Err(err) => {
                        let _ = app_handle.emit(
                            "vault-watcher-error",
                            serde_json::json!({
                                "error": format!("Watcher error: {:?}", err)
                            }),
                        );
                    }
                }
            },
        )
        .map_err(|e| format!("Gagal menginisialisasi file watcher: {}", e))?;

        debouncer
            .watcher()
            .watch(&watch_root, RecursiveMode::Recursive)
            .map_err(|e| format!("Gagal memantau direktori vault: {}", e))?;

        *self.active_watcher.lock() = Some(debouncer);
        Ok(())
    }

    pub fn stop_watching(&self) {
        *self.active_watcher.lock() = None;
    }
}

fn is_path_in_scope(rel_path: &str, config: &VaultConfig) -> bool {
    if !rel_path.to_lowercase().ends_with(".md") || rel_path.ends_with(".bak.md") {
        return false;
    }
    for segment in rel_path.split('/') {
        if segment.starts_with('.')
            || segment == "node_modules"
            || segment == "target"
            || segment == "dist"
        {
            return false;
        }
    }

    match config.scope_mode {
        SourceScopeMode::SingleFile | SourceScopeMode::MultipleFiles => config
            .selected_files
            .iter()
            .any(|s| normalize_rel_path(s) == rel_path),
        SourceScopeMode::Folder => {
            if let Some(ref folder) = config.selected_folder {
                let norm_folder = normalize_rel_path(folder);
                norm_folder.is_empty() || rel_path.starts_with(&format!("{}/", norm_folder))
            } else {
                true
            }
        }
        SourceScopeMode::WholeVault => true,
    }
}
