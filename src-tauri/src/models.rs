use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckboxStatus {
    Todo,
    Done,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PriorityLevel {
    Highest, // 🔺
    High,    // ⏫
    Medium,  // 🔼
    None,
    Low,     // 🔽
    Lowest,  // ⏬
}

impl PriorityLevel {
    pub fn rank(&self) -> u8 {
        match self {
            PriorityLevel::Highest => 1,
            PriorityLevel::High => 2,
            PriorityLevel::Medium => 3,
            PriorityLevel::None => 4,
            PriorityLevel::Low => 5,
            PriorityLevel::Lowest => 6,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceAnchor {
    /// 1-based line number at last read
    pub line_number: usize,
    /// Byte offset start in file
    pub byte_start: usize,
    /// Byte offset end in file (excluding line ending)
    pub byte_end: usize,
    /// SHA-256 hash of the entire file when this task was indexed
    pub file_hash: String,
    /// Occurrence index (0-based) among identical raw lines in the same file
    pub duplicate_occurrence_index: usize,
    /// Up to 2 lines immediately preceding this line for contextual relocation
    pub context_before: Vec<String>,
    /// Up to 2 lines immediately following this line for contextual relocation
    pub context_after: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    /// Deterministic composite ID: relative_path + "::L" + line_number + "::occ" + duplicate_occurrence_index
    pub id: String,
    /// Exact unmodified source line (without trailing \r\n or \n)
    pub raw_line: String,
    /// Path relative to vault root (normalized with forward slashes for cross-module consistency)
    pub relative_path: String,
    /// Nearest preceding Markdown heading (e.g. "## Tugas Kuliah") if any
    pub heading_context: Option<String>,
    /// Detailed source position and relocation context
    pub anchor: SourceAnchor,
    /// Indentation prefix (spaces/tabs before bullet)
    pub indent: String,
    /// Nesting level (0 for root, 1+ for indented subtasks)
    pub nesting_level: usize,
    /// Bullet marker ("-", "*", "+") or numbered list marker ("1.")
    pub bullet_marker: String,
    /// Checkbox character inside [x]
    pub checkbox_char: String,
    /// Parsed status: Todo, Done, or Custom
    pub status: CheckboxStatus,
    /// Clean human-readable title (stripped of recognized date/priority emojis, preserving links & inline text)
    pub display_title: String,
    /// Due date (📅 YYYY-MM-DD)
    pub due_date: Option<String>,
    /// Whether the due date string had an invalid calendar date (e.g. 2026-02-30)
    pub has_invalid_due_date: bool,
    /// Raw invalid due date token if invalid
    pub raw_invalid_due_date: Option<String>,
    /// Scheduled date (⏳ YYYY-MM-DD)
    pub scheduled_date: Option<String>,
    /// Start date (🛫 YYYY-MM-DD)
    pub start_date: Option<String>,
    /// Done date (✅ YYYY-MM-DD)
    pub done_date: Option<String>,
    /// Created date (➕ YYYY-MM-DD)
    pub created_date: Option<String>,
    /// Priority marker (🔺, ⏫, 🔼, 🔽, ⏬)
    pub priority: PriorityLevel,
    /// Recurrence rule text if 🔁 is present (e.g. "🔁 every week")
    pub recurrence_rule: Option<String>,
    /// True if task has recurrence marker 🔁
    pub is_recurring: bool,
    /// True if task is read-only in MVP (e.g., recurring task or unrecognized custom checkbox status)
    pub is_read_only: bool,
    /// Explanation why the task is read-only, shown in UI badge/tooltip
    pub read_only_reason: Option<String>,
    /// Extracted tags (e.g. ["#kuliah", "#project/ui"])
    pub tags: Vec<String>,
    /// Extracted Markdown links and Obsidian wikilinks (preserved verbatim during edits)
    pub links: Vec<String>,
    /// Unrecognized metadata tokens (e.g. Dataview inline fields `[key:: val]`, block IDs `^abc123`) preserved verbatim
    pub unrecognized_metadata: Vec<String>,
    /// Conflict or ambiguity state if detected during write/sync
    pub conflict_info: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceScopeMode {
    SingleFile,
    MultipleFiles,
    Folder,
    WholeVault,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultConfig {
    pub vault_path: String,
    pub vault_name: String,
    pub scope_mode: SourceScopeMode,
    pub selected_files: Vec<String>,
    pub selected_folder: Option<String>,
    pub default_target_file: String,
    pub demo_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetSettings {
    pub theme: String, // "light_glass" | "dark_glass" | "system"
    pub accent_color: String,
    pub opacity: f64,
    pub blur_intensity: u8,
    pub native_effect: String, // "mica" | "acrylic" | "blur" | "fallback"
    pub density: String, // "compact" | "comfortable"
    pub reduced_motion: bool,
    pub always_on_top: bool,
    pub window_mode: String, // "floating" | "always_on_top" | "desktop_pinned"
    pub click_through: bool,
    pub hide_to_tray_on_close: bool,
    pub start_minimized: bool,
    pub autostart_enabled: bool,
    pub global_hotkey: String,
    pub show_completed_section: bool,
    pub custom_status_map: std::collections::HashMap<String, String>,
    pub window_bounds: WindowBounds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Default for WidgetSettings {
    fn default() -> Self {
        Self {
            theme: "dark_glass".to_string(),
            accent_color: "#38bdf8".to_string(),
            opacity: 0.84,
            blur_intensity: 18,
            native_effect: "acrylic".to_string(),
            density: "comfortable".to_string(),
            reduced_motion: false,
            always_on_top: false,
            window_mode: "floating".to_string(),
            click_through: false,
            hide_to_tray_on_close: true,
            start_minimized: false,
            autostart_enabled: true,
            global_hotkey: "CommandOrControl+Shift+G".to_string(),
            show_completed_section: true,
            custom_status_map: std::collections::HashMap::new(),
            window_bounds: WindowBounds {
                x: 100,
                y: 90,
                width: 410,
                height: 640,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    Synced,
    Saving,
    LoadingChanges,
    Conflict,
    SaveFailed,
    VaultUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatchRequest {
    pub task_id: String,
    pub relative_path: String,
    pub anchor: SourceAnchor,
    pub original_raw_line: String,
    pub new_status: Option<CheckboxStatus>,
    pub new_title: Option<String>,
    /// Some(Some("2026-10-20")) to set/change, Some(None) to remove due date, None to keep unchanged
    pub new_due_date: Option<Option<String>>,
    pub today_local: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTaskRequest {
    pub relative_path: String,
    pub title: String,
    pub due_date: Option<String>,
    pub tags: Vec<String>,
    pub target_heading: Option<String>,
    pub create_file_approved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskRequest {
    pub task_id: String,
    pub relative_path: String,
    pub anchor: SourceAnchor,
    pub original_raw_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoRecord {
    pub id: String,
    pub description: String,
    pub relative_path: String,
    pub line_number: usize,
    pub before_line: Option<String>,
    pub after_line: Option<String>,
    pub file_hash_after_write: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub success: bool,
    pub sync_status: SyncStatus,
    pub message: String,
    pub conflict_detected: bool,
    pub updated_file_tasks: Vec<TaskItem>,
    pub undo_available: Option<UndoRecord>,
    pub write_latency_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMetrics {
    pub startup_ms: f64,
    pub last_index_ms: f64,
    pub indexed_files_count: usize,
    pub indexed_tasks_count: usize,
    pub last_watcher_to_ui_ms: f64,
    pub last_write_ms: f64,
}
