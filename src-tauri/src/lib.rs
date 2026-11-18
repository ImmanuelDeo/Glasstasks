pub mod indexer;
pub mod models;
pub mod parser;
pub mod settings;
pub mod sync;
pub mod watcher;
pub mod window;

use indexer::VaultIndexer;
use models::{
    DeleteTaskRequest, NewTaskRequest, PerformanceMetrics, TaskItem, TaskPatchRequest, VaultConfig,
    WidgetSettings, WriteOutcome,
};
use parking_lot::RwLock;
use settings::{PersistedAppState, SettingsStore};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use sync::SyncEngine;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use urlencoding::encode;
use watcher::VaultWatcherManager;

pub struct AppState {
    pub startup_instant: Instant,
    pub startup_ms: RwLock<f64>,
    pub settings_store: SettingsStore,
    pub persisted: RwLock<PersistedAppState>,
    pub indexer: Arc<VaultIndexer>,
    pub sync_engine: Arc<SyncEngine>,
    pub watcher: VaultWatcherManager,
    pub last_write_ms: RwLock<f64>,
    pub last_watcher_ms: RwLock<f64>,
}

#[tauri::command]
fn get_initial_state(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let persisted = state.persisted.read().clone();
    let mut tasks = Vec::new();
    let mut vault_available = true;
    let mut error_message: Option<String> = None;

    if let Some(ref cfg) = persisted.vault_config {
        if !cfg.demo_mode {
            match state
                .indexer
                .full_index(cfg, &persisted.widget_settings.custom_status_map)
            {
                Ok(t) => tasks = t,
                Err(e) => {
                    vault_available = false;
                    error_message = Some(e);
                }
            }
        }
    }

    Ok(serde_json::json!({
        "vaultConfig": persisted.vault_config,
        "widgetSettings": persisted.widget_settings,
        "tasks": tasks,
        "vaultAvailable": vault_available,
        "errorMessage": error_message,
        "undoAvailable": state.sync_engine.latest_undo(),
    }))
}

#[tauri::command]
fn list_vault_markdown_files(vault_path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&vault_path);
    if !root.exists() || !root.is_dir() {
        return Err("Path folder vault tidak ditemukan.".to_string());
    }
    let dummy_cfg = VaultConfig {
        vault_path: vault_path.clone(),
        vault_name: root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Vault")
            .to_string(),
        scope_mode: models::SourceScopeMode::WholeVault,
        selected_files: Vec::new(),
        selected_folder: None,
        default_target_file: String::new(),
        demo_mode: false,
    };
    let files = VaultIndexer::collect_scoped_markdown_files(&dummy_cfg)?;
    Ok(files.into_iter().map(|(rel, _)| rel).collect())
}

#[tauri::command]
fn preview_vault_scope(
    config: VaultConfig,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let custom_map = state
        .persisted
        .read()
        .widget_settings
        .custom_status_map
        .clone();
    let files = VaultIndexer::collect_scoped_markdown_files(&config)?;
    let mut preview_tasks = Vec::new();
    for (rel, full) in &files {
        if let Ok(content) = std::fs::read_to_string(full) {
            let parsed = parser::parse_markdown_tasks(rel, &content, &custom_map);
            preview_tasks.extend(parsed);
        }
    }
    let target_exists = Path::new(&config.vault_path)
        .join(&config.default_target_file)
        .exists();

    Ok(serde_json::json!({
        "fileCount": files.len(),
        "taskCount": preview_tasks.len(),
        "sampleTasks": preview_tasks.into_iter().take(25).collect::<Vec<_>>(),
        "defaultTargetExists": target_exists,
    }))
}

#[tauri::command]
fn save_vault_config(
    app: AppHandle,
    config: VaultConfig,
    state: State<'_, AppState>,
) -> Result<Vec<TaskItem>, String> {
    let custom_map = {
        let mut guard = state.persisted.write();
        guard.vault_config = Some(config.clone());
        state.settings_store.save(&guard)?;
        guard.widget_settings.custom_status_map.clone()
    };

    if config.demo_mode {
        state.watcher.stop_watching();
        return Ok(Vec::new());
    }

    let tasks = state.indexer.full_index(&config, &custom_map)?;
    state.watcher.start_watching(
        app,
        config,
        custom_map,
        Arc::clone(&state.indexer),
        Arc::clone(&state.sync_engine),
    )?;
    Ok(tasks)
}

#[tauri::command]
fn refresh_vault_tasks(state: State<'_, AppState>) -> Result<Vec<TaskItem>, String> {
    let (cfg_opt, custom_map) = {
        let guard = state.persisted.read();
        (
            guard.vault_config.clone(),
            guard.widget_settings.custom_status_map.clone(),
        )
    };
    if let Some(cfg) = cfg_opt {
        if !cfg.demo_mode {
            return state.indexer.full_index(&cfg, &custom_map);
        }
    }
    Ok(Vec::new())
}

