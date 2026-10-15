mod storage;

#[tauri::command]
fn library_list() -> Vec<storage::LibraryEntry> {
    storage::read_library()
}

#[tauri::command]
fn playlist_list() -> Vec<storage::Playlist> {
    storage::read_playlists()
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
            library_list,
            playlist_list,
            runtime_info,
            settings_get
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tanzaku Tauri application");
}
