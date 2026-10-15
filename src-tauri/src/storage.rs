use std::{
    env, fs,
    path::{Path, PathBuf},
};

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

fn default_storage_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("Tanzaku")
}

fn pointer_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for base in [dirs::data_dir(), dirs::config_dir()].into_iter().flatten() {
        let root = base.join("Tanzaku");
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    roots
}

fn selected_root(pointer: &Path) -> Option<PathBuf> {
    fs::read_to_string(pointer.join("settings.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|settings| settings.get("storageRoot")?.as_str().map(PathBuf::from))
        .filter(|path| {
            !path.as_os_str().is_empty()
                && (path.join("library.json").is_file() || path.join("midi").is_dir())
        })
}

pub fn storage_root() -> PathBuf {
    if let Ok(value) = env::var("TANZAKU_DATA_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }

    let default = default_storage_root();
    pointer_roots()
        .iter()
        .find_map(|pointer| selected_root(pointer))
        .unwrap_or(default)
}

pub fn ensure_storage() -> std::io::Result<()> {
    let root = storage_root();
    fs::create_dir_all(root.join("midi"))?;
    fs::create_dir_all(root.join("plans"))?;
    Ok(())
}

pub fn save_json<T: Serialize>(file: &Path, value: &T) -> Result<(), String> {
    fs::create_dir_all(file.parent().unwrap_or_else(|| Path::new(".")))
        .map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(file, format!("{content}\n")).map_err(|error| error.to_string())
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(file: PathBuf) -> T {
    fs::read_to_string(file)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn read_library() -> Vec<LibraryEntry> {
    if ensure_storage().is_err() {
        return Vec::new();
    }
    read_json(storage_root().join("library.json"))
}

pub fn write_library(entries: &[LibraryEntry]) -> Result<(), String> {
    save_json(&storage_root().join("library.json"), &entries)
}

pub fn read_playlists() -> Vec<Playlist> {
    if ensure_storage().is_err() {
        return Vec::new();
    }
    read_json(storage_root().join("playlists.json"))
}

pub fn write_playlists(playlists: &[Playlist]) -> Result<(), String> {
    save_json(&storage_root().join("playlists.json"), &playlists)
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

pub fn write_settings_at(root: &Path, mut settings: serde_json::Value) -> Result<(), String> {
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    settings["storageRoot"] = serde_json::Value::String(root.to_string_lossy().into_owned());
    save_json(&root.join("settings.json"), &settings)
}

pub fn safe_file_name(value: &str) -> Result<String, String> {
    let normalized = value
        .trim()
        .chars()
        .map(|character| {
            if "<>:\"/\\|?*".contains(character) || character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect::<String>()
        .trim_end_matches('.')
        .to_string();
    if normalized.is_empty() || normalized == "." || normalized == ".." {
        return Err("Nome de arquivo inválido.".to_string());
    }
    Ok(normalized.chars().take(160).collect())
}

pub fn midi_path(file: &str) -> Result<PathBuf, String> {
    let name = Path::new(file)
        .file_name()
        .ok_or_else(|| "Arquivo MIDI inválido.".to_string())?;
    Ok(storage_root().join("midi").join(name))
}

pub fn import_midi(source: &Path) -> Result<LibraryEntry, String> {
    ensure_storage().map_err(|error| error.to_string())?;
    let title = source
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Nome do MIDI inválido.".to_string())?;
    let safe_title = safe_file_name(title)?;
    let mut file_name = format!("{safe_title}.mid");
    let mut count = 2;
    while midi_path(&file_name)?.exists() {
        file_name = format!("{safe_title} ({count}).mid");
        count += 1;
    }
    fs::copy(source, midi_path(&file_name)?).map_err(|error| error.to_string())?;
    let entry = LibraryEntry {
        id: file_name.clone(),
        title: title.trim().to_string(),
        file: file_name,
        source_url: None,
        duration: None,
        added_at: None,
    };
    let mut entries = read_library();
    entries.push(entry.clone());
    write_library(&entries)?;
    Ok(entry)
}

pub fn rename_midi(id: &str, title: &str) -> Result<LibraryEntry, String> {
    let mut entries = read_library();
    let entry = entries
        .iter_mut()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Música não encontrada na biblioteca.".to_string())?;
    let safe_title = safe_file_name(title)?;
    let new_file = format!("{safe_title}.mid");
    if new_file != entry.file && midi_path(&new_file)?.exists() {
        return Err("Já existe um MIDI com esse nome.".to_string());
    }
    let old_path = midi_path(&entry.file)?;
    let new_path = midi_path(&new_file)?;
    if old_path != new_path && old_path.exists() {
        fs::rename(old_path, new_path).map_err(|error| error.to_string())?;
    }
    entry.title = title.trim().to_string();
    entry.file = new_file.clone();
    entry.id = new_file;
    let result = entry.clone();
    write_library(&entries)?;
    Ok(result)
}

pub fn delete_midi(id: &str) -> Result<Vec<LibraryEntry>, String> {
    let entries = read_library();
    let entry = entries
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Música não encontrada na biblioteca.".to_string())?;
    let file = midi_path(&entry.file)?;
    if file.exists() {
        fs::remove_file(file).map_err(|error| error.to_string())?;
    }
    let remaining = entries
        .into_iter()
        .filter(|item| item.id != id)
        .collect::<Vec<_>>();
    write_library(&remaining)?;
    Ok(remaining)
}