#[tauri::command]
fn reconcile_on_resume(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let (cfg_opt, custom_map) = {
        let guard = state.persisted.read();
        (
            guard.vault_config.clone(),
            guard.widget_settings.custom_status_map.clone(),
        )
    };
    if let Some(cfg) = cfg_opt {
        if !cfg.demo_mode {
            let (changed, tasks) = state.indexer.reconcile_after_resume(&cfg, &custom_map)?;
            return Ok(serde_json::json!({
                "changed": changed,
                "tasks": tasks
            }));
        }
    }
    Ok(serde_json::json!({ "changed": false, "tasks": [] }))
}

#[tauri::command]
fn patch_task(req: TaskPatchRequest, state: State<'_, AppState>) -> Result<WriteOutcome, String> {
    let (cfg, custom_map) = {
        let guard = state.persisted.read();
        let cfg = guard
            .vault_config
            .clone()
            .ok_or_else(|| "Vault belum dikonfigurasi.".to_string())?;
        (cfg, guard.widget_settings.custom_status_map.clone())
    };
    let vault_root = Path::new(&cfg.vault_path);
    let outcome = state.sync_engine.apply_task_patch(
        vault_root,
        state.settings_store.backup_dir(),
        &custom_map,
        &req,
    );
    *state.last_write_ms.write() = outcome.write_latency_ms;
    state
        .indexer
        .reindex_single_file(vault_root, &req.relative_path, &custom_map);
    let mut final_outcome = outcome;
    final_outcome.updated_file_tasks = state.indexer.all_tasks_sorted_by_source();
    Ok(final_outcome)
}

#[tauri::command]
fn create_task(req: NewTaskRequest, state: State<'_, AppState>) -> Result<WriteOutcome, String> {
    let (cfg, custom_map) = {
        let guard = state.persisted.read();
        let cfg = guard
            .vault_config
            .clone()
            .ok_or_else(|| "Vault belum dikonfigurasi.".to_string())?;
        (cfg, guard.widget_settings.custom_status_map.clone())
    };
    let vault_root = Path::new(&cfg.vault_path);
    let outcome = state.sync_engine.add_new_task(
        vault_root,
        state.settings_store.backup_dir(),
        &custom_map,
        &req,
    );
    *state.last_write_ms.write() = outcome.write_latency_ms;
    if outcome.success {
        state
            .indexer
            .reindex_single_file(vault_root, &req.relative_path, &custom_map);
    }
    let mut final_outcome = outcome;
    final_outcome.updated_file_tasks = state.indexer.all_tasks_sorted_by_source();
    Ok(final_outcome)
}

#[tauri::command]
fn delete_task(req: DeleteTaskRequest, state: State<'_, AppState>) -> Result<WriteOutcome, String> {
    let (cfg, custom_map) = {
        let guard = state.persisted.read();
        let cfg = guard
            .vault_config
            .clone()
            .ok_or_else(|| "Vault belum dikonfigurasi.".to_string())?;
        (cfg, guard.widget_settings.custom_status_map.clone())
    };
    let vault_root = Path::new(&cfg.vault_path);
    let outcome = state.sync_engine.delete_task(
        vault_root,
        state.settings_store.backup_dir(),
        &custom_map,
        &req,
    );
    *state.last_write_ms.write() = outcome.write_latency_ms;
    state
        .indexer
        .reindex_single_file(vault_root, &req.relative_path, &custom_map);
    let mut final_outcome = outcome;
    final_outcome.updated_file_tasks = state.indexer.all_tasks_sorted_by_source();
    Ok(final_outcome)
}

#[tauri::command]
fn undo_last_action(state: State<'_, AppState>) -> Result<WriteOutcome, String> {
    let (cfg, custom_map) = {
        let guard = state.persisted.read();
        let cfg = guard
            .vault_config
            .clone()
            .ok_or_else(|| "Vault belum dikonfigurasi.".to_string())?;
        (cfg, guard.widget_settings.custom_status_map.clone())
    };
    let vault_root = Path::new(&cfg.vault_path);
    let outcome = state.sync_engine.undo_last_mutation(
        vault_root,
        state.settings_store.backup_dir(),
        &custom_map,
    );
    if outcome.success {
        let _ = state.indexer.full_index(&cfg, &custom_map);
    }
    let mut final_outcome = outcome;
    final_outcome.updated_file_tasks = state.indexer.all_tasks_sorted_by_source();
    Ok(final_outcome)
}

