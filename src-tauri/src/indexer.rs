use crate::models::{SourceScopeMode, TaskItem, VaultConfig};
use crate::parser::{compute_sha256, parse_markdown_tasks};
use crate::sync::SyncEngine;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use walkdir::{DirEntry, WalkDir};

const IGNORED_DIRS: &[&str] = &[
    ".obsidian",
    ".git",
    ".trash",
    "node_modules",
    "target",
    "dist",
    ".glasstasks-backup",
    ".vscode",
    ".idea",
];

pub struct VaultIndexer {
    /// Map of relative_path -> Vec<TaskItem>
    pub tasks_by_file: RwLock<HashMap<String, Vec<TaskItem>>>,
    /// Map of relative_path -> SHA-256 hash for fast reconciliation on resume/wakeup
    pub file_hashes: RwLock<HashMap<String, String>>,
    pub last_index_ms: RwLock<f64>,
}

impl VaultIndexer {
    pub fn new() -> Self {
        Self {
            tasks_by_file: RwLock::new(HashMap::new()),
            file_hashes: RwLock::new(HashMap::new()),
            last_index_ms: RwLock::new(0.0),
        }
    }

    pub fn is_ignored_entry(entry: &DirEntry, vault_root: &Path) -> bool {
        if entry.path() == vault_root {
            return false;
        }
        let name = entry.file_name().to_string_lossy();
        if entry.file_type().is_dir() {
            if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_ref()) {
                return true;
            }
        } else if name.starts_with('.') || name.ends_with(".bak.md") {
            return true;
        }
        false
    }

    pub fn collect_scoped_markdown_files(
        config: &VaultConfig,
    ) -> Result<Vec<(String, PathBuf)>, String> {
        let vault_root = Path::new(&config.vault_path);
        if !vault_root.exists() || !vault_root.is_dir() {
            return Err(format!(
                "Folder vault '{}' tidak ditemukan atau tidak tersedia.",
                config.vault_path
            ));
        }

        let mut results = Vec::new();

        match config.scope_mode {
            SourceScopeMode::SingleFile | SourceScopeMode::MultipleFiles => {
                for rel in &config.selected_files {
                    if let Ok(full) = SyncEngine::resolve_safe_vault_file(vault_root, rel) {
                        if full.exists() && full.is_file() {
                            results.push((normalize_rel_path(rel), full));
                        }
                    }
                }
            }
            SourceScopeMode::Folder => {
                let folder_rel = config.selected_folder.as_deref().unwrap_or("");
                let scan_root = if folder_rel.is_empty() {
                    vault_root.to_path_buf()
                } else {
                    vault_root.join(folder_rel)
                };
                if scan_root.exists() && scan_root.is_dir() {
                    for entry in WalkDir::new(&scan_root)
                        .follow_links(false)
                        .into_iter()
                        .filter_entry(|e| !Self::is_ignored_entry(e, vault_root))
                        .filter_map(|e| e.ok())
                    {
                        if entry.file_type().is_file() && is_markdown_file(entry.path()) {
                            if let Ok(rel) = entry.path().strip_prefix(vault_root) {
                                results.push((
                                    normalize_rel_path(&rel.to_string_lossy()),
                                    entry.path().to_path_buf(),
                                ));
                            }
                        }
                    }
                }
            }
            SourceScopeMode::WholeVault => {
                for entry in WalkDir::new(vault_root)
                    .follow_links(false)
                    .into_iter()
                    .filter_entry(|e| !Self::is_ignored_entry(e, vault_root))
                    .filter_map(|e| e.ok())
                {
                    if entry.file_type().is_file() && is_markdown_file(entry.path()) {
                        if let Ok(rel) = entry.path().strip_prefix(vault_root) {
                            results.push((
                                normalize_rel_path(&rel.to_string_lossy()),
                                entry.path().to_path_buf(),
                            ));
                        }
                    }
                }
            }
        }

        results.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(results)
    }

    pub fn full_index(
        &self,
        config: &VaultConfig,
        custom_status_map: &HashMap<String, String>,
    ) -> Result<Vec<TaskItem>, String> {
        let start = Instant::now();
        let files = Self::collect_scoped_markdown_files(config)?;
        let mut by_file = HashMap::new();
        let mut hashes = HashMap::new();

        for (rel_path, full_path) in files {
            if let Ok(content) = fs::read_to_string(&full_path) {
                let hash = compute_sha256(&content);
                let parsed = parse_markdown_tasks(&rel_path, &content, custom_status_map);
                hashes.insert(rel_path.clone(), hash);
                by_file.insert(rel_path, parsed);
            }
        }

        *self.tasks_by_file.write() = by_file;
        *self.file_hashes.write() = hashes;
        *self.last_index_ms.write() = start.elapsed().as_secs_f64() * 1000.0;

        Ok(self.all_tasks_sorted_by_source())
    }

    /// Re-indexes a single file incrementally (when modified, created, or deleted)
    pub fn reindex_single_file(
        &self,
        vault_root: &Path,
        relative_path: &str,
        custom_status_map: &HashMap<String, String>,
    ) -> Vec<TaskItem> {
        let start = Instant::now();
        let norm_rel = normalize_rel_path(relative_path);
        let full_path = vault_root.join(&norm_rel);

        if full_path.exists() && full_path.is_file() {
            if let Ok(content) = fs::read_to_string(&full_path) {
                let hash = compute_sha256(&content);
                let parsed = parse_markdown_tasks(&norm_rel, &content, custom_status_map);
                self.file_hashes.write().insert(norm_rel.clone(), hash);
                self.tasks_by_file.write().insert(norm_rel, parsed);
            }
        } else {
            self.file_hashes.write().remove(&norm_rel);
            self.tasks_by_file.write().remove(&norm_rel);
        }

        *self.last_index_ms.write() = start.elapsed().as_secs_f64() * 1000.0;
        self.all_tasks_sorted_by_source()
    }

    /// Reconciles in-memory index with disk state after OS sleep/resume or watcher recovery.
    /// Only re-parses files whose SHA-256 content hash changed or files that were added/removed.
    pub fn reconcile_after_resume(
        &self,
        config: &VaultConfig,
        custom_status_map: &HashMap<String, String>,
    ) -> Result<(bool, Vec<TaskItem>), String> {
        let files = Self::collect_scoped_markdown_files(config)?;
        let mut any_changed = false;
        let mut seen_paths = std::collections::HashSet::new();

        for (rel_path, full_path) in files {
            seen_paths.insert(rel_path.clone());
            if let Ok(content) = fs::read_to_string(&full_path) {
                let current_hash = compute_sha256(&content);
                let needs_reparse = {
                    let hashes = self.file_hashes.read();
                    hashes.get(&rel_path) != Some(&current_hash)
                };
                if needs_reparse {
                    let parsed = parse_markdown_tasks(&rel_path, &content, custom_status_map);
                    self.file_hashes.write().insert(rel_path.clone(), current_hash);
                    self.tasks_by_file.write().insert(rel_path, parsed);
                    any_changed = true;
                }
            }
        }

        // Remove deleted files
        let existing_keys: Vec<String> = self.tasks_by_file.read().keys().cloned().collect();
        for k in existing_keys {
            if !seen_paths.contains(&k) {
                self.tasks_by_file.write().remove(&k);
                self.file_hashes.write().remove(&k);
                any_changed = true;
            }
        }

        Ok((any_changed, self.all_tasks_sorted_by_source()))
    }

    pub fn all_tasks_sorted_by_source(&self) -> Vec<TaskItem> {
        let map = self.tasks_by_file.read();
        let mut keys: Vec<&String> = map.keys().collect();
        keys.sort();
        let mut out = Vec::new();
        for k in keys {
            if let Some(list) = map.get(k) {
                out.extend(list.iter().cloned());
            }
        }
        out
    }
}

pub fn normalize_rel_path(p: &str) -> String {
    p.replace('\\', "/").trim_start_matches('/').to_string()
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}
