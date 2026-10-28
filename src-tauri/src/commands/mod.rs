pub(crate) mod library;
pub(crate) mod playback;
pub(crate) mod playlists;
pub(crate) mod settings;
pub(crate) mod transcription;
pub(crate) mod youtube;
use crate::playback::{Action, PlaybackController, Snapshot};
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) async fn control(
    controller: PlaybackController,
    action: Action,
) -> Result<Snapshot, String> {
    let reply = controller.enqueue(action)?;
    blocking(move || reply.recv().map_err(|e| e.to_string())?).await
}
