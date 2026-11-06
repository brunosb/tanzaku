use tauri_plugin_opener::OpenerExt;
#[tauri::command]
pub(crate) fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "Tanzaku", "version": app.package_info().version.to_string(),
        "author": "brunosb", "repositoryUrl": "https://github.com/brunosb/tanzaku", "license": "ISC",
    })
}
#[tauri::command]
pub(crate) fn app_open_project_link(app: tauri::AppHandle, target: String) -> Result<(), String> {
    let url = match target.as_str() {
        "repository" => "https://github.com/brunosb/tanzaku",
        "issues" => "https://github.com/brunosb/tanzaku/issues",
        _ => return Err("Link de projeto inválido.".into()),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}
