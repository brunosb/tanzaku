use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
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

static SELECTED_ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);
pub fn set_storage_root(root: PathBuf) {
    *SELECTED_ROOT.lock().unwrap_or_else(|e| e.into_inner()) = Some(root);
}
static STORAGE_LOCK: Mutex<()> = Mutex::new(());
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
pub fn transaction() -> Result<MutexGuard<'static, ()>, String> {
    STORAGE_LOCK
        .lock()
        .map_err(|_| "Armazenamento indisponível.".to_string())
}
pub fn new_id(prefix: &str) -> String {
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{prefix}-{time}-{}-{}",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
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
pub fn storage_root() -> Result<PathBuf, String> {
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

pub fn ensure_storage() -> Result<(), String> {
    let root = storage_root()?;
    fs::create_dir_all(root.join("midi")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("plans")).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_json<T: Serialize + ?Sized>(file: &Path, value: &T) -> Result<(), String> {
    let parent = file.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if file.exists() {
        let _: serde_json::Value = read_json(file.to_owned())?;
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut temp, value).map_err(|e| e.to_string())?;
    temp.write_all(b"\n").map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(file)
        .map_err(|e| format!("Não foi possível salvar {}: {e}", file.display()))?;
    Ok(())
}
pub fn read_json<T: for<'de> Deserialize<'de> + Default>(file: PathBuf) -> Result<T, String> {
    match fs::read(&file) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
            format!(
                "JSON inválido em {}: {e}. O arquivo foi preservado.",
                file.display()
            )
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(format!("Não foi possível ler {}: {e}", file.display())),
    }
}
pub fn read_library() -> Result<Vec<LibraryEntry>, String> {
    read_json(storage_root()?.join("library.json"))
}
pub fn write_library(entries: &[LibraryEntry]) -> Result<(), String> {
    save_json(&storage_root()?.join("library.json"), entries)
}
pub fn read_playlists() -> Result<Vec<Playlist>, String> {
    read_json(storage_root()?.join("playlists.json"))
}
pub fn write_playlists(playlists: &[Playlist]) -> Result<(), String> {
    save_json(&storage_root()?.join("playlists.json"), playlists)
}
pub fn read_settings() -> Result<serde_json::Value, String> {
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
pub fn write_settings_at(root: &Path, mut settings: serde_json::Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("Configurações inválidas.".to_string());
    }
    settings["storageRoot"] = serde_json::json!(root.to_string_lossy());
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
        .trim_end_matches(['.', ' '])
        .to_string();
    if normalized.is_empty() || normalized == "." || normalized == ".." {
        return Err("Nome de arquivo inválido.".to_string());
    }
    let stem = normalized
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    Ok(format!(
        "{}{}",
        if reserved { "_" } else { "" },
        normalized.chars().take(160).collect::<String>()
    ))
}

pub fn midi_path(file: &str) -> Result<PathBuf, String> {
    let name = Path::new(file)
        .file_name()
        .ok_or_else(|| "Arquivo MIDI inválido.".to_string())?;
    Ok(storage_root()?.join("midi").join(name))
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
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    if crate::midi::read_notes(&bytes)?.is_empty() {
        return Err("O MIDI não possui notas.".to_string());
    }
    let mut entries = read_library()?;
    let destination = midi_path(&file_name)?;
    fs::write(&destination, bytes).map_err(|e| e.to_string())?;
    let entry = LibraryEntry {
        id: new_id("track"),
        title: title.trim().to_string(),
        file: file_name,
        source_url: None,
        duration: None,
        added_at: None,
    };
    entries.push(entry.clone());
    if let Err(e) = write_library(&entries) {
        let _ = fs::remove_file(destination);
        return Err(e);
    }
    Ok(entry)
}

pub fn save_transcribed_midi(
    source: &Path,
    title: &str,
    source_url: &str,
) -> Result<LibraryEntry, String> {
    ensure_storage().map_err(|error| error.to_string())?;
    let safe_title = safe_file_name(title)?;
    let mut file_name = format!("{safe_title}.mid");
    let mut count = 2;
    while midi_path(&file_name)?.exists() {
        file_name = format!("{safe_title} ({count}).mid");
        count += 1;
    }
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    if crate::midi::read_notes(&bytes)?.is_empty() {
        return Err("O MIDI não possui notas.".to_string());
    }
    let mut entries = read_library()?;
    let destination = midi_path(&file_name)?;
    fs::write(&destination, bytes).map_err(|e| e.to_string())?;
    let entry = LibraryEntry {
        id: new_id("track"),
        title: title.trim().to_string(),
        file: file_name,
        source_url: Some(source_url.to_string()),
        duration: None,
        added_at: None,
    };
    entries.push(entry.clone());
    if let Err(e) = write_library(&entries) {
        let _ = fs::remove_file(destination);
        return Err(e);
    }
    Ok(entry)
}

pub fn rename_midi(id: &str, title: &str) -> Result<LibraryEntry, String> {
    let mut entries = read_library()?;
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
    if old_path != new_path {
        fs::rename(&old_path, &new_path).map_err(|error| error.to_string())?;
    }
    entry.title = title.trim().to_string();
    entry.file = new_file.clone();

    let result = entry.clone();
    if let Err(e) = write_library(&entries) {
        if old_path != new_path {
            let _ = fs::rename(&new_path, &old_path);
        }
        return Err(e);
    }
    Ok(result)
}

pub fn delete_midi(id: &str) -> Result<Vec<LibraryEntry>, String> {
    let entries = read_library()?;
    let playlists = read_playlists()?;
    let entry = entries
        .iter()
        .find(|e| e.id == id)
        .ok_or("Música não encontrada.")?;
    let file = midi_path(&entry.file)?;
    let staging = file.with_file_name(new_id(".deleting"));
    let existed = file.exists();
    let remaining = entries
        .iter()
        .filter(|e| e.id != id)
        .cloned()
        .collect::<Vec<_>>();
    let mut next_playlists = playlists.clone();
    for p in &mut next_playlists {
        p.track_ids.retain(|t| t != id);
    }
    if existed {
        fs::rename(&file, &staging).map_err(|e| e.to_string())?;
    }
    let result = (|| {
        write_playlists(&next_playlists)?;
        write_library(&remaining)?;
        if existed {
            fs::remove_file(&staging).map_err(|e| e.to_string())?;
        }
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        let mut errors = vec![error];
        if let Err(e) = write_playlists(&playlists) {
            errors.push(e);
        }
        if let Err(e) = write_library(&entries) {
            errors.push(e);
        }
        if existed && staging.exists() {
            if let Err(e) = fs::rename(&staging, &file) {
                errors.push(e.to_string());
            }
        }
        return Err(errors.join("; "));
    }
    Ok(remaining)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Scope {
        _guard: MutexGuard<'static, ()>,
        dir: tempfile::TempDir,
        previous: Option<PathBuf>,
    }
    impl Scope {
        fn new() -> Self {
            let guard = transaction().unwrap();
            let dir = tempfile::tempdir().unwrap();
            let previous = SELECTED_ROOT.lock().unwrap().replace(dir.path().to_owned());
            Self {
                _guard: guard,
                dir,
                previous,
            }
        }
        fn midi(&self) -> PathBuf {
            let file = self.dir.path().join("original.mid");
            crate::decoder::write_midi(
                &file,
                &[crate::decoder::NoteEvent {
                    start_frame: 2,
                    end_frame: 30,
                    pitch: 60,
                    velocity: 100,
                    pitch_bends: vec![],
                }],
            )
            .unwrap();
            file
        }
    }
    impl Drop for Scope {
        fn drop(&mut self) {
            *SELECTED_ROOT.lock().unwrap() = self.previous.take();
        }
    }
    #[test]
    fn rename_preserves_playlist_id_and_reimport_has_new_id() {
        let scope = Scope::new();
        let source = scope.midi();
        let original = import_midi(&source).unwrap();
        let lists = vec![Playlist {
            id: "p".into(),
            name: "p".into(),
            track_ids: vec![original.id.clone()],
            created_at: "".into(),
        }];
        write_playlists(&lists).unwrap();
        let renamed = rename_midi(&original.id, "renamed").unwrap();
        assert_eq!(renamed.id, original.id);
        assert_eq!(
            read_playlists().unwrap()[0].track_ids.as_slice(),
            std::slice::from_ref(&renamed.id)
        );
        assert!(midi_path(&renamed.file).unwrap().is_file());
        let next = import_midi(&source).unwrap();
        assert_ne!(next.id, renamed.id);
    }
    #[test]
    fn invalid_json_is_preserved_and_import_cannot_overwrite_it() {
        let scope = Scope::new();
        let source = scope.midi();
        let file = scope.dir.path().join("library.json");
        fs::write(&file, b"{broken").unwrap();
        assert!(read_library().is_err());
        assert!(import_midi(&source).is_err());
        assert_eq!(fs::read(file).unwrap(), b"{broken");
    }
    #[test]
    fn atomic_write_replaces_valid_json_and_missing_file_is_empty() {
        let scope = Scope::new();
        assert!(read_library().unwrap().is_empty());
        write_library(&[]).unwrap();
        write_library(&[]).unwrap();
        assert_eq!(
            fs::read_to_string(scope.dir.path().join("library.json"))
                .unwrap()
                .trim(),
            "[]"
        );
    }
    #[test]
    fn deletion_cleans_file_and_playlist_and_invalid_index_preserves_data() {
        let scope = Scope::new();
        let source = scope.midi();
        let entry = import_midi(&source).unwrap();
        write_playlists(&[Playlist {
            id: "p".into(),
            name: "p".into(),
            track_ids: vec![entry.id.clone()],
            created_at: "".into(),
        }])
        .unwrap();
        let lists = scope.dir.path().join("playlists.json");
        let saved = fs::read(&lists).unwrap();
        fs::write(&lists, b"invalid").unwrap();
        assert!(delete_midi(&entry.id).is_err());
        assert!(midi_path(&entry.file).unwrap().exists());
        assert_eq!(read_library().unwrap().len(), 1);
        fs::write(&lists, saved).unwrap();
        delete_midi(&entry.id).unwrap();
        assert!(!midi_path(&entry.file).unwrap().exists());
        assert!(read_library().unwrap().is_empty());
        assert!(read_playlists().unwrap()[0].track_ids.is_empty());
    }
}
