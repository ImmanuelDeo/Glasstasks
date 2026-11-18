use crate::models::{
    DeleteTaskRequest, NewTaskRequest, SourceAnchor, SyncStatus, TaskPatchRequest,
    UndoRecord, WriteOutcome,
};
use crate::parser::{
    compute_sha256, detect_line_ending, is_valid_calendar_date, parse_markdown_tasks,
    patch_task_raw_line,
};
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tempfile::NamedTempFile;

pub struct SyncEngine {
    /// Tracks recent self-writes (relative_path -> (file_hash, timestamp_ms)) so watcher ignores our own writes
    recent_self_writes: Mutex<HashMap<String, (String, u64)>>,
    /// Stack of recent undo records (bounded to 20)
    undo_stack: Mutex<VecDeque<UndoRecord>>,
}

impl SyncEngine {
    pub fn new() -> Self {
        Self {
            recent_self_writes: Mutex::new(HashMap::new()),
            undo_stack: Mutex::new(VecDeque::new()),
        }
    }

    pub fn is_self_write(&self, relative_path: &str, current_hash: &str) -> bool {
        let map = self.recent_self_writes.lock();
        if let Some((recorded_hash, ts)) = map.get(relative_path) {
            let now = now_ms();
            if recorded_hash == current_hash && now.saturating_sub(*ts) < 5_000 {
                return true;
            }
        }
        false
    }

    fn record_self_write(&self, relative_path: &str, new_hash: &str) {
        let mut map = self.recent_self_writes.lock();
        map.insert(relative_path.to_string(), (new_hash.to_string(), now_ms()));
    }

    pub fn latest_undo(&self) -> Option<UndoRecord> {
        self.undo_stack.lock().front().cloned()
    }

    /// Validates that `relative_path` resolves strictly inside `vault_root` and is a `.md` file.
    pub fn resolve_safe_vault_file(
        vault_root: &Path,
        relative_path: &str,
    ) -> Result<PathBuf, String> {
        let rel = Path::new(relative_path);
        if rel.is_absolute() {
            return Err("Path file harus relatif terhadap vault.".to_string());
        }
        for comp in rel.components() {
            if matches!(comp, Component::ParentDir | Component::Prefix(_) | Component::RootDir) {
                return Err("Path traversal ('..') keluar dari vault ditolak demi keamanan.".to_string());
            }
        }
        let joined = vault_root.join(rel);
        let ext = joined
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "md" {
            return Err("Hanya file Markdown (.md) yang diizinkan untuk operasi task.".to_string());
        }
        Ok(joined)
    }

    /// Locates the exact target line index (0-based) in `lines` using multi-anchor matching.
    /// Protects against external line insertions AND duplicate tasks with identical titles/lines.
    pub fn locate_task_line_index(
        lines: &[String],
        current_file_hash: &str,
        original_raw_line: &str,
        anchor: &SourceAnchor,
    ) -> Result<usize, String> {
        // Fast path: file hash is unchanged and exact line number matches
        let expected_idx = anchor.line_number.saturating_sub(1);
        if current_file_hash == anchor.file_hash {
            if let Some(line) = lines.get(expected_idx) {
                if line == original_raw_line {
                    return Ok(expected_idx);
                }
            }
        }

        // File changed externally or line shifted: find all candidate indices matching exact `original_raw_line`
        let candidates: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter_map(|(i, l)| if l == original_raw_line { Some(i) } else { None })
            .collect();

        if candidates.is_empty() {
            return Err(
                "Konflik terdeteksi: Baris task telah diubah atau dihapus oleh editor eksternal (Obsidian)."
                    .to_string(),
            );
        }

        if candidates.len() == 1 {
            return Ok(candidates[0]);
        }

        // Multiple identical task lines exist in the same file!
        // Score each candidate by context_before, context_after, and occurrence index.
        let mut best_candidates = Vec::new();
        let mut best_score = 0i32;

        for (occ_idx, &cand_line_idx) in candidates.iter().enumerate() {
            let mut score = 0i32;

            // Check context_before
            if !anchor.context_before.is_empty() {
                let before_len = anchor.context_before.len();
                if cand_line_idx >= before_len {
                    let slice = &lines[cand_line_idx - before_len..cand_line_idx];
                    if slice == anchor.context_before.as_slice() {
                        score += 10;
                    }
                }
            }

            // Check context_after
            if !anchor.context_after.is_empty() {
                let after_len = anchor.context_after.len();
                if cand_line_idx + 1 + after_len <= lines.len() {
                    let slice = &lines[cand_line_idx + 1..cand_line_idx + 1 + after_len];
                    if slice == anchor.context_after.as_slice() {
                        score += 10;
                    }
                }
            }

            // Check duplicate occurrence index match
            if occ_idx == anchor.duplicate_occurrence_index {
                score += 5;
            }

            // Proximity bonus to original line number
            let distance = (cand_line_idx as isize - expected_idx as isize).abs();
            if distance <= 5 {
                score += 2;
            }

            if score > best_score {
                best_score = score;
                best_candidates.clear();
                best_candidates.push(cand_line_idx);
            } else if score == best_score {
                best_candidates.push(cand_line_idx);
            }
        }

        if best_candidates.len() == 1 && best_score >= 5 {
            Ok(best_candidates[0])
        } else {
            Err("Konflik ambiguitas: Terdapat task duplikat identik dan konteks sekitar berubah secara bersamaan. Muat ulang diperlukan.".to_string())
        }
    }

