mod models;
pub(crate) use models::{LibraryEntry, Playlist};
mod json;
pub(crate) use json::{read_json, save_json};
mod settings;
pub(crate) use settings::{
    ensure_storage, read_settings, set_storage_root, storage_root, write_auto_advance,
    write_settings_at,
};
mod playlists;
pub(crate) use playlists::{
    add_playlist_tracks, read_playlists, reorder_playlist, write_playlists,
};
mod files;
pub(crate) use files::{
    delete_midi, import_midi, midi_path, read_library, rename_midi, save_transcribed_midi,
};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, MutexGuard,
};
static STORAGE_LOCK: Mutex<()> = Mutex::new(());
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
pub(crate) fn transaction() -> Result<MutexGuard<'static, ()>, String> {
    STORAGE_LOCK
        .lock()
        .map_err(|_| "Armazenamento indisponível.".to_string())
}

pub(crate) fn new_id(prefix: &str) -> String {
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
#[cfg(test)]
mod tests;

pub(crate) use playlists::{
    playlist_add, playlist_create, playlist_delete, playlist_remove_track, playlist_rename,
};
