use super::blocking;
use crate::{
    library as storage,
    playback::{Action, PlaybackController},
};
#[tauri::command]
pub(crate) async fn library_list() -> Result<Vec<storage::LibraryEntry>, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::read_library()
    })
    .await
}

#[tauri::command]

pub(crate) async fn library_import() -> Result<Option<storage::LibraryEntry>, String> {
    blocking(|| {
        let Some(source) = rfd::FileDialog::new()
            .add_filter("MIDI", &["mid", "midi"])
            .pick_file()
        else {
            return Ok(None);
        };
        let _guard = storage::transaction()?;
        storage::import_midi(&source).map(Some)
    })
    .await
}

#[tauri::command]

pub(crate) async fn library_rename(
    id: String,
    title: String,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<storage::LibraryEntry, String> {
    let controller = controller.inner().clone();
    blocking(move || {
        let entry = {
            let _guard = storage::transaction()?;
            storage::rename_midi(&id, &title)?
        };
        controller.request(Action::Rename(entry.id.clone(), entry.title.clone()))?;
        Ok(entry)
    })
    .await
}

#[tauri::command]

pub(crate) async fn library_delete(
    id: String,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<Vec<storage::LibraryEntry>, String> {
    let controller = controller.inner().clone();
    blocking(move || {
        let _guard = storage::transaction()?;
        let _ = storage::read_playlists()?;
        let _ = storage::read_library()?;
        controller.request(Action::Remove(id.clone()))?;
        storage::delete_midi(&id)
    })
    .await
}
