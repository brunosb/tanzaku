use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Debug, Clone)]
pub(crate) struct MidiNote {
    pub time: f64,
    pub pitch: i32,
    pub velocity: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Key {
    pub name: String,
    pub modifier: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PlaybackEvent {
    pub time: f64,
    pub keys: Vec<Key>,
    pub hold: f64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PlaybackPlan {
    pub events: Vec<PlaybackEvent>,
    pub duration: f64,
    pub stats: BTreeMap<String, f64>,
}
