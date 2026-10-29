use super::{read_json, save_json};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
pub(super) static SELECTED_ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);
pub(crate) fn set_storage_root(root: PathBuf) {
    *SELECTED_ROOT.lock().unwrap_or_else(|e| e.into_inner()) = Some(root);
}

fn default_storage_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("Tanzaku")
}

pub(crate) fn pointer_roots() -> Vec<PathBuf> {
    // Isolated development/smoke sessions must never rewrite the user's pointer.
    if let Some(root) = env::var_os("TANZAKU_DATA_DIR").filter(|value| !value.is_empty()) {
        return vec![PathBuf::from(root)];
    }
    let mut roots = Vec::new();
    for base in [dirs::data_dir(), dirs::config_dir()].into_iter().flatten() {
        let root = base.join("Tanzaku");
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    roots
}

fn selected_root(pointer: &Path) -> Result<Option<PathBuf>, String> {
    let settings: serde_json::Value = read_json(pointer.join("settings.json"))?;
    let root = settings
        .get("storageRoot")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from);
    if let Some(root) = &root {
        if !root.is_dir() {
            return Err(format!("A pasta de armazenamento {} está indisponível. Escolha outra pasta nas configurações.",root.display()));
        }
    }
    Ok(root)
}

pub(crate) fn storage_root() -> Result<PathBuf, String> {
    if let Some(root) = SELECTED_ROOT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
    {
        return Ok(root);
    }
    if let Some(root) = env::var_os("TANZAKU_DATA_DIR").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(root));
    }
    for pointer in pointer_roots() {
        if let Some(root) = selected_root(&pointer)? {
            return Ok(root);
        }
    }
    Ok(default_storage_root())
}

pub(crate) fn ensure_storage() -> Result<(), String> {
    let root = storage_root()?;
    fs::create_dir_all(root.join("midi")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("plans")).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn read_settings() -> Result<serde_json::Value, String> {
    let mut settings: serde_json::Value = read_json(storage_root()?.join("settings.json"))?;
    if settings.is_null() {
        settings = serde_json::json!({});
    }
    if !settings.is_object() {
        return Err("Configurações inválidas.".to_string());
    }
    settings["storageRoot"] = serde_json::json!(storage_root()?.to_string_lossy());
    Ok(settings)
}

pub(crate) fn write_settings_at(
    root: &Path,
    mut settings: serde_json::Value,
) -> Result<(), String> {
    if !settings.is_object() {
        return Err("Configurações inválidas.".to_string());
    }
    settings["storageRoot"] = serde_json::json!(root.to_string_lossy());
    save_json(&root.join("settings.json"), &settings)
}

pub(crate) fn write_auto_advance(enabled: bool) -> Result<(), String> {
    let mut settings = read_settings()?;
    settings["autoAdvanceEnabled"] = serde_json::json!(enabled);
    write_settings_at(&storage_root()?, settings)
}
