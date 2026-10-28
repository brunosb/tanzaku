use super::types::{EventNotice, PlaybackState, Snapshot};
use tauri::{AppHandle, Emitter};
pub(super) trait Publisher: Send {
    fn state(&self, value: PlaybackState);
    fn plan(&self, value: Snapshot);
    fn event(&self, value: EventNotice);
}
pub(super) struct AppPublisher(pub(super) AppHandle);
impl Publisher for AppPublisher {
    fn state(&self, value: PlaybackState) {
        let _ = self.0.emit("playback-state", value);
    }
    fn plan(&self, value: Snapshot) {
        let _ = self.0.emit("playback-plan", value);
    }
    fn event(&self, value: EventNotice) {
        let _ = self.0.emit("playback-event", value);
    }
}