    /// Creates a versioned backup of the file outside the Obsidian vault before writing.
    fn create_versioned_backup(
        backup_root: &Path,
        relative_path: &str,
        original_content: &str,
    ) -> Result<PathBuf, String> {
        fs::create_dir_all(backup_root)
            .map_err(|e| format!("Gagal membuat folder backup: {}", e))?;
        let safe_name = relative_path.replace(['/', '\\', ':', ' '], "_");
        let ts = now_ms();
        let backup_file = backup_root.join(format!("{}__{}.bak.md", safe_name, ts));
        fs::write(&backup_file, original_content.as_bytes())
            .map_err(|e| format!("Gagal menyimpan backup sebelum write: {}", e))?;

        // Keep at most 30 recent backups to avoid unbounded disk usage
        if let Ok(entries) = fs::read_dir(backup_root) {
            let mut files: Vec<PathBuf> = entries
                .filter_map(|e| e.ok().map(|d| d.path()))
                .filter(|p| p.is_file())
                .collect();
            files.sort();
            if files.len() > 30 {
                for old in files.iter().take(files.len() - 30) {
                    let _ = fs::remove_file(old);
                }
            }
        }

        Ok(backup_file)
    }

    /// Atomic write using temporary file in the same directory + bounded retry for Windows file locks.
    fn atomic_write_with_retry(target_path: &Path, new_content: &str) -> Result<(), String> {
        let parent_dir = target_path
            .parent()
            .ok_or_else(|| "Direktori induk file tidak valid.".to_string())?;

        let max_attempts = 3;
        let mut last_err = String::new();

        for attempt in 1..=max_attempts {
            match Self::try_atomic_write_once(parent_dir, target_path, new_content) {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_err = e;
                    if attempt < max_attempts {
                        thread::sleep(Duration::from_millis(65 * attempt as u64));
                    }
                }
            }
        }