#[tauri::command]
fn save_widget_settings(
    app: AppHandle,
    settings: WidgetSettings,
    state: State<'_, AppState>,
) -> Result<String, String> {
    {
        let mut guard = state.persisted.write();
        guard.widget_settings = settings.clone();
        state.settings_store.save(&guard)?;
    }

    // Re-register global hotkey in Rust (always succeed or log, don't fail settings save)
    if !settings.global_hotkey.trim().is_empty() {
        if let Err(e) = app.global_shortcut().unregister_all() {
            eprintln!("[GlobalHotkey] Gagal unregister all: {}", e);
        }
        if let Err(e) = app.global_shortcut().on_shortcut(
            settings.global_hotkey.as_str(),
            move |app_handle, _shortcut, event| {
                if let ShortcutState::Pressed = event.state {
                    if let Some(w) = app_handle.get_webview_window("main") {
                        if w.is_visible().unwrap_or(false) {
                            let _ = w.hide();
                        } else {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                }
            },
        ) {
            eprintln!("[GlobalHotkey] Gagal mendaftarkan hotkey '{}': {}", settings.global_hotkey, e);
        }
    }

    if let Some(win) = app.get_webview_window("main") {
        let _ = window::set_window_mode(&win, &settings.window_mode);
        let _ = win.set_ignore_cursor_events(settings.click_through);
        let dark_mode = settings.theme != "light_glass";
        let applied_effect =
            window::apply_native_glass_effect(&win, &settings.native_effect, dark_mode)?;
        return Ok(applied_effect);
    }
    Ok("saved".to_string())
}

#[tauri::command]
fn build_obsidian_uri(
    vault_name: String,
    relative_path: String,
    heading_context: Option<String>,
) -> String {
    let encoded_vault = encode(&vault_name);
    let clean_rel = relative_path.trim_end_matches(".md");
    let encoded_file = encode(clean_rel);

    // If heading context exists, Obsidian supports subpath navigation via #Heading in file parameter
    if let Some(h) = heading_context {
        let heading_text = h.trim_start_matches('#').trim();
        if !heading_text.is_empty() {
            let file_with_heading = format!("{}#{}", clean_rel, heading_text);
            return format!(
                "obsidian://open?vault={}&file={}",
                encoded_vault,
                encode(&file_with_heading)
            );
        }
    }

    format!("obsidian://open?vault={}&file={}", encoded_vault, encoded_file)
}

#[tauri::command]
fn get_performance_metrics(state: State<'_, AppState>) -> PerformanceMetrics {
    let tasks = state.indexer.all_tasks_sorted_by_source();
    let files_count = state.indexer.tasks_by_file.read().len();
    let last_index_ms = *state.indexer.last_index_ms.read();
    let last_write_ms = *state.last_write_ms.read();
    let last_watcher_ms = *state.last_watcher_ms.read();
    let startup_ms = *state.startup_ms.read();
    PerformanceMetrics {
        startup_ms,
        last_index_ms,
        indexed_files_count: files_count,
        indexed_tasks_count: tasks.len(),
        last_watcher_to_ui_ms: last_watcher_ms,
        last_write_ms,
    }
}

pub fn run() {
    let startup_instant = Instant::now();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(move |app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("glasstasks-config"));

            let settings_store = SettingsStore::new(config_dir);
            let persisted = settings_store.load();
            let indexer = Arc::new(VaultIndexer::new());
            let sync_engine = Arc::new(SyncEngine::new());
            let watcher = VaultWatcherManager::new();

            if let Some(ref cfg) = persisted.vault_config {
                if !cfg.demo_mode {
                    let _ = indexer.full_index(cfg, &persisted.widget_settings.custom_status_map);
                    let _ = watcher.start_watching(
                        app.handle().clone(),
                        cfg.clone(),
                        persisted.widget_settings.custom_status_map.clone(),
                        Arc::clone(&indexer),
                        Arc::clone(&sync_engine),
                    );
                }
            }

            if let Some(win) = app.get_webview_window("main") {
                // Apply tool window style to hide from taskbar and Alt+Tab
                let _ = window::apply_tool_window_style(&win);
                
                // Set as desktop widget (parent = Progman) so it doesn't minimize on Win+D
                let _ = window::set_desktop_widget_parent(&win);
                
                window::restore_window_bounds_safely(
                    &win,
                    &persisted.widget_settings.window_bounds,
                );
                let _ = window::set_window_mode(&win, &persisted.widget_settings.window_mode);
                let dark = persisted.widget_settings.theme != "light_glass";
                let _ = window::apply_native_glass_effect(
                    &win,
                    &persisted.widget_settings.native_effect,
                    dark,
                );
                // Register global hotkey in Rust
                if !persisted.widget_settings.global_hotkey.trim().is_empty() {
                    if let Err(e) = app.global_shortcut().on_shortcut(
                        persisted.widget_settings.global_hotkey.as_str(),
                        move |app_handle, _shortcut, event| {
                            if let ShortcutState::Pressed = event.state {
                                if let Some(w) = app_handle.get_webview_window("main") {
                                    if w.is_visible().unwrap_or(false) {
                                        let _ = w.hide();
                                    } else {
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                }
                            }
                        },
                    ) {
                        eprintln!("[GlobalHotkey] Gagal mendaftarkan hotkey: {}", e);
                    }
                }
                // Only hide on startup if startMinimized is explicitly true
                if persisted.widget_settings.start_minimized {
                    let _ = win.hide();
                } else {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }

            // Setup System Tray
            let show_hide_item =
                MenuItem::with_id(app, "toggle_visible", "Tampilkan / Sembunyikan Widget", true, None::<&str>)?;
            let settings_item =
                MenuItem::with_id(app, "open_settings", "Pengaturan Lengkap", true, None::<&str>)?;
            let aot_item =
                MenuItem::with_id(app, "toggle_aot", "Toggle Always-on-Top", true, None::<&str>)?;
            let click_through_item = MenuItem::with_id(
                app,
                "disable_click_through",
                "Matikan Click-Through (Pulihkan Interaksi)",
                true,
                None::<&str>,
            )?;
            let refresh_item =
                MenuItem::with_id(app, "refresh_vault", "Refresh Vault Sekarang", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item =
                MenuItem::with_id(app, "quit_app", "Keluar dari GlassTasks", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[
                    &show_hide_item,
                    &settings_item,
                    &sep,
                    &aot_item,
                    &click_through_item,
                    &refresh_item,
                    &sep,
                    &quit_item,
                ],
            )?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("GlassTasks — Obsidian Task Widget")
                .on_menu_event(|app_handle, event| match event.id.as_ref() {
                    "toggle_visible" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                    "open_settings" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            // Emit event to open settings modal
                            let _ = app_handle.emit("open-settings-modal", ());
                        }
                    }
                    "toggle_aot" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let state: State<'_, AppState> = app_handle.state();
                            let mut guard = state.persisted.write();
                            guard.widget_settings.always_on_top =
                                !guard.widget_settings.always_on_top;
                            guard.widget_settings.window_mode =
                                if guard.widget_settings.always_on_top {
                                    "always_on_top".to_string()
                                } else {
                                    "floating".to_string()
                                };
                            let _ = w.set_always_on_top(guard.widget_settings.always_on_top);
                            let _ = state.settings_store.save(&guard);
                            let _ = app_handle.emit("settings-updated", &guard.widget_settings);
                        }
                    }
                    "disable_click_through" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.set_ignore_cursor_events(false);
                            let state: State<'_, AppState> = app_handle.state();
                            let mut guard = state.persisted.write();
                            guard.widget_settings.click_through = false;
                            let _ = state.settings_store.save(&guard);
                            let _ = app_handle.emit("settings-updated", &guard.widget_settings);
                        }
                    }
                    "refresh_vault" => {
                        let _ = app_handle.emit("request-manual-refresh", ());
                    }
                    "quit_app" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;

            let elapsed_startup = startup_instant.elapsed().as_secs_f64() * 1000.0;
            app.manage(AppState {
                startup_instant,
                startup_ms: RwLock::new(elapsed_startup),
                settings_store,
                persisted: RwLock::new(persisted),
                indexer,
                sync_engine,
                watcher,
                last_write_ms: RwLock::new(0.0),
                last_watcher_ms: RwLock::new(0.0),
            });

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let app_handle = window.app_handle();
                let state: State<'_, AppState> = app_handle.state();
                let hide_to_tray = state.persisted.read().widget_settings.hide_to_tray_on_close;
                if hide_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            WindowEvent::Moved(pos) => {
                let app_handle = window.app_handle();
                let state: State<'_, AppState> = app_handle.state();
                let mut guard = state.persisted.write();
                guard.widget_settings.window_bounds.x = pos.x;
                guard.widget_settings.window_bounds.y = pos.y;
                let _ = state.settings_store.save(&guard);
            }
            WindowEvent::Resized(size) => {
                let app_handle = window.app_handle();
                let state: State<'_, AppState> = app_handle.state();
                let mut guard = state.persisted.write();
                guard.widget_settings.window_bounds.width = size.width;
                guard.widget_settings.window_bounds.height = size.height;
                let _ = state.settings_store.save(&guard);
            }
            WindowEvent::Focused(true) => {
                // Reconcile vault changes when widget regains focus (e.g. after sleep/resume)
                let _ = window.emit("window-focused-reconcile", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            list_vault_markdown_files,
            preview_vault_scope,
            save_vault_config,
            refresh_vault_tasks,
            reconcile_on_resume,
            patch_task,
            create_task,
            delete_task,
            undo_last_action,
            save_widget_settings,
            build_obsidian_uri,
            get_performance_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("Gagal menjalankan aplikasi Tauri GlassTasks");
}
