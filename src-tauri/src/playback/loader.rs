use super::{
    controller::Command,
    queue::Queue,
    types::{QueueInput, QueuePlaylist, Snapshot, Track},
};
use crate::{library as storage, music::types::PlaybackPlan};
use std::{
    sync::mpsc::Sender,
    thread,
    time::{Duration, Instant},
};
pub(super) type Loader = std::sync::Arc<dyn Fn(LoadSpec) -> Result<Prepared, String> + Send + Sync>;
pub(super) struct WorkerConfig {
    pub(super) countdown: Duration,
    pub(super) loader: Loader,
    pub(super) auto_advance: Result<bool, String>,
    pub(super) background_playback: Result<bool, String>,
    pub(super) save_background: fn(bool) -> Result<(), String>,
}
impl Default for WorkerConfig {
    fn default() -> Self {
        Self {
            save_background: |enabled| {
                let _guard = storage::transaction()?;
                let mut settings = storage::read_settings()?;
                settings["backgroundPlaybackEnabled"] = serde_json::json!(enabled);
                storage::write_settings_at(&storage::storage_root()?, settings)
            },
            countdown: Duration::from_secs(5),
            loader: std::sync::Arc::new(prepare),
            auto_advance: (|| {
                let _guard = storage::transaction()?;
                Ok(storage::read_settings()?["autoAdvanceEnabled"]
                    .as_bool()
                    .unwrap_or(false))
            })(),
            background_playback: (|| {
                let _guard = storage::transaction()?;
                Ok(storage::read_settings()?["backgroundPlaybackEnabled"]
                    .as_bool()
                    .unwrap_or(true))
            })(),
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum StartMode {
    Loaded,
    Countdown,
    Continue,
}
pub(super) struct Prepared {
    pub(super) track: Track,
    pub(super) plan: PlaybackPlan,
    pub(super) queue: Option<Queue>,
}
pub(super) enum LoadSpec {
    Track(String),
    Playlist(String, bool),
    Context(String, QueueInput, bool),
}
pub(super) fn shuffle(ids: &mut [String]) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEED: AtomicU64 = AtomicU64::new(0);
    let mut seed = SEED.fetch_add(1, Ordering::Relaxed)
        ^ std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
    for i in (1..ids.len()).rev() {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        ids.swap(i, seed as usize % (i + 1));
    }
}
pub(super) fn prepare(spec: LoadSpec) -> Result<Prepared, String> {
    let (entry, path, queue) = {
        let _guard = storage::transaction()?;
        let entries = storage::read_library()?;
        let (id, queue) = match spec {
            LoadSpec::Track(id) => (id, None),
            LoadSpec::Playlist(id, random) => prepare_queue(
                &entries,
                QueueInput::Playlist { playlist_id: id },
                None,
                random,
            )?,
            LoadSpec::Context(id, context, random) => {
                prepare_queue(&entries, context, Some(id), random)?
            }
        };
        let entry = entries
            .into_iter()
            .find(|e| e.id == id)
            .ok_or("Música não encontrada.")?;
        let path = storage::midi_path(&entry.file)?;
        (entry, path, queue)
    };
    let started = Instant::now();
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let notes = crate::music::midi::read_notes(&bytes)?;
    let plan = crate::music::planner::build_playback_plan(&notes);
    if plan.events.is_empty() {
        return Err("O MIDI não possui notas utilizáveis.".to_string());
    }
    eprintln!(
        "Plano {}: {} eventos em {:.2} ms",
        entry.title,
        plan.events.len(),
        started.elapsed().as_secs_f64() * 1000.0
    );
    Ok(Prepared {
        track: Track {
            id: entry.id,
            title: entry.title,
        },
        plan,
        queue,
    })
}

fn prepare_queue(
    entries: &[storage::LibraryEntry],
    context: QueueInput,
    selected: Option<String>,
    random: bool,
) -> Result<(String, Option<Queue>), String> {
    let (ids, playlist) = match context {
        QueueInput::Library { track_ids } => (
            if track_ids.is_empty() {
                entries.iter().map(|entry| entry.id.clone()).collect()
            } else {
                track_ids
            },
            None,
        ),
        QueueInput::Playlist { playlist_id } => {
            let playlist = storage::read_playlists()?
                .into_iter()
                .find(|playlist| playlist.id == playlist_id)
                .ok_or("Playlist não encontrada.")?;
            (
                playlist.track_ids,
                Some(QueuePlaylist {
                    id: playlist.id,
                    name: playlist.name,
                }),
            )
        }
    };
    let by_id = entries
        .iter()
        .map(|entry| (entry.id.as_str(), entry))
        .collect::<std::collections::HashMap<_, _>>();
    let mut seen = std::collections::HashSet::new();
    let tracks = ids
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .filter_map(|id| {
            by_id.get(id.as_str()).map(|entry| Track {
                id: entry.id.clone(),
                title: entry.title.clone(),
            })
        })
        .collect::<Vec<_>>();
    if tracks.is_empty() {
        return Err("A fila não possui músicas disponíveis.".to_string());
    }
    let current = if let Some(id) = selected {
        if !tracks.iter().any(|track| track.id == id) {
            return Err("A música não está disponível nesta fila.".to_string());
        }
        id
    } else if random {
        let mut ids = tracks
            .iter()
            .map(|track| track.id.clone())
            .collect::<Vec<_>>();
        shuffle(&mut ids);
        ids[0].clone()
    } else {
        tracks[0].id.clone()
    };
    let queue = Queue::new(tracks, &current, playlist, random);
    Ok((current, Some(queue)))
}
pub(super) fn load(
    sender: &Sender<Command>,
    loader: &Loader,
    token: u64,
    spec: LoadSpec,
    start: StartMode,
    reply: Option<Sender<Result<Snapshot, String>>>,
    queue: Option<Queue>,
) {
    let sender = sender.clone();
    let loader = loader.clone();
    thread::spawn(move || {
        let result = loader(spec).map(|mut p| {
            if queue.is_some() {
                p.queue = queue;
            }
            p
        });
        let _ = sender.send(Command::Loaded {
            token,
            result,
            start,
            reply,
        });
    });
}
