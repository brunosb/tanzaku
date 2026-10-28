use super::{read_json, read_library, save_json, storage_root, Playlist};
pub(crate) fn read_playlists() -> Result<Vec<Playlist>, String> {
    read_json(storage_root()?.join("playlists.json"))
}

pub(crate) fn write_playlists(playlists: &[Playlist]) -> Result<(), String> {
    save_json(&storage_root()?.join("playlists.json"), playlists)
}

pub(crate) fn add_playlist_tracks(
    playlist_id: &str,
    track_ids: &[String],
) -> Result<Playlist, String> {
    let library = read_library()?;
    let available = library
        .iter()
        .map(|e| e.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    if track_ids.iter().any(|id| !available.contains(id.as_str())) {
        return Err("Música não encontrada. Nenhuma alteração foi salva.".into());
    }
    let mut lists = read_playlists()?;
    let playlist = lists
        .iter_mut()
        .find(|p| p.id == playlist_id)
        .ok_or("Playlist não encontrada.")?;
    let mut present = playlist
        .track_ids
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    for id in track_ids {
        if present.insert(id.clone()) {
            playlist.track_ids.push(id.clone());
        }
    }
    let result = playlist.clone();
    write_playlists(&lists)?;
    Ok(result)
}

pub(crate) fn reorder_playlist(
    playlist_id: &str,
    track_ids: &[String],
) -> Result<Playlist, String> {
    let mut lists = read_playlists()?;
    let playlist = lists
        .iter_mut()
        .find(|p| p.id == playlist_id)
        .ok_or("Playlist não encontrada.")?;
    let mut before = playlist.track_ids.clone();
    let mut after = track_ids.to_vec();
    before.sort();
    after.sort();
    if before != after {
        return Err("A ordem deve conter exatamente as músicas atuais da playlist. Atualize a lista e tente novamente.".into());
    }
    playlist.track_ids = track_ids.to_vec();
    let result = playlist.clone();
    write_playlists(&lists)?;
    Ok(result)
}

use super::{new_id, transaction};
fn valid_name(name: &str) -> Result<String, String> {
    let name = name.trim().chars().take(100).collect::<String>();
    if name.is_empty() {
        Err("Nome inválido.".to_string())
    } else {
        Ok(name)
    }
}
pub(crate) fn playlist_create(name: String) -> Result<Playlist, String> {
    let _guard = transaction()?;
    let name = valid_name(&name)?;
    let mut lists = read_playlists()?;
    let playlist = Playlist {
        id: new_id("playlist"),
        name,
        track_ids: vec![],
        created_at: new_id("created"),
    };
    lists.push(playlist.clone());
    write_playlists(&lists)?;
    Ok(playlist)
}
pub(crate) fn playlist_rename(id: String, name: String) -> Result<Playlist, String> {
    let _guard = transaction()?;
    let mut lists = read_playlists()?;
    let p = lists
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("Playlist não encontrada.")?;
    p.name = valid_name(&name)?;
    let result = p.clone();
    write_playlists(&lists)?;
    Ok(result)
}
pub(crate) fn playlist_delete(id: String) -> Result<Vec<Playlist>, String> {
    let _guard = transaction()?;
    let mut lists = read_playlists()?;
    lists.retain(|p| p.id != id);
    write_playlists(&lists)?;
    Ok(lists)
}
pub(crate) fn playlist_add(playlist_id: String, track_id: String) -> Result<Playlist, String> {
    let _guard = transaction()?;
    if !read_library()?.iter().any(|e| e.id == track_id) {
        return Err("Música não encontrada.".to_string());
    }
    let mut lists = read_playlists()?;
    let p = lists
        .iter_mut()
        .find(|p| p.id == playlist_id)
        .ok_or("Playlist não encontrada.")?;
    if !p.track_ids.contains(&track_id) {
        p.track_ids.push(track_id);
    }
    let result = p.clone();
    write_playlists(&lists)?;
    Ok(result)
}
pub(crate) fn playlist_remove_track(
    playlist_id: String,
    track_id: String,
) -> Result<Playlist, String> {
    let _guard = transaction()?;
    let mut lists = read_playlists()?;
    let p = lists
        .iter_mut()
        .find(|p| p.id == playlist_id)
        .ok_or("Playlist não encontrada.")?;
    p.track_ids.retain(|t| t != &track_id);
    let result = p.clone();
    write_playlists(&lists)?;
    Ok(result)
}
