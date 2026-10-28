use super::{
    ensure_storage, new_id, read_json, read_playlists, save_json, storage_root, write_playlists,
    LibraryEntry,
};
use std::{
    fs,
    path::{Path, PathBuf},
};
pub(crate) fn read_library() -> Result<Vec<LibraryEntry>, String> {
    read_json(storage_root()?.join("library.json"))
}

pub(crate) fn write_library(entries: &[LibraryEntry]) -> Result<(), String> {
    save_json(&storage_root()?.join("library.json"), entries)
}

pub(crate) fn safe_file_name(value: &str) -> Result<String, String> {
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

pub(crate) fn midi_path(file: &str) -> Result<PathBuf, String> {
    let name = Path::new(file)
        .file_name()
        .ok_or_else(|| "Arquivo MIDI inválido.".to_string())?;
    Ok(storage_root()?.join("midi").join(name))
}

pub(crate) fn import_midi(source: &Path) -> Result<LibraryEntry, String> {
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
    if crate::music::midi::read_notes(&bytes)?.is_empty() {
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

pub(crate) fn save_transcribed_midi(
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
    if crate::music::midi::read_notes(&bytes)?.is_empty() {
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

pub(crate) fn rename_midi(id: &str, title: &str) -> Result<LibraryEntry, String> {
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

pub(crate) fn delete_midi(id: &str) -> Result<Vec<LibraryEntry>, String> {
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
