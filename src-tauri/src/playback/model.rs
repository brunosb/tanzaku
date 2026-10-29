use super::{loader::Prepared, queue::Queue, types::*};
use crate::music::types::PlaybackPlan;
use std::time::{Duration, Instant};
pub(super) fn empty_plan() -> PlaybackPlan {
    PlaybackPlan {
        events: vec![],
        duration: 0.0,
        stats: Default::default(),
    }
}
pub(super) struct Model {
    pub(super) state: PlaybackState,
    pub(super) plan: PlaybackPlan,
    pub(super) track: Option<Track>,
    pub(super) started: Instant,
    pub(super) base: f64,
    pub(super) countdown: Option<Instant>,
    pub(super) token: u64,
    pub(super) queue: Option<Queue>,
    pub(super) shuffle_enabled: bool,
    pub(super) renamed_tracks: std::collections::HashMap<String, String>,
    pub(super) renamed_playlists: std::collections::HashMap<String, String>,
    pub(super) pending: bool,
    pub(super) last_emit: Instant,
    pub(super) samples: Vec<TimingSample>,
}
impl Model {
    pub(super) fn new(now: Instant) -> Self {
        Self {
            state: PlaybackState::default(),
            plan: empty_plan(),
            track: None,
            started: now,
            base: 0.0,
            countdown: None,
            token: 0,
            queue: None,
            shuffle_enabled: false,
            renamed_tracks: Default::default(),
            renamed_playlists: Default::default(),
            pending: false,
            last_emit: now,
            samples: vec![],
        }
    }
    pub(super) fn snapshot(&self) -> Snapshot {
        Snapshot {
            state: self.state.clone(),
            track: self.track.clone(),
            plan: self.plan.clone(),
            queue: self
                .queue
                .as_ref()
                .map(|queue| queue.snapshot(self.state.repeat_enabled)),
        }
    }
    pub(super) fn position(&self, now: Instant) -> f64 {
        if self.state.status == PlaybackStatus::Playing {
            (self.base
                + now.saturating_duration_since(self.started).as_secs_f64() * self.state.speed)
                .min(self.state.duration)
        } else {
            self.state.position
        }
    }
    pub(super) fn deadline(&self, time: f64) -> Instant {
        self.started + Duration::from_secs_f64(((time - self.base) / self.state.speed).max(0.0))
    }
    pub(super) fn cancel(&mut self) {
        self.token = self.token.wrapping_add(1);
        self.pending = false;
        self.countdown = None;
        self.state.countdown_remaining = 0;
    }
    pub(super) fn pause(&mut self, now: Instant, reason: Option<String>) {
        self.state.position = self.position(now);
        self.cancel();
        self.state.status = PlaybackStatus::Paused;
        self.state.pause_reason = reason;
    }
    pub(super) fn begin(&mut self, now: Instant) {
        self.started = now;
        self.base = self.state.position;
        self.state.status = PlaybackStatus::Playing;
        self.state.countdown_remaining = 0;
        self.state.pause_reason = None;
        self.state.error = None;
    }
    pub(super) fn install(&mut self, mut prepared: Prepared) {
        if let Some(title) = self.renamed_tracks.get(&prepared.track.id) {
            prepared.track.title = title.clone();
        }
        if let Some(queue) = &mut prepared.queue {
            if let Some(playlist) = &mut queue.playlist {
                if let Some(name) = self.renamed_playlists.get(&playlist.id) {
                    playlist.name = name.clone();
                }
            }
            for track in &mut queue.tracks {
                if let Some(title) = self.renamed_tracks.get(&track.id) {
                    track.title = title.clone();
                }
            }
        }
        self.plan = prepared.plan;
        self.track = Some(prepared.track);
        self.queue = prepared.queue;
        if let Some(queue) = &self.queue {
            self.shuffle_enabled = queue.shuffle;
        }
        self.state.generation += 1;
        self.state.duration = self.plan.duration;
        self.state.position = 0.0;
        self.state.current_event_index = 0;
        self.state.status = PlaybackStatus::Idle;
        self.state.error = None;
        self.state.pause_reason = None;
        self.state.active_event_indices.clear();
        self.pending = false;
    }
    pub(super) fn seek(&mut self, p: f64) {
        self.cancel();
        self.state.position = if p.is_finite() {
            p.clamp(0.0, self.state.duration)
        } else {
            0.0
        };
        self.state.current_event_index = self
            .plan
            .events
            .partition_point(|e| e.time < self.state.position);
        self.state.status = PlaybackStatus::Paused;
    }
    pub(super) fn speed(&mut self, speed: f64, now: Instant) {
        self.state.position = self.position(now);
        self.base = self.state.position;
        self.started = now;
        self.state.speed = if speed.is_finite() {
            speed.clamp(0.1, 4.0)
        } else {
            1.0
        };
    }
    pub(super) fn next(&self) -> Option<(String, Option<Queue>)> {
        // Commit the queue cursor only after the prepared track is installed.
        if let Some(queue) = &self.queue {
            let next = queue.step(true, self.state.repeat_enabled)?;
            Some((next.current().to_string(), Some(next)))
        } else if self.state.repeat_enabled {
            self.track.as_ref().map(|t| (t.id.clone(), None))
        } else {
            None
        }
    }
}
