use super::blocking;
use crate::{
    library as storage,
    playback::{Action, PlaybackController},
    youtube,
};
use tauri::Manager;
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
    let preferences = crate::preferences::Preferences::from_value(&settings)?;

    jobs.cancel_all();
    controller.request(Action::Clear)?;

    std::fs::create_dir_all(root.join("midi")).map_err(|e| e.to_string())?;

    storage::write_settings_at(&root, settings)?;

    for pointer in storage::pointer_roots() {
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
    let background = storage::read_settings()?["backgroundPlaybackEnabled"]
        .as_bool()
        .unwrap_or(true);
    controller.request(Action::RestoreBackground(background))?;
    controller.request(Action::StartMode(preferences.start_mode))?;
    Ok(Some(root.to_string_lossy().into_owned()))
}

#[tauri::command]

pub(crate) async fn storage_choose_directory(
    app: tauri::AppHandle,
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
        switch_directory(root, &app, &controller, &jobs)
    })
    .await
}

#[tauri::command]

pub(crate) async fn storage_set_directory(
    app: tauri::AppHandle,
    path: String,
    controller: tauri::State<'_, PlaybackController>,
    jobs: tauri::State<'_, youtube::Jobs>,
) -> Result<Option<String>, String> {
    let controller = controller.inner().clone();
    let jobs = jobs.inner().clone();
    blocking(move || {
        switch_directory(
            std::path::PathBuf::from(path.trim().trim_matches('"')),
            &app,
            &controller,
            &jobs,
        )
    })
    .await
}

#[tauri::command]

pub(crate) async fn settings_get(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        let mut settings = storage::read_settings()?;
        settings["shortcutWarnings"] =
            serde_json::json!(app.state::<crate::shortcuts::Shortcuts>().warnings());
        Ok(settings)
    })
    .await
}

#[tauri::command]

pub(crate) async fn settings_update(
    app: tauri::AppHandle,
    value: serde_json::Value,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<serde_json::Value, String> {
    let controller = controller.inner().clone();
    blocking(move || {
        let shortcuts = app.state::<crate::shortcuts::Shortcuts>();
        let _operation = shortcuts.operation.lock().map_err(|e| e.to_string())?;
        let mut settings = {
            let _guard = storage::transaction()?;
            storage::read_settings()?
        };
        if let Some(next) = value.as_object() {
            for (key, value) in next {
                if key != "storageRoot" && key != "shortcutWarnings" {
                    settings[key] = value.clone();
                }
            }
        }
        let preferences = crate::preferences::Preferences::from_value(&settings)?;
        preferences.extend(&mut settings);
        shortcuts.replace(&app, &preferences.shortcuts, || {
            let _guard = storage::transaction()?;
            // Re-read so unrelated worker preferences saved in the meantime survive.
            let mut current = storage::read_settings()?;
            if let Some(next) = value.as_object() {
                for (key, value) in next {
                    if key != "storageRoot" && key != "shortcutWarnings" {
                        current[key] = value.clone();
                    }
                }
            }
            preferences.extend(&mut current);
            storage::write_settings_at(&storage::storage_root()?, current.clone())?;
            settings = current;
            Ok(())
        })?;
        controller.request(Action::StartMode(preferences.start_mode))?;
        settings["shortcutWarnings"] = serde_json::json!([]);
        Ok(settings)
    })
    .await
}

fn switch_directory(
    root: std::path::PathBuf,
    app: &tauri::AppHandle,
    controller: &PlaybackController,
    jobs: &youtube::Jobs,
) -> Result<Option<String>, String> {
    let shortcuts = app.state::<crate::shortcuts::Shortcuts>();
    let _operation = shortcuts.operation.lock().map_err(|e| e.to_string())?;
    let result = set_directory(root, controller, jobs)?;
    if result.is_some() {
        let preferences = {
            let _guard = storage::transaction()?;
            crate::preferences::Preferences::from_value(&storage::read_settings()?)?
        };
        shortcuts.restore(app, &preferences.shortcuts);
    }
    Ok(result)
}
