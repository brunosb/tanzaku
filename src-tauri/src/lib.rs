mod input;
mod midi;
mod planner;
mod storage;

fn new_playlist_id() -> String {
    let value = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("playlist-{value}")
}

#[tauri::command]
fn library_list() -> Vec<storage::LibraryEntry> {
    storage::read_library()
}

#[tauri::command]
fn library_import() -> Result<Option<storage::LibraryEntry>, String> {
    let Some(source) = rfd::FileDialog::new()
        .add_filter("MIDI", &["mid", "midi"])
        .pick_file()
    else {
        return Ok(None);
    };
    storage::import_midi(&source).map(Some)
}

#[tauri::command]
fn library_rename(id: String, title: String) -> Result<storage::LibraryEntry, String> {
    storage::rename_midi(&id, &title)
}

#[tauri::command]
fn library_delete(id: String) -> Result<Vec<storage::LibraryEntry>, String> {
    let remaining = storage::delete_midi(&id)?;
    let playlists = storage::read_playlists();
    let changed = playlists
        .iter()
        .any(|playlist| playlist.track_ids.iter().any(|track_id| track_id == &id));
    if changed {
        let next = playlists
            .into_iter()
            .map(|mut playlist| {
                playlist.track_ids.retain(|track_id| track_id != &id);
                playlist
            })
            .collect::<Vec<_>>();
        storage::write_playlists(&next)?;
    }
    Ok(remaining)
}

#[tauri::command]
fn playback_load(id: String) -> Result<planner::PlaybackPlan, String> {
    let entry = storage::read_library()
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Música não encontrada.".to_string())?;
    let file = storage::midi_path(&entry.file)?;
    let bytes = std::fs::read(file).map_err(|error| error.to_string())?;
    let notes = midi::read_notes(&bytes)?;
    let plan = planner::build_playback_plan(&notes);
    if plan.events.is_empty() {
        return Err("O MIDI não possui notas utilizáveis.".to_string());
    }
    Ok(plan)
}

#[tauri::command]
fn keyboard_arm() -> bool {
    input::arm()
}

#[tauri::command]
fn keyboard_event(event: input::KeyboardEvent) -> bool {
    input::event(event)
}

#[tauri::command]
fn keyboard_reset() {
    input::reset();
}

#[tauri::command]
fn playlist_list() -> Vec<storage::Playlist> {
    storage::read_playlists()
}

#[tauri::command]
fn playlist_create(name: String) -> Result<storage::Playlist, String> {
    let safe_name = name.trim().chars().take(100).collect::<String>();
    if safe_name.is_empty() {
        return Err("Nome de playlist inválido.".to_string());
    }
    let playlist = storage::Playlist {
        id: new_playlist_id(),
        name: safe_name,
        track_ids: Vec::new(),
        created_at: new_playlist_id(),
    };
    let mut playlists = storage::read_playlists();
    playlists.push(playlist.clone());
    storage::write_playlists(&playlists)?;
    Ok(playlist)
}

#[tauri::command]
fn playlist_rename(id: String, name: String) -> Result<storage::Playlist, String> {
    let safe_name = name.trim().chars().take(100).collect::<String>();
    if safe_name.is_empty() {
        return Err("Nome de playlist inválido.".to_string());
    }
    let mut playlists = storage::read_playlists();
    let playlist = playlists
        .iter_mut()
        .find(|playlist| playlist.id == id)
        .ok_or_else(|| "Playlist não encontrada.".to_string())?;
    playlist.name = safe_name;
    let result = playlist.clone();
    storage::write_playlists(&playlists)?;
    Ok(result)
}

#[tauri::command]
fn playlist_delete(id: String) -> Result<Vec<storage::Playlist>, String> {
    let playlists = storage::read_playlists();
    if !playlists.iter().any(|playlist| playlist.id == id) {
        return Err("Playlist não encontrada.".to_string());
    }
    let remaining = playlists
        .into_iter()
        .filter(|playlist| playlist.id != id)
        .collect::<Vec<_>>();
    storage::write_playlists(&remaining)?;
    Ok(remaining)
}

#[tauri::command]
fn playlist_add(playlist_id: String, track_id: String) -> Result<storage::Playlist, String> {
    if !storage::read_library()
        .iter()
        .any(|entry| entry.id == track_id)
    {
        return Err("Música não encontrada na biblioteca.".to_string());
    }
    let mut playlists = storage::read_playlists();
    let playlist = playlists
        .iter_mut()
        .find(|playlist| playlist.id == playlist_id)
        .ok_or_else(|| "Playlist não encontrada.".to_string())?;
    if !playlist.track_ids.contains(&track_id) {
        playlist.track_ids.push(track_id);
    }
    let result = playlist.clone();
    storage::write_playlists(&playlists)?;
    Ok(result)
}

#[tauri::command]
fn playlist_remove_track(
    playlist_id: String,
    track_id: String,
) -> Result<storage::Playlist, String> {
    let mut playlists = storage::read_playlists();
    let playlist = playlists
        .iter_mut()
        .find(|playlist| playlist.id == playlist_id)
        .ok_or_else(|| "Playlist não encontrada.".to_string())?;
    playlist.track_ids.retain(|id| id != &track_id);
    let result = playlist.clone();
    storage::write_playlists(&playlists)?;
    Ok(result)
}

#[tauri::command]
fn storage_choose_directory() -> Result<Option<String>, String> {
    let Some(root) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    storage_set_directory_path(root)
}

#[tauri::command]
fn storage_set_directory(path: String) -> Result<Option<String>, String> {
    let root = std::path::PathBuf::from(path.trim().trim_matches('"'));
    if root.as_os_str().is_empty() {
        return Ok(None);
    }
    storage_set_directory_path(root)
}

fn storage_set_directory_path(root: std::path::PathBuf) -> Result<Option<String>, String> {
    let root = if root.join("library.json").is_file() {
        root
    } else if root.file_name().is_some_and(|name| name == "midi")
        && root
            .parent()
            .is_some_and(|parent| parent.join("library.json").is_file())
    {
        root.parent().unwrap().to_path_buf()
    } else {
        root
    };
    std::fs::create_dir_all(root.join("midi")).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(root.join("plans")).map_err(|error| error.to_string())?;
    let settings = storage::read_settings();
    storage::write_settings_at(&root, settings)?;
    let default_root = dirs::data_dir()
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
        })
        .join("Tanzaku");
    storage::write_settings_at(
        &default_root,
        serde_json::json!({
            "storageRoot": root.to_string_lossy()
        }),
    )?;
    Ok(Some(root.to_string_lossy().into_owned()))
}

#[tauri::command]
fn settings_get() -> serde_json::Value {
    storage::read_settings()
}

#[tauri::command]
fn runtime_info() -> String {
    "Tanzaku Tauri experimental shell / Rust backend ativo".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            library_delete,
            library_import,
            library_list,
            library_rename,
            keyboard_arm,
            keyboard_event,
            keyboard_reset,
            playlist_add,
            playlist_create,
            playlist_delete,
            playlist_list,
            playlist_remove_track,
            playlist_rename,
            playback_load,
            runtime_info,
            settings_get,
            storage_choose_directory,
            storage_set_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tanzaku Tauri application");
}
