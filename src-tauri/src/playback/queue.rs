use super::{loader::shuffle, types::*};

#[derive(Clone)]
pub(super) struct Queue {
    pub(super) tracks: Vec<Track>,
    pub(super) source: QueueKind,
    pub(super) playlist: Option<QueuePlaylist>,
    pub(super) ids: Vec<String>,
    pub(super) index: usize,
    pub(super) shuffle: bool,
    next_round: Vec<String>,
}

impl Queue {
    pub(super) fn new(
        tracks: Vec<Track>,
        current: &str,
        playlist: Option<QueuePlaylist>,
        random: bool,
    ) -> Self {
        let mut queue = Self {
            source: if playlist.is_some() {
                QueueKind::Playlist
            } else {
                QueueKind::Library
            },
            playlist,
            tracks,
            ids: vec![],
            index: 0,
            shuffle: !random,
            next_round: vec![],
        };
        queue.set_shuffle(random, current);
        queue
    }

    fn round(&self, previous: Option<&str>) -> Vec<String> {
        let mut ids = self
            .tracks
            .iter()
            .map(|track| track.id.clone())
            .collect::<Vec<_>>();
        if self.shuffle {
            shuffle(&mut ids);
            if ids.len() > 1 && ids.first().map(String::as_str) == previous {
                ids.swap(0, 1);
            }
        }
        ids
    }

    pub(super) fn set_shuffle(&mut self, enabled: bool, current: &str) {
        if self.shuffle == enabled && !self.ids.is_empty() {
            return;
        }
        self.shuffle = enabled;
        self.ids = self.tracks.iter().map(|track| track.id.clone()).collect();
        if enabled {
            self.ids.retain(|id| id != current);
            shuffle(&mut self.ids);
            self.ids.insert(0, current.to_string());
        }
        self.index = self.ids.iter().position(|id| id == current).unwrap_or(0);
        self.next_round = self.round(self.ids.last().map(String::as_str));
    }

    fn destination(&self, forward: bool, repeat: bool) -> Option<&str> {
        if self.tracks.is_empty() {
            return None;
        }
        if !forward {
            if self.tracks.len() == 1 { return None; }
            return self
                .index
                .checked_sub(1)
                .and_then(|index| self.ids.get(index))
                .map(String::as_str);
        }
        if (self.index + 1).is_multiple_of(self.tracks.len()) && !repeat {
            return None;
        }
        self.ids
            .get(self.index + 1)
            .or_else(|| repeat.then(|| self.next_round.first()).flatten())
            .map(String::as_str)
    }

    pub(super) fn step(&self, forward: bool, repeat: bool) -> Option<Self> {
        self.destination(forward, repeat)?;
        if self.tracks.len() == 1 { return Some(self.clone()); }
        let mut next = self.clone();
        if forward {
            if next.index + 1 == next.ids.len() {
                next.ids.extend(next.next_round.clone());
                next.next_round = next.round(next.ids.last().map(String::as_str));
            }
            next.index += 1;
        } else {
            next.index -= 1;
        }
        Some(next)
    }

    pub(super) fn current(&self) -> &str {
        &self.ids[self.index]
    }

    pub(super) fn snapshot(&self, repeat: bool) -> PlaybackQueue {
        let track = |id: Option<&str>| {
            id.and_then(|id| self.tracks.iter().find(|track| track.id == id))
                .cloned()
        };
        PlaybackQueue {
            source: self.source,
            playlist: self.playlist.clone(),
            mode: if self.shuffle { "shuffle" } else { "order" },
            index: self.index % self.tracks.len().max(1),
            total: self.tracks.len(),
            previous: track(self.destination(false, repeat)),
            next: track(self.destination(true, repeat)),
        }
    }

    pub(super) fn remove(&mut self, id: &str) {
        if !self.tracks.iter().any(|track| track.id == id) {
            return;
        }
        let removed_before = self.ids[..self.index]
            .iter()
            .filter(|candidate| candidate.as_str() == id)
            .count();
        self.ids.retain(|candidate| candidate != id);
        self.index = self.index.saturating_sub(removed_before);
        self.tracks.retain(|track| track.id != id);
        self.next_round = self.round(self.ids.last().map(String::as_str));
    }

    pub(super) fn rename(&mut self, id: &str, title: &str) {
        if let Some(track) = self.tracks.iter_mut().find(|track| track.id == id) {
            track.title = title.to_string();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn queue(current: &str, random: bool) -> Queue {
        Queue::new(
            ["a", "b", "c", "d"]
                .into_iter()
                .map(|id| Track {
                    id: id.into(),
                    title: id.into(),
                })
                .collect(),
            current,
            None,
            random,
        )
    }
    #[test]
    fn ordered_navigation_and_shuffle_keep_current_and_restore_canonical_index() {
        let mut q = queue("b", false);
        assert_eq!(q.snapshot(false).previous.unwrap().id, "a");
        assert_eq!(q.snapshot(false).next.unwrap().id, "c");
        q.set_shuffle(true, "b");
        assert_eq!(q.current(), "b");
        assert_eq!(q.snapshot(false).index, 0);
        let mut played = vec![q.current().to_string()];
        while let Some(next) = q.step(true, false) {
            let advertised = q.snapshot(false).next.unwrap().id;
            assert_eq!(advertised, next.current());
            let previous = next.step(false, false).unwrap();
            assert_eq!(previous.current(), q.current());
            assert_eq!(
                previous.step(true, false).unwrap().current(),
                next.current()
            );
            played.push(next.current().to_string());
            q = next;
        }
        played.sort();
        assert_eq!(played, ["a", "b", "c", "d"]);
        let current = q.current().to_string();
        q.set_shuffle(false, &current);
        assert_eq!(q.ids, ["a", "b", "c", "d"]);
        assert_eq!(
            q.snapshot(false).index,
            q.tracks
                .iter()
                .position(|track| track.id == current)
                .unwrap()
        );
    }
    #[test]
    fn repeat_preview_is_reserved_and_history_crosses_rounds_without_immediate_repeats() {
        let mut q = queue("a", true);
        for _ in 0..24 {
            let advertised = q.snapshot(true).next.unwrap().id;
            assert_eq!(q.snapshot(true).next.unwrap().id, advertised);
            let next = q.step(true, true).unwrap();
            assert_eq!(next.current(), advertised);
            assert_ne!(q.current(), next.current());
            assert_eq!(next.step(false, true).unwrap().current(), q.current());
            q = next;
        }
        q.rename("b", "Renomeada");
        assert_eq!(
            q.tracks.iter().find(|track| track.id == "b").unwrap().title,
            "Renomeada"
        );
        let removed = q
            .tracks
            .iter()
            .find(|track| track.id != q.current())
            .unwrap()
            .id
            .clone();
        let current = q.current().to_string();
        q.remove(&removed);
        assert_eq!(q.current(), current);
        assert_eq!(q.snapshot(true).total, 3);
        assert!(!q.ids.contains(&removed));
        assert_ne!(q.snapshot(true).next.unwrap().id, removed);
    }
    #[test]
    fn single_track_only_advances_with_repeat_enabled() {
        let q = Queue::new(
            vec![Track {
                id: "a".into(),
                title: "A".into(),
            }],
            "a",
            None,
            true,
        );
        assert!(q.step(false, true).is_none());
        assert!(q.step(true, false).is_none());
        assert_eq!(q.step(true, true).unwrap().current(), "a");
        assert!(q.step(true, true).unwrap().step(false, true).is_none());
    }
}