        Err(format!(
            "Gagal menulis file setelah {} percobaan (kemungkinan file sedang dikunci proses lain): {}",
            max_attempts, last_err
        ))
    }

    fn try_atomic_write_once(
        parent_dir: &Path,
        target_path: &Path,
        new_content: &str,
    ) -> Result<(), String> {
        let mut temp_file = NamedTempFile::new_in(parent_dir)
            .map_err(|e| format!("Gagal membuat temporary file: {}", e))?;
        temp_file
            .write_all(new_content.as_bytes())
            .map_err(|e| format!("Gagal menulis ke temporary file: {}", e))?;
        temp_file
            .flush()
            .map_err(|e| format!("Gagal flush temporary file: {}", e))?;
        temp_file
            .as_file()
            .sync_all()
            .map_err(|e| format!("Gagal sync_all temporary file: {}", e))?;
        temp_file
            .persist(target_path)
            .map_err(|e| format!("Gagal mengganti file target secara atomik: {}", e.error))?;
        Ok(())
    }

    pub fn apply_task_patch(
        &self,
        vault_root: &Path,
        backup_root: &Path,
        custom_status_map: &HashMap<String, String>,
        req: &TaskPatchRequest,
    ) -> WriteOutcome {
        let start = Instant::now();
        let target_path = match Self::resolve_safe_vault_file(vault_root, &req.relative_path) {
            Ok(p) => p,
            Err(msg) => {
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::SaveFailed,
                    message: msg,
                    conflict_detected: false,
                    updated_file_tasks: Vec::new(),
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                }
            }
        };

        let current_content = match fs::read_to_string(&target_path) {
            Ok(c) => c,
            Err(e) => {
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::VaultUnavailable,
                    message: format!("Gagal membaca file sumber '{}': {}", req.relative_path, e),
                    conflict_detected: false,
                    updated_file_tasks: Vec::new(),
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                }
            }
        };

        let current_hash = compute_sha256(&current_content);
        let line_ending = detect_line_ending(&current_content);
        let has_trailing_newline = current_content.ends_with('\n');
        let mut lines: Vec<String> = current_content
            .lines()
            .map(|s| s.to_string())
            .collect();

        let target_idx = match Self::locate_task_line_index(
            &lines,
            &current_hash,
            &req.original_raw_line,
            &req.anchor,
        ) {
            Ok(idx) => idx,
            Err(conflict_msg) => {
                let latest_tasks =
                    parse_markdown_tasks(&req.relative_path, &current_content, custom_status_map);
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::Conflict,
                    message: conflict_msg,
                    conflict_detected: true,
                    updated_file_tasks: latest_tasks,
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                };
            }
        };

        let patched_line = match patch_task_raw_line(&lines[target_idx], req) {
            Ok(l) => l,
            Err(msg) => {
                let latest_tasks =
                    parse_markdown_tasks(&req.relative_path, &current_content, custom_status_map);
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::SaveFailed,
                    message: msg,
                    conflict_detected: false,
                    updated_file_tasks: latest_tasks,
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                };
            }
        };

        if let Err(backup_err) =
            Self::create_versioned_backup(backup_root, &req.relative_path, &current_content)
        {
            return WriteOutcome {
                success: false,
                sync_status: SyncStatus::SaveFailed,
                message: backup_err,
                conflict_detected: false,
                updated_file_tasks: Vec::new(),
                undo_available: self.latest_undo(),
                write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
            };
        }

        let before_line = lines[target_idx].clone();
        lines[target_idx] = patched_line.clone();

        let mut new_content = lines.join(line_ending);
        if has_trailing_newline {
            new_content.push_str(line_ending);
        }

        if let Err(write_err) = Self::atomic_write_with_retry(&target_path, &new_content) {
            let latest_tasks =
                parse_markdown_tasks(&req.relative_path, &current_content, custom_status_map);
            return WriteOutcome {
                success: false,
                sync_status: SyncStatus::SaveFailed,
                message: write_err,
                conflict_detected: false,
                updated_file_tasks: latest_tasks,
                undo_available: self.latest_undo(),
                write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
            };
        }

        let new_hash = compute_sha256(&new_content);
        self.record_self_write(&req.relative_path, &new_hash);

        let undo_rec = UndoRecord {
            id: format!("undo_{}", now_ms()),
            description: "Perubahan task".to_string(),
            relative_path: req.relative_path.clone(),
            line_number: target_idx + 1,
            before_line: Some(before_line),
            after_line: Some(patched_line),
            file_hash_after_write: new_hash,
            timestamp_ms: now_ms(),
        };
        {
            let mut stack = self.undo_stack.lock();
            stack.push_front(undo_rec.clone());
            if stack.len() > 20 {
                stack.pop_back();
            }
        }

        let updated_tasks =
            parse_markdown_tasks(&req.relative_path, &new_content, custom_status_map);

        WriteOutcome {
            success: true,
            sync_status: SyncStatus::Synced,
            message: "Tersinkron ke Obsidian".to_string(),
            conflict_detected: false,
            updated_file_tasks: updated_tasks,
            undo_available: Some(undo_rec),
            write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
        }
    }

    pub fn add_new_task(
        &self,
        vault_root: &Path,
        backup_root: &Path,
        custom_status_map: &HashMap<String, String>,
        req: &NewTaskRequest,
    ) -> WriteOutcome {
        let start = Instant::now();
        let target_path = match Self::resolve_safe_vault_file(vault_root, &req.relative_path) {
            Ok(p) => p,
            Err(msg) => {
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::SaveFailed,
                    message: msg,
                    conflict_detected: false,
                    updated_file_tasks: Vec::new(),
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                }
            }
        };

        let title = req.title.trim();
        if title.is_empty() {
            return WriteOutcome {
                success: false,
                sync_status: SyncStatus::SaveFailed,
                message: "Judul task baru tidak boleh kosong.".to_string(),
                conflict_detected: false,
                updated_file_tasks: Vec::new(),
                undo_available: self.latest_undo(),
                write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
            };
        }

        if let Some(ref d) = req.due_date {
            if !is_valid_calendar_date(d) {
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::SaveFailed,
                    message: format!("Tanggal deadline '{}' tidak valid.", d),
                    conflict_detected: false,
                    updated_file_tasks: Vec::new(),
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                };
            }
        }

        let file_exists = target_path.exists();
        if !file_exists && !req.create_file_approved {
            return WriteOutcome {
                success: false,
                sync_status: SyncStatus::SaveFailed,
                message: format!(
                    "NEEDS_CREATE_APPROVAL: File tujuan '{}' belum ada. Konfirmasi untuk membuat file baru.",
                    req.relative_path
                ),
                conflict_detected: false,
                updated_file_tasks: Vec::new(),
                undo_available: self.latest_undo(),
                write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
            };
        }

        let current_content = if file_exists {
            match fs::read_to_string(&target_path) {
                Ok(c) => c,
                Err(e) => {
                    return WriteOutcome {
                        success: false,
                        sync_status: SyncStatus::VaultUnavailable,
                        message: format!("Gagal membaca file tujuan: {}", e),
                        conflict_detected: false,
                        updated_file_tasks: Vec::new(),
                        undo_available: self.latest_undo(),
                        write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                    }
                }
            }
        } else {
            if let Some(parent) = target_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            String::new()
        };

        if file_exists {
            let _ = Self::create_versioned_backup(backup_root, &req.relative_path, &current_content);
        }

        let mut parts = vec![format!("- [ ] {}", title)];
        if let Some(ref d) = req.due_date {
            parts.push(format!("📅 {}", d));
        }
        for t in &req.tags {
            let formatted_tag = if t.starts_with('#') {
                t.clone()
            } else {
                format!("#{}", t)
            };
            if !title.contains(&formatted_tag) {
                parts.push(formatted_tag);
            }
        }
        let new_task_line = parts.join(" ");

        let line_ending = if current_content.is_empty() {
            #[cfg(target_os = "windows")]
            {
                "\r\n"
            }
            #[cfg(not(target_os = "windows"))]
            {
                "\n"
            }
        } else {
            detect_line_ending(&current_content)
        };

        let has_trailing_newline = current_content.is_empty() || current_content.ends_with('\n');
        let mut lines: Vec<String> = current_content.lines().map(|s| s.to_string()).collect();

        // Insert under target_heading if specified and found, otherwise append cleanly
        let inserted_line_num;
        if let Some(ref target_h) = req.target_heading {
            if let Some(h_idx) = lines.iter().position(|l| l.trim() == target_h.trim()) {
                let mut insert_at = h_idx + 1;
                while insert_at < lines.len() && !lines[insert_at].trim_start().starts_with('#') {
                    insert_at += 1;
                }
                // Walk back over trailing blank lines before next heading
                while insert_at > h_idx + 1 && lines[insert_at - 1].trim().is_empty() {
                    insert_at -= 1;
                }
                lines.insert(insert_at, new_task_line.clone());
                inserted_line_num = insert_at + 1;
            } else {
                lines.push(new_task_line.clone());
                inserted_line_num = lines.len();
            }
        } else {
            lines.push(new_task_line.clone());
            inserted_line_num = lines.len();
        }

        let mut new_content = lines.join(line_ending);
        if has_trailing_newline {
            new_content.push_str(line_ending);
        }

        if let Err(write_err) = Self::atomic_write_with_retry(&target_path, &new_content) {
            return WriteOutcome {
                success: false,
                sync_status: SyncStatus::SaveFailed,
                message: write_err,
                conflict_detected: false,
                updated_file_tasks: Vec::new(),
                undo_available: self.latest_undo(),
                write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
            };
        }

        let new_hash = compute_sha256(&new_content);
        self.record_self_write(&req.relative_path, &new_hash);

        let undo_rec = UndoRecord {
            id: format!("undo_{}", now_ms()),
            description: format!("Tambah task '{}'", title),
            relative_path: req.relative_path.clone(),
            line_number: inserted_line_num,
            before_line: None,
            after_line: Some(new_task_line),
            file_hash_after_write: new_hash,
            timestamp_ms: now_ms(),
        };
        self.undo_stack.lock().push_front(undo_rec.clone());

        let updated_tasks =
            parse_markdown_tasks(&req.relative_path, &new_content, custom_status_map);

        WriteOutcome {
            success: true,
            sync_status: SyncStatus::Synced,
            message: "Task baru ditambahkan ke catatan Obsidian".to_string(),
            conflict_detected: false,
            updated_file_tasks: updated_tasks,
            undo_available: Some(undo_rec),
            write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
        }
    }

    pub fn delete_task(
        &self,
        vault_root: &Path,
        backup_root: &Path,
        custom_status_map: &HashMap<String, String>,
        req: &DeleteTaskRequest,
    ) -> WriteOutcome {
        let start = Instant::now();
        let target_path = match Self::resolve_safe_vault_file(vault_root, &req.relative_path) {
            Ok(p) => p,
            Err(msg) => {
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::SaveFailed,
                    message: msg,
                    conflict_detected: false,
                    updated_file_tasks: Vec::new(),
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                }
            }
        };

        let current_content = match fs::read_to_string(&target_path) {
            Ok(c) => c,
            Err(e) => {
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::VaultUnavailable,
                    message: format!("Gagal membaca file '{}': {}", req.relative_path, e),
                    conflict_detected: false,
                    updated_file_tasks: Vec::new(),
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                }
            }
        };

        let current_hash = compute_sha256(&current_content);
        let line_ending = detect_line_ending(&current_content);
        let has_trailing_newline = current_content.ends_with('\n');
        let mut lines: Vec<String> = current_content.lines().map(|s| s.to_string()).collect();

        let target_idx = match Self::locate_task_line_index(
            &lines,
            &current_hash,
            &req.original_raw_line,
            &req.anchor,
        ) {
            Ok(idx) => idx,
            Err(conflict_msg) => {
                let latest_tasks =
                    parse_markdown_tasks(&req.relative_path, &current_content, custom_status_map);
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::Conflict,
                    message: conflict_msg,
                    conflict_detected: true,
                    updated_file_tasks: latest_tasks,
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                };
            }
        };

        let _ = Self::create_versioned_backup(backup_root, &req.relative_path, &current_content);
        let removed_line = lines.remove(target_idx);

        let mut new_content = lines.join(line_ending);
        if has_trailing_newline && !new_content.is_empty() {
            new_content.push_str(line_ending);
        }

        if let Err(write_err) = Self::atomic_write_with_retry(&target_path, &new_content) {
            return WriteOutcome {
                success: false,
                sync_status: SyncStatus::SaveFailed,
                message: write_err,
                conflict_detected: false,
                updated_file_tasks: Vec::new(),
                undo_available: self.latest_undo(),
                write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
            };
        }

        let new_hash = compute_sha256(&new_content);
        self.record_self_write(&req.relative_path, &new_hash);

        let undo_rec = UndoRecord {
            id: format!("undo_{}", now_ms()),
            description: "Hapus task".to_string(),
            relative_path: req.relative_path.clone(),
            line_number: target_idx + 1,
            before_line: Some(removed_line),
            after_line: None,
            file_hash_after_write: new_hash,
            timestamp_ms: now_ms(),
        };
        self.undo_stack.lock().push_front(undo_rec.clone());

        let updated_tasks =
            parse_markdown_tasks(&req.relative_path, &new_content, custom_status_map);

        WriteOutcome {
            success: true,
            sync_status: SyncStatus::Synced,
            message: "Task dihapus (Undo tersedia)".to_string(),
            conflict_detected: false,
            updated_file_tasks: updated_tasks,
            undo_available: Some(undo_rec),
            write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
        }
    }

    /// Reverts the most recent task mutation safely by checking if the target line was modified externally.
    pub fn undo_last_mutation(
        &self,
        vault_root: &Path,
        backup_root: &Path,
        custom_status_map: &HashMap<String, String>,
    ) -> WriteOutcome {
        let start = Instant::now();
        let rec = match self.undo_stack.lock().pop_front() {
            Some(r) => r,
            None => {
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::Synced,
                    message: "Tidak ada riwayat perubahan untuk di-undo.".to_string(),
                    conflict_detected: false,
                    updated_file_tasks: Vec::new(),
                    undo_available: None,
                    write_latency_ms: 0.0,
                }
            }
        };

        let target_path = match Self::resolve_safe_vault_file(vault_root, &rec.relative_path) {
            Ok(p) => p,
            Err(msg) => {
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::SaveFailed,
                    message: msg,
                    conflict_detected: false,
                    updated_file_tasks: Vec::new(),
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                }
            }
        };

        let current_content = match fs::read_to_string(&target_path) {
            Ok(c) => c,
            Err(e) => {
                return WriteOutcome {
                    success: false,
                    sync_status: SyncStatus::VaultUnavailable,
                    message: format!("Gagal membaca file untuk undo: {}", e),
                    conflict_detected: false,
                    updated_file_tasks: Vec::new(),
                    undo_available: self.latest_undo(),
                    write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                }
            }
        };

        let line_ending = detect_line_ending(&current_content);
        let has_trailing_newline = current_content.ends_with('\n');
        let mut lines: Vec<String> = current_content.lines().map(|s| s.to_string()).collect();

        match (&rec.before_line, &rec.after_line) {
            (Some(before), Some(after)) => {
                // Edit or toggle undo: locate `after` line
                let expected_idx = rec.line_number.saturating_sub(1);
                let found_idx = if lines.get(expected_idx).map(|l| l == after).unwrap_or(false) {
                    Some(expected_idx)
                } else {
                    lines.iter().position(|l| l == after)
                };

                match found_idx {
                    Some(idx) => {
                        lines[idx] = before.clone();
                    }
                    None => {
                        let latest_tasks = parse_markdown_tasks(
                            &rec.relative_path,
                            &current_content,
                            custom_status_map,
                        );
                        return WriteOutcome {
                            success: false,
                            sync_status: SyncStatus::Conflict,
                            message: "Undo dibatalkan: Baris tersebut sudah diubah dari luar aplikasi setelah perubahan terakhir.".to_string(),
                            conflict_detected: true,
                            updated_file_tasks: latest_tasks,
                            undo_available: self.latest_undo(),
                            write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                        };
                    }
                }
            }
            (None, Some(added_line)) => {
                // Undo task creation: remove `added_line` if untouched
                let expected_idx = rec.line_number.saturating_sub(1);
                let found_idx = if lines
                    .get(expected_idx)
                    .map(|l| l == added_line)
                    .unwrap_or(false)
                {
                    Some(expected_idx)
                } else {
                    lines.iter().rposition(|l| l == added_line)
                };

                match found_idx {
                    Some(idx) => {
                        lines.remove(idx);
                    }
                    None => {
                        let latest_tasks = parse_markdown_tasks(
                            &rec.relative_path,
                            &current_content,
                            custom_status_map,
                        );
                        return WriteOutcome {
                            success: false,
                            sync_status: SyncStatus::Conflict,
                            message: "Undo dibatalkan: Task yang baru ditambahkan sudah diedit dari luar aplikasi.".to_string(),
                            conflict_detected: true,
                            updated_file_tasks: latest_tasks,
                            undo_available: self.latest_undo(),
                            write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
                        };
                    }
                }
            }
            (Some(deleted_line), None) => {
                // Undo task deletion: re-insert `deleted_line` at `line_number`
                let insert_idx = rec.line_number.saturating_sub(1).min(lines.len());
                lines.insert(insert_idx, deleted_line.clone());
            }
            (None, None) => {}
        }

        let _ = Self::create_versioned_backup(backup_root, &rec.relative_path, &current_content);
        let mut new_content = lines.join(line_ending);
        if has_trailing_newline && !new_content.is_empty() {
            new_content.push_str(line_ending);
        }

        if let Err(write_err) = Self::atomic_write_with_retry(&target_path, &new_content) {
            return WriteOutcome {
                success: false,
                sync_status: SyncStatus::SaveFailed,
                message: write_err,
                conflict_detected: false,
                updated_file_tasks: Vec::new(),
                undo_available: self.latest_undo(),
                write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
            };
        }

        let new_hash = compute_sha256(&new_content);
        self.record_self_write(&rec.relative_path, &new_hash);

        let updated_tasks =
            parse_markdown_tasks(&rec.relative_path, &new_content, custom_status_map);

        WriteOutcome {
            success: true,
            sync_status: SyncStatus::Synced,
            message: format!("Undo berhasil: {}", rec.description),
            conflict_detected: false,
            updated_file_tasks: updated_tasks,
            undo_available: self.latest_undo(),
            write_latency_ms: start.elapsed().as_secs_f64() * 1000.0,
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
