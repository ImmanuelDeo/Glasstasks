use crate::models::{VaultConfig, WidgetSettings};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PersistedAppState {
    pub vault_config: Option<VaultConfig>,
    pub widget_settings: WidgetSettings,
}

pub struct SettingsStore {
    pub config_file_path: PathBuf,
    pub backup_dir_path: PathBuf,
}

impl SettingsStore {
    pub fn new(app_config_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&app_config_dir);
        let backup_dir_path = app_config_dir.join("backups");
        let _ = fs::create_dir_all(&backup_dir_path);
        let config_file_path = app_config_dir.join("glasstasks-config.json");
        Self {
            config_file_path,
            backup_dir_path,
        }
    }

    pub fn load(&self) -> PersistedAppState {
        if let Ok(raw) = fs::read_to_string(&self.config_file_path) {
            match serde_json::from_str::<PersistedAppState>(&raw) {
                Ok(parsed) => return parsed,
                Err(e) => {
                    eprintln!("[SettingsStore] Gagal parse JSON konfigurasi: {}", e);
                }
            }
        }
        PersistedAppState::default()
    }

    pub fn save(&self, state: &PersistedAppState) -> Result<(), String> {
        if let Some(parent) = self.config_file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(state)
            .map_err(|e| format!("Gagal serialisasi konfigurasi: {}", e))?;
        fs::write(&self.config_file_path, json.as_bytes())
            .map_err(|e| format!("Gagal menyimpan konfigurasi: {}", e))
    }

    pub fn backup_dir(&self) -> &Path {
        &self.backup_dir_path
    }
}
