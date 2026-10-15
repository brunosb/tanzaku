use std::{env, fs, path::PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub id: String,
    pub title: String,
    pub file: String,
    pub source_url: Option<String>,
    pub duration: Option<f64>,
    pub added_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub track_ids: Vec<String>,
    pub created_at: String,
}

pub fn storage_root() -> PathBuf {
    if let Ok(value) = env::var("TANZAKU_DATA_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }

    dirs::data_dir()
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("Tanzaku")
}

pub fn ensure_storage() -> std::io::Result<()> {
    let root = storage_root();
    fs::create_dir_all(root.join("midi"))?;
    fs::create_dir_all(root.join("plans"))?;
    Ok(())
}

pub fn read_library() -> Vec<LibraryEntry> {
    if ensure_storage().is_err() {
        return Vec::new();
    }

    let file = storage_root().join("library.json");
    let content = match fs::read_to_string(file) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

pub fn read_settings() -> serde_json::Value {
    let _ = ensure_storage();
    let file = storage_root().join("settings.json");
    let mut settings = fs::read_to_string(file)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    settings["storageRoot"] =
        serde_json::Value::String(storage_root().to_string_lossy().into_owned());
    settings
}

pub fn read_playlists() -> Vec<Playlist> {
    if ensure_storage().is_err() {
        return Vec::new();
    }

    let file = storage_root().join("playlists.json");
    let content = match fs::read_to_string(file) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}
