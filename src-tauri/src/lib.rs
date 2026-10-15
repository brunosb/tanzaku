#[tauri::command]
fn runtime_info() -> String {
    "Tanzaku Tauri experimental shell / Rust backend ativo".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![runtime_info])
        .run(tauri::generate_context!())
        .expect("error while running Tanzaku Tauri application");
}
