use super::blocking;
use crate::{
    library as storage,
    playback::{Action, PlaybackController},
    youtube,
};
pub(crate) fn set_directory(
    mut root: std::path::PathBuf,
    controller: &PlaybackController,
    jobs: &youtube::Jobs,
) -> Result<Option<String>, String> {
    let _guard = storage::transaction()?;

    if root.as_os_str().is_empty() {
        return Ok(None);
    }

    if root.file_name().is_some_and(|n| n == "midi")
        && root
            .parent()
            .is_some_and(|p| p.join("library.json").is_file())
    {
        root = root.parent().unwrap().to_owned();
    }

    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;

    let _: Vec<storage::LibraryEntry> = storage::read_json(root.join("library.json"))?;

    let _: Vec<storage::Playlist> = storage::read_json(root.join("playlists.json"))?;

    let mut settings: serde_json::Value = storage::read_json(root.join("settings.json"))?;

    if settings.is_null() {
        settings = serde_json::json!({});
    }
    if !settings.is_object() {
        return Err("Configurações inválidas.".to_string());
    }

    jobs.cancel_all();
    controller.request(Action::Clear)?;

    std::fs::create_dir_all(root.join("midi")).map_err(|e| e.to_string())?;

    storage::write_settings_at(&root, settings)?;

    for base in [dirs::data_dir(), dirs::config_dir()].into_iter().flatten() {
        let pointer = base.join("Tanzaku");
        if pointer != root {
            let mut value: serde_json::Value = storage::read_json(pointer.join("settings.json"))?;
            if value.is_null() {
                value = serde_json::json!({});
            }
            if !value.is_object() {
                return Err("Configurações inválidas.".to_string());
            }
            value["storageRoot"] = serde_json::json!(root.to_string_lossy());
            storage::save_json(&pointer.join("settings.json"), &value)?;
        }
    }

    storage::set_storage_root(root.clone());
    let enabled = storage::read_settings()?["autoAdvanceEnabled"]
        .as_bool()
        .unwrap_or(false);
    controller.request(Action::AutoAdvance(enabled))?;
    Ok(Some(root.to_string_lossy().into_owned()))
}

#[tauri::command]

pub(crate) async fn storage_choose_directory(
    controller: tauri::State<'_, PlaybackController>,
    jobs: tauri::State<'_, youtube::Jobs>,
) -> Result<Option<String>, String> {
    let controller = controller.inner().clone();
    let jobs = jobs.inner().clone();
    blocking(move || {
        let Some(root) = rfd::FileDialog::new()
            .set_title("Armazenamento do Tanzaku")
            .pick_folder()
        else {
            return Ok(None);
        };
        set_directory(root, &controller, &jobs)
    })
    .await
}

#[tauri::command]

pub(crate) async fn storage_set_directory(
    path: String,
    controller: tauri::State<'_, PlaybackController>,
    jobs: tauri::State<'_, youtube::Jobs>,
) -> Result<Option<String>, String> {
    let controller = controller.inner().clone();
    let jobs = jobs.inner().clone();
    blocking(move || {
        set_directory(
            std::path::PathBuf::from(path.trim().trim_matches('"')),
            &controller,
            &jobs,
        )
    })
    .await
}

#[tauri::command]

pub(crate) async fn settings_get() -> Result<serde_json::Value, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::read_settings()
    })
    .await
}

#[tauri::command]

pub(crate) async fn settings_update(value: serde_json::Value) -> Result<serde_json::Value, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        let mut settings = storage::read_settings()?;
        if let Some(next) = value.as_object() {
            for (key, value) in next {
                if key != "storageRoot" {
                    settings[key] = value.clone();
                }
            }
        }
        storage::write_settings_at(&storage::storage_root()?, settings.clone())?;
        Ok(settings)
    })
    .await
}
