use super::{blocking, control};
use crate::{
    library as storage,
    playback::{Action, PlaybackController},
};
#[tauri::command]
pub(crate) async fn playlist_list() -> Result<Vec<storage::Playlist>, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::read_playlists()
    })
    .await
}

#[tauri::command]

pub(crate) async fn playlist_create(name: String) -> Result<storage::Playlist, String> {
    blocking(move || storage::playlist_create(name)).await
}

#[tauri::command]

pub(crate) async fn playlist_rename(
    id: String,
    name: String,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<storage::Playlist, String> {
    let controller = controller.inner().clone();
    blocking(move || {
        let playlist = storage::playlist_rename(id, name)?;
        controller.request(Action::RenamePlaylist(
            playlist.id.clone(),
            playlist.name.clone(),
        ))?;
        Ok(playlist)
    })
    .await
}

#[tauri::command]

pub(crate) async fn playlist_delete(id: String) -> Result<Vec<storage::Playlist>, String> {
    blocking(move || storage::playlist_delete(id)).await
}

#[tauri::command]

pub(crate) async fn playlist_add(
    playlist_id: String,
    track_id: String,
) -> Result<storage::Playlist, String> {
    blocking(move || storage::playlist_add(playlist_id, track_id)).await
}

#[tauri::command]

pub(crate) async fn playlist_remove_track(
    playlist_id: String,
    track_id: String,
) -> Result<storage::Playlist, String> {
    blocking(move || storage::playlist_remove_track(playlist_id, track_id)).await
}

#[tauri::command]
pub(crate) async fn playlist_add_tracks(
    playlist_id: String,
    track_ids: Vec<String>,
) -> Result<storage::Playlist, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::add_playlist_tracks(&playlist_id, &track_ids)
    })
    .await
}

#[tauri::command]
pub(crate) async fn playlist_reorder(
    playlist_id: String,
    track_ids: Vec<String>,
) -> Result<storage::Playlist, String> {
    blocking(move || {
        let _guard = storage::transaction()?;
        storage::reorder_playlist(&playlist_id, &track_ids)
    })
    .await
}

#[tauri::command]

pub(crate) async fn playlist_play(
    id: String,
    mode: String,
    controller: tauri::State<'_, PlaybackController>,
) -> Result<(), String> {
    control(
        controller.inner().clone(),
        Action::Playlist(id, mode == "shuffle"),
    )
    .await
    .map(|_| ())
}
