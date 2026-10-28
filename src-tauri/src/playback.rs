use crate::{
    input::{Device, Keyboard, NativeDevice},
    planner::PlaybackPlan,
    storage,
    timing::PreciseWaiter,
};
use serde::Serialize;
use std::{
    sync::mpsc::{self, Sender},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
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
struct EventNotice {
    generation: u64,
    sequence: u64,
    index: usize,
    late_by_ms: f64,
    send_ms: f64,
}
trait Publisher: Send {
    fn state(&self, value: PlaybackState);
    fn plan(&self, value: Snapshot);
    fn event(&self, value: EventNotice);
}
struct AppPublisher(AppHandle);
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
type Loader = std::sync::Arc<dyn Fn(LoadSpec) -> Result<Prepared, String> + Send + Sync>;
struct WorkerConfig {
    countdown: Duration,
    loader: Loader,
}
impl Default for WorkerConfig {
    fn default() -> Self {
        Self {
            countdown: Duration::from_secs(5),
            loader: std::sync::Arc::new(prepare),
        }
    }
}
#[derive(Clone)]
struct Queue {
    ids: Vec<String>,
    index: usize,
    shuffle: bool,
}
struct Prepared {
    track: Track,
    plan: PlaybackPlan,
    queue: Option<Queue>,
}
enum LoadSpec {
    Track(String),
    Playlist(String, bool),
}
pub enum Action {
    Load(String),
    Playlist(String, bool),
    Play,
    Pause,
    Stop,
    Seek(f64, bool),
    Speed(f64),
    Repeat,
    Clear,
    Remove(String),
    Rename(String, String),
    Snapshot,
    Shutdown,
}
enum Command {
    Request(Action, Sender<Result<Snapshot, String>>),
    Loaded {
        token: u64,
        result: Result<Prepared, String>,
        auto: bool,
        reply: Option<Sender<Result<Snapshot, String>>>,
    },
}
#[derive(Clone)]
pub struct PlaybackController {
    commands: Sender<Command>,
}
impl PlaybackController {
    pub fn new(app: AppHandle) -> Self {
        let (commands, receiver) = mpsc::channel();
        let sender = commands.clone();
        thread::spawn(move || {
            run_worker(
                AppPublisher(app),
                receiver,
                sender,
                NativeDevice::default(),
                WorkerConfig::default(),
            )
        });
        Self { commands }
    }
    pub fn enqueue(
        &self,
        action: Action,
    ) -> Result<mpsc::Receiver<Result<Snapshot, String>>, String> {
        let (reply, rx) = mpsc::channel();
        self.commands
            .send(Command::Request(action, reply))
            .map_err(|e| e.to_string())?;
        Ok(rx)
    }
    pub fn request(&self, action: Action) -> Result<Snapshot, String> {
        self.enqueue(action)?.recv().map_err(|e| e.to_string())?
    }
}
fn empty_plan() -> PlaybackPlan {
    PlaybackPlan {
        events: vec![],
        duration: 0.0,
        stats: Default::default(),
    }
}
struct Model {
    state: PlaybackState,
    plan: PlaybackPlan,
    track: Option<Track>,
    started: Instant,
    base: f64,
    countdown: Option<Instant>,
    token: u64,
    queue: Option<Queue>,
    pending: bool,
    last_emit: Instant,
    samples: Vec<TimingSample>,
}
impl Model {
    fn new(now: Instant) -> Self {
        Self {
            state: PlaybackState::default(),
            plan: empty_plan(),
            track: None,
            started: now,
            base: 0.0,
            countdown: None,
            token: 0,
            queue: None,
            pending: false,
            last_emit: now,
            samples: vec![],
        }
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            state: self.state.clone(),
            track: self.track.clone(),
            plan: self.plan.clone(),
        }
    }
    fn position(&self, now: Instant) -> f64 {
        if self.state.status == PlaybackStatus::Playing {
            (self.base
                + now.saturating_duration_since(self.started).as_secs_f64() * self.state.speed)
                .min(self.state.duration)
        } else {
            self.state.position
        }
    }
    fn deadline(&self, time: f64) -> Instant {
        self.started + Duration::from_secs_f64(((time - self.base) / self.state.speed).max(0.0))
    }
    fn cancel(&mut self) {
        self.token = self.token.wrapping_add(1);
        self.pending = false;
        self.countdown = None;
        self.state.countdown_remaining = 0;
    }
    fn pause(&mut self, now: Instant, reason: Option<String>) {
        self.state.position = self.position(now);
        self.cancel();
        self.state.status = PlaybackStatus::Paused;
        self.state.pause_reason = reason;
    }
    fn begin(&mut self, now: Instant) {
        self.started = now;
        self.base = self.state.position;
        self.state.status = PlaybackStatus::Playing;
        self.state.countdown_remaining = 0;
        self.state.pause_reason = None;
        self.state.error = None;
    }
    fn install(&mut self, prepared: Prepared) {
        self.plan = prepared.plan;
        self.track = Some(prepared.track);
        self.queue = prepared.queue;
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
    fn seek(&mut self, p: f64) {
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
    fn speed(&mut self, speed: f64, now: Instant) {
        self.state.position = self.position(now);
        self.base = self.state.position;
        self.started = now;
        self.state.speed = if speed.is_finite() {
            speed.clamp(0.1, 4.0)
        } else {
            1.0
        };
    }
    fn next(&self) -> Option<(String, Option<Queue>)> {
        // Commit the queue cursor only after the prepared track is installed.
        if let Some(mut queue) = self.queue.clone() {
            if queue.index + 1 < queue.ids.len() {
                queue.index += 1;
            } else if self.state.repeat_enabled {
                queue.index = 0;
                if queue.shuffle {
                    shuffle(&mut queue.ids);
                }
            } else {
                return None;
            }
            queue
                .ids
                .get(queue.index)
                .cloned()
                .map(|id| (id, Some(queue)))
        } else if self.state.repeat_enabled {
            self.track.as_ref().map(|t| (t.id.clone(), None))
        } else {
            None
        }
    }
}

fn shuffle(ids: &mut [String]) {
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
fn prepare(spec: LoadSpec) -> Result<Prepared, String> {
    let (entry, path, queue) = {
        let _guard = storage::transaction()?;
        let entries = storage::read_library()?;
        let (id, queue) = match spec {
            LoadSpec::Track(id) => (id, None),
            LoadSpec::Playlist(id, random) => {
                let playlist = storage::read_playlists()?
                    .into_iter()
                    .find(|p| p.id == id)
                    .ok_or("Playlist não encontrada.")?;
                let mut ids = playlist
                    .track_ids
                    .into_iter()
                    .filter(|id| entries.iter().any(|e| &e.id == id))
                    .collect::<Vec<_>>();
                if ids.is_empty() {
                    return Err("A playlist não possui músicas válidas.".to_string());
                }
                if random {
                    shuffle(&mut ids);
                }
                (
                    ids[0].clone(),
                    Some(Queue {
                        ids,
                        index: 0,
                        shuffle: random,
                    }),
                )
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
    let notes = crate::midi::read_notes(&bytes)?;
    let plan = crate::planner::build_playback_plan(&notes);
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
fn load(
    sender: &Sender<Command>,
    loader: &Loader,
    token: u64,
    spec: LoadSpec,
    auto: bool,
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
            auto,
            reply,
        });
    });
}
fn publish<D: Device>(app: &impl Publisher, m: &mut Model, k: &Keyboard<D>, plan: bool) {
    m.state.active_event_indices = k.active();
    m.state.sequence += 1;
    m.last_emit = Instant::now();
    if plan {
        app.plan(m.snapshot());
    } else {
        app.state(m.state.clone());
    }
}
fn release<D: Device>(m: &mut Model, k: &mut Keyboard<D>, disarm: bool) -> Result<(), String> {
    let result = k.reset(disarm);
    m.state.active_event_indices = k.active();
    if let Err(e) = &result {
        m.state.error = Some(e.clone());
    }
    result
}
fn run_worker(
    app: impl Publisher,
    receiver: mpsc::Receiver<Command>,
    sender: Sender<Command>,
    device: impl Device,
    config: WorkerConfig,
) {
    let mut m = Model::new(Instant::now());
    let mut k = Keyboard::new(device);
    let mut waiter = PreciseWaiter::new();
    let mut previous_keys = (false, false);
    loop {
        // Bound command processing so a flooded IPC queue cannot starve key-up.
        for _ in 0..64 {
            let command = match receiver.try_recv() {
                Ok(c) => c,
                Err(mpsc::TryRecvError::Empty) => break,
                Err(_) => return,
            };
            match command {
                Command::Loaded {
                    token,
                    result,
                    auto,
                    reply,
                } => {
                    if token != m.token || !m.pending {
                        if let Some(reply) = reply {
                            let _ = reply.send(Err("Carregamento cancelado.".to_string()));
                        }
                        continue;
                    }
                    m.pending = false;
                    let result = result.and_then(|p| {
                        release(&mut m, &mut k, !auto)?;
                        let initial_playlist = p.queue.is_some() && !auto;
                        m.install(p);
                        if initial_playlist {
                            m.countdown = Some(Instant::now() + config.countdown);
                            m.state.status = PlaybackStatus::Countdown;
                            m.state.countdown_remaining = 5;
                        }
                        if auto {
                            if !k.device.focused() {
                                m.pause(Instant::now(), Some("focus-lost".to_string()));
                                release(&mut m, &mut k, true)?;
                            } else {
                                m.begin(Instant::now());
                            }
                        }
                        publish(&app, &mut m, &k, true);
                        Ok(m.snapshot())
                    });
                    if let Err(e) = &result {
                        m.state.error = Some(e.clone());
                        m.state.status = PlaybackStatus::Paused;
                        m.queue = None;
                        publish(&app, &mut m, &k, false);
                    }
                    if let Some(reply) = reply {
                        let _ = reply.send(result);
                    }
                }
                Command::Request(action, reply) => {
                    match action {
                        Action::Load(id) => {
                            m.cancel();
                            m.queue = None;
                            let result = release(&mut m, &mut k, true);
                            if let Err(e) = result {
                                let _ = reply.send(Err(e));
                                continue;
                            }
                            m.state.status = PlaybackStatus::Loading;
                            m.pending = true;
                            publish(&app, &mut m, &k, false);
                            load(
                                &sender,
                                &config.loader,
                                m.token,
                                LoadSpec::Track(id),
                                false,
                                Some(reply),
                                None,
                            );
                            continue;
                        }
                        Action::Playlist(id, random) => {
                            m.cancel();
                            m.queue = None;
                            let result = release(&mut m, &mut k, true);
                            if let Err(e) = result {
                                let _ = reply.send(Err(e));
                                continue;
                            }
                            m.state.status = PlaybackStatus::Loading;
                            m.pending = true;
                            publish(&app, &mut m, &k, false);
                            load(
                                &sender,
                                &config.loader,
                                m.token,
                                LoadSpec::Playlist(id, random),
                                false,
                                Some(reply),
                                None,
                            );
                            continue;
                        }
                        _ => {}
                    }
                    let mut plan_changed = false;
                    let shutdown = matches!(action, Action::Shutdown);
                    let result = (|| -> Result<(), String> {
                        match action {
                            Action::Play => {
                                if m.pending {
                                    return Err("Aguarde o carregamento.".to_string());
                                }
                                if m.plan.events.is_empty() {
                                    return Err("Não há notas carregadas.".to_string());
                                }
                                if matches!(
                                    m.state.status,
                                    PlaybackStatus::Playing | PlaybackStatus::Countdown
                                ) {
                                    return Ok(());
                                }
                                if matches!(
                                    m.state.status,
                                    PlaybackStatus::Ended | PlaybackStatus::Stopped
                                ) {
                                    m.state.position = 0.0;
                                    m.state.current_event_index = 0;
                                }
                                m.cancel();
                                m.countdown = Some(Instant::now() + config.countdown);
                                m.state.countdown_remaining = 5;
                                m.state.status = PlaybackStatus::Countdown;
                                m.state.error = None;
                            }
                            Action::Pause => {
                                m.pause(Instant::now(), None);
                                release(&mut m, &mut k, true)?;
                            }
                            Action::Stop => {
                                m.cancel();
                                m.queue = None;
                                m.state.status = PlaybackStatus::Stopped;
                                m.state.position = 0.0;
                                m.state.current_event_index = 0;
                                release(&mut m, &mut k, true)?;
                            }
                            Action::Seek(p, resume) => {
                                m.seek(p);
                                release(&mut m, &mut k, true)?;
                                if resume {
                                    m.countdown = Some(Instant::now() + config.countdown);
                                    m.state.countdown_remaining = 5;
                                    m.state.status = PlaybackStatus::Countdown;
                                }
                            }
                            Action::Speed(s) => {
                                m.speed(s, Instant::now());
                                k.expire(m.state.position)?;
                            }
                            Action::Repeat => {
                                m.state.repeat_enabled = !m.state.repeat_enabled;
                            }
                            Action::Clear | Action::Shutdown => {
                                m.cancel();
                                m.queue = None;
                                release(&mut m, &mut k, true)?;
                                m.plan = empty_plan();
                                m.track = None;
                                m.state.status = PlaybackStatus::Idle;
                                m.state.position = 0.0;
                                m.state.duration = 0.0;
                                m.state.current_event_index = 0;
                                m.state.generation += 1;
                                m.state.error = None;
                                m.state.pause_reason = None;
                                plan_changed = true;
                            }
                            Action::Remove(id) => {
                                if let Some(q) = &mut m.queue {
                                    let current = m.track.as_ref().map(|t| t.id.as_str());
                                    q.ids.retain(|v| v != &id);
                                    q.index = current
                                        .and_then(|id| q.ids.iter().position(|v| v == id))
                                        .unwrap_or(0);
                                }
                                if m.track.as_ref().is_some_and(|t| t.id == id) || m.pending {
                                    m.cancel();
                                    m.queue = None;
                                    release(&mut m, &mut k, true)?;
                                    m.plan = empty_plan();
                                    m.track = None;
                                    m.state.status = PlaybackStatus::Idle;
                                    m.state.position = 0.0;
                                    m.state.duration = 0.0;
                                    m.state.current_event_index = 0;
                                    m.state.generation += 1;
                                    plan_changed = true;
                                }
                            }
                            Action::Rename(id, title) => {
                                if let Some(t) = &mut m.track {
                                    if t.id == id {
                                        t.title = title;
                                        plan_changed = true;
                                    }
                                }
                            }
                            Action::Snapshot => {}
                            Action::Load(_) | Action::Playlist(_, _) => unreachable!(),
                        }
                        Ok(())
                    })();
                    if let Err(e) = &result {
                        m.state.error = Some(e.clone());
                        m.pause(Instant::now(), Some("input-error".to_string()));
                        let _ = release(&mut m, &mut k, true);
                    }
                    publish(&app, &mut m, &k, plan_changed);
                    let _ = reply.send(result.map(|_| m.snapshot()));
                    if shutdown {
                        return;
                    }
                }
            }
        }
        let now = Instant::now();
        let keys = k.device.shortcuts();
        if keys.1 && !previous_keys.1 {
            m.cancel();
            m.queue = None;
            m.state.position = 0.0;
            m.state.current_event_index = 0;
            m.state.status = PlaybackStatus::Stopped;
            let _ = release(&mut m, &mut k, true);
            publish(&app, &mut m, &k, false);
        } else if keys.0 && !previous_keys.0 {
            m.pause(now, None);
            let _ = release(&mut m, &mut k, true);
            publish(&app, &mut m, &k, false);
        }
        previous_keys = keys;
        if let Some(deadline) = m.countdown {
            if now >= deadline {
                m.countdown = None;
                match k.device.arm() {
                    Ok(()) => m.begin(now),
                    Err(e) => {
                        m.pause(now, Some("focus-lost".to_string()));
                        m.state.error = Some(e);
                    }
                }
                publish(&app, &mut m, &k, false);
            } else {
                let remaining = deadline.duration_since(now).as_secs_f64().ceil() as u32;
                if m.state.countdown_remaining != remaining {
                    m.state.countdown_remaining = remaining;
                    publish(&app, &mut m, &k, false);
                }
            }
        }
        if m.state.status == PlaybackStatus::Playing {
            if !k.device.focused() {
                m.pause(now, Some("focus-lost".to_string()));
                let _ = release(&mut m, &mut k, true);
                publish(&app, &mut m, &k, false);
                continue;
            }
            let position = m.position(now);
            m.state.position = position;
            let active_before = k.active();
            let result = (|| -> Result<(), String> {
                k.expire(position)?;
                let mut dispatched = 0;
                while m.state.current_event_index < m.plan.events.len() {
                    if dispatched >= 32 {
                        break;
                    }
                    dispatched += 1;
                    let index = m.state.current_event_index;
                    let event = &m.plan.events[index];
                    if event.time > position + 0.000001 {
                        break;
                    }
                    m.state.current_event_index += 1;
                    if event.time + event.hold <= position {
                        continue;
                    }
                    let planned = m.deadline(event.time);
                    let send_started = Instant::now();
                    k.press(index, &event.keys, event.time + event.hold)?;
                    let sent_at = Instant::now();
                    let sample = TimingSample {
                        generation: m.state.generation,
                        index,
                        late_by_ms: sent_at.saturating_duration_since(planned).as_secs_f64()
                            * 1000.0,
                        send_ms: sent_at.duration_since(send_started).as_secs_f64() * 1000.0,
                    };
                    m.state.sequence += 1;
                    app.event(EventNotice {
                        generation: m.state.generation,
                        sequence: m.state.sequence,
                        index,
                        late_by_ms: sample.late_by_ms,
                        send_ms: sample.send_ms,
                    });
                    if m.samples.len() < 10000 {
                        m.samples.push(sample);
                    }
                }
                Ok(())
            })();
            if let Err(e) = result {
                m.pause(Instant::now(), Some("input-error".to_string()));
                m.state.error = Some(e);
                let _ = release(&mut m, &mut k, true);
                publish(&app, &mut m, &k, false);
                continue;
            }
            if position >= m.state.duration && k.active().is_empty() {
                m.state.status = PlaybackStatus::Ended;
                publish(&app, &mut m, &k, false);
                if let Some((id, queue)) = m.next() {
                    m.cancel();
                    m.pending = true;
                    m.state.status = PlaybackStatus::Loading;
                    load(
                        &sender,
                        &config.loader,
                        m.token,
                        LoadSpec::Track(id),
                        true,
                        None,
                        queue,
                    );
                    publish(&app, &mut m, &k, false);
                } else {
                    let _ = release(&mut m, &mut k, true);
                    if !m.samples.is_empty() {
                        let mut values = m.samples.iter().map(|s| s.late_by_ms).collect::<Vec<_>>();
                        values.sort_by(f64::total_cmp);
                        eprintln!(
                            "Despacho nativo: n={} P95={:.2}ms máximo={:.2}ms",
                            values.len(),
                            values[((values.len() - 1) as f64 * 0.95).ceil() as usize],
                            values[values.len() - 1]
                        );
                        m.samples.clear();
                    }
                }
            } else if active_before != k.active()
                || now.saturating_duration_since(m.last_emit) >= Duration::from_millis(33)
            {
                publish(&app, &mut m, &k, false);
            }
        }
        waiter.wait(
            if matches!(
                m.state.status,
                PlaybackStatus::Playing | PlaybackStatus::Countdown
            ) {
                Duration::from_millis(1)
            } else {
                Duration::from_millis(10)
            },
        );
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::tests::{key, FakeDevice};
    fn plan() -> PlaybackPlan {
        PlaybackPlan {
            events: [0.0, 0.005, 0.010, 1.0]
                .into_iter()
                .map(|time| crate::planner::PlaybackEvent {
                    time,
                    hold: 2.0,
                    keys: vec![key("A", None)],
                })
                .collect(),
            duration: 3.0,
            stats: Default::default(),
        }
    }
    #[test]
    fn absolute_clock_respects_roll_and_half_double_speed() {
        let now = Instant::now();
        for speed in [0.5, 1.0, 2.0] {
            let mut m = Model::new(now);
            m.plan = plan();
            m.state.duration = 3.0;
            m.state.speed = speed;
            m.begin(now);
            assert_eq!(
                m.deadline(0.005),
                now + Duration::from_secs_f64(0.005 / speed)
            );
            assert_eq!(m.deadline(1.0), now + Duration::from_secs_f64(1.0 / speed));
        }
    }
    #[test]
    fn speed_change_recalculates_active_release_without_a_second_timer() {
        let now = Instant::now();
        let mut m = Model::new(now);
        m.plan = plan();
        m.state.duration = 3.0;
        m.begin(now);
        let mut k = Keyboard::new(FakeDevice::default());
        k.device.arm().unwrap();
        k.press(0, &[key("A", None)], 2.0).unwrap();
        m.speed(2.0, now + Duration::from_millis(500));
        assert_eq!(m.deadline(2.0), now + Duration::from_millis(1250));
        k.expire(m.position(now + Duration::from_millis(1249)))
            .unwrap();
        assert_eq!(k.active(), [0]);
        k.expire(m.position(now + Duration::from_millis(1250)))
            .unwrap();
        assert!(k.active().is_empty());
    }
    #[test]
    fn pause_seek_and_cancel_invalidate_pending_load_and_release() {
        let now = Instant::now();
        let mut m = Model::new(now);
        m.plan = plan();
        m.state.duration = 3.0;
        m.begin(now);
        m.pending = true;
        let token = m.token;
        m.pause(now + Duration::from_millis(100), None);
        assert!(m.token != token && !m.pending);
        assert!((m.state.position - 0.1).abs() < 1e-9);
        m.seek(0.007);
        assert_eq!(m.state.current_event_index, 2);
        assert_eq!(m.state.status, PlaybackStatus::Paused);
    }
    #[test]
    fn queue_repeat_and_stop_do_not_rearm_or_restart() {
        let now = Instant::now();
        let mut m = Model::new(now);
        m.queue = Some(Queue {
            ids: vec!["a".into(), "b".into()],
            index: 0,
            shuffle: false,
        });
        let (id, queue) = m.next().unwrap();
        assert_eq!(id, "b");
        m.queue = queue;
        m.state.repeat_enabled = true;
        assert_eq!(m.next().unwrap().0, "a");
        m.cancel();
        m.queue = None;
        m.state.repeat_enabled = false;
        assert!(m.next().is_none());
    }
}

#[cfg(test)]
#[path = "playback_tests.rs"]
mod worker_tests;
