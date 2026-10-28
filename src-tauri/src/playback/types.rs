use crate::music::types::PlaybackPlan;
use serde::Serialize;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Idle,
    Loading,
    Countdown,
    Playing,
    Paused,
    Stopped,
    Ended,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub status: PlaybackStatus,
    pub position: f64,
    pub duration: f64,
    pub speed: f64,
    pub current_event_index: usize,
    pub generation: u64,
    pub sequence: u64,
    pub active_event_indices: Vec<usize>,
    pub countdown_remaining: u32,
    pub repeat_enabled: bool,
    pub pause_reason: Option<String>,
    pub error: Option<String>,
}
impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            status: PlaybackStatus::Idle,
            position: 0.0,
            duration: 0.0,
            speed: 1.0,
            current_event_index: 0,
            generation: 0,
            sequence: 0,
            active_event_indices: vec![],
            countdown_remaining: 0,
            repeat_enabled: false,
            pause_reason: None,
            error: None,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct Track {
    pub id: String,
    pub title: String,
}
#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub state: PlaybackState,
    pub track: Option<Track>,
    pub plan: PlaybackPlan,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingSample {
    pub generation: u64,
    pub index: usize,
    pub late_by_ms: f64,
    pub send_ms: f64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EventNotice {
    pub(super) generation: u64,
    pub(super) sequence: u64,
    pub(super) index: usize,
    pub(super) late_by_ms: f64,
    pub(super) send_ms: f64,
}
