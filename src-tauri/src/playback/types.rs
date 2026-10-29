use crate::music::types::PlaybackPlan;
use serde::{Deserialize, Serialize};
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
    pub auto_advance_enabled: bool,
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
            auto_advance_enabled: false,
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
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QueueKind {
    Library,
    Playlist,
}

#[derive(Clone, Debug, Serialize)]
pub struct QueuePlaylist {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PlaybackQueue {
    pub source: QueueKind,
    pub playlist: Option<QueuePlaylist>,
    pub mode: &'static str,
    pub index: usize,
    pub total: usize,
    pub previous: Option<Track>,
    pub next: Option<Track>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum QueueInput {
    Library {
        #[serde(rename = "trackIds")]
        track_ids: Vec<String>,
    },
    Playlist {
        #[serde(rename = "playlistId")]
        playlist_id: String,
    },
}
#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub state: PlaybackState,
    pub track: Option<Track>,
    pub plan: PlaybackPlan,
    pub queue: Option<PlaybackQueue>,
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
