use super::{
    controller::{Action, PlaybackController},
    events::Publisher,
    keyboard::Device,
    loader::{LoadSpec, Loader, Prepared, WorkerConfig},
    queue::Queue,
    types::*,
    worker::run_worker,
};
use crate::music::types::PlaybackPlan;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::{
    sync::mpsc::{self, Sender},
    thread,
    time::{Duration, Instant},
};
#[derive(Clone, Default)]
struct DeviceProbe {
    focused: Arc<AtomicBool>,
    arms: Arc<AtomicUsize>,
    strokes: Arc<Mutex<Vec<crate::playback::keyboard::Stroke>>>,
}
impl Device for DeviceProbe {
    fn arm(&mut self) -> Result<(), String> {
        self.arms.fetch_add(1, Ordering::SeqCst);
        self.focused.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn focused(&self) -> bool {
        self.focused.load(Ordering::SeqCst)
    }
    fn disarm(&mut self) {
        self.focused.store(false, Ordering::SeqCst);
    }
    fn send(&mut self, v: &[crate::playback::keyboard::Stroke]) -> Result<(), String> {
        self.strokes.lock().unwrap().extend_from_slice(v);
        Ok(())
    }
}
enum Notice {
    State(PlaybackState),
    Plan(Box<Snapshot>),
    Event,
}
struct Probe(Sender<Notice>);
impl Publisher for Probe {
    fn state(&self, v: PlaybackState) {
        let _ = self.0.send(Notice::State(v));
    }
    fn plan(&self, v: Snapshot) {
        let _ = self.0.send(Notice::Plan(Box::new(v)));
    }
    fn event(&self, _: EventNotice) {
        let _ = self.0.send(Notice::Event);
    }
}
struct Harness {
    controller: PlaybackController,
    output: mpsc::Receiver<Notice>,
    device: DeviceProbe,
    join: Option<thread::JoinHandle<()>>,
}
impl Harness {
    fn new(loader: Loader) -> Self {
        let (commands, rx) = mpsc::channel();
        let (tx, output) = mpsc::channel();
        let device = DeviceProbe::default();
        let probe = device.clone();
        let sender = commands.clone();
        let join = thread::spawn(move || {
            run_worker(
                Probe(tx),
                rx,
                sender,
                probe,
                WorkerConfig {
                    countdown: Duration::ZERO,
                    loader,
                    auto_advance: Ok(false),
                },
            )
        });
        Self {
            controller: PlaybackController { commands },
            output,
            device,
            join: Some(join),
        }
    }
    fn wait(&self, predicate: impl Fn(&Notice) -> bool) {
        let until = Instant::now() + Duration::from_secs(3);
        loop {
            let notice = self
                .output
                .recv_timeout(until.saturating_duration_since(Instant::now()))
                .expect("worker notification");
            if predicate(&notice) {
                return;
            }
        }
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        let _ = self.controller.request(Action::Shutdown);
        if let Some(join) = self.join.take() {
            join.join().unwrap();
        }
    }
}
fn prepared(id: &str, time: f64, hold: f64) -> Prepared {
    Prepared {
        track: Track {
            id: id.to_string(),
            title: id.to_string(),
        },
        plan: PlaybackPlan {
            events: vec![crate::music::types::PlaybackEvent {
                time,
                hold,
                keys: vec![crate::playback::keyboard::tests::key("A", Some("shift"))],
            }],
            duration: time + hold,
            stats: Default::default(),
        },
        queue: None,
    }
}
fn test_queue(ids: Vec<String>) -> Queue {
    let current = ids[0].clone();
    Queue::new(
        ids.into_iter()
            .map(|id| Track {
                title: id.clone(),
                id,
            })
            .collect(),
        &current,
        Some(QueuePlaylist {
            id: "p".into(),
            name: "Playlist de teste".into(),
        }),
        false,
    )
}
#[test]
fn stopped_loading_cannot_resurrect() {
    let (gate, wait) = mpsc::channel();
    let wait = Mutex::new(wait);
    let h = Harness::new(Arc::new(move |_| {
        wait.lock().unwrap().recv().unwrap();
        Ok(prepared("a", 0.0, 1.0))
    }));
    let pending = h
        .controller
        .enqueue(Action::Load("a".into(), None))
        .unwrap();
    h.wait(|n| matches!(n,Notice::State(s)if s.status==PlaybackStatus::Loading));
    h.controller.request(Action::Stop).unwrap();
    gate.send(()).unwrap();
    assert!(pending
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .is_err());
    assert_eq!(
        h.controller.request(Action::Snapshot).unwrap().state.status,
        PlaybackStatus::Stopped
    );
    assert_eq!(h.device.arms.load(Ordering::SeqCst), 0);
}
#[test]
fn playlist_continues_without_countdown_or_rearming() {
    let h = Harness::new(Arc::new(|spec| match spec {
        LoadSpec::Playlist(_, _) => {
            let mut p = prepared("a", 0.0, 0.03);
            p.queue = Some(test_queue(vec!["a".into(), "b".into()]));
            Ok(p)
        }
        LoadSpec::Track(id) | LoadSpec::Context(id, _, _) => Ok(prepared(&id, 0.0, 10.0)),
    }));
    h.controller.request(Action::AutoAdvance(true)).unwrap();
    h.controller
        .request(Action::Playlist("p".into(), false))
        .unwrap();
    h.wait(|n|matches!(n,Notice::Plan(s)if s.track.as_ref().is_some_and(|t|t.id=="b")&&s.state.status==PlaybackStatus::Playing));
    assert_eq!(h.device.arms.load(Ordering::SeqCst), 1);
    h.controller.request(Action::Stop).unwrap();
    assert!(h
        .controller
        .request(Action::Snapshot)
        .unwrap()
        .state
        .active_event_indices
        .is_empty());
}
#[test]
fn focus_loss_pauses_even_before_next_attack() {
    let h = Harness::new(Arc::new(|_| Ok(prepared("a", 1.0, 10.0))));
    h.controller
        .request(Action::Load("a".into(), None))
        .unwrap();
    h.controller.request(Action::Play).unwrap();
    h.wait(|n| matches!(n,Notice::State(s)if s.status==PlaybackStatus::Playing));
    let start = Instant::now();
    h.device.focused.store(false, Ordering::SeqCst);
    h.wait(|n| matches!(n,Notice::State(s)if s.pause_reason.as_deref()==Some("focus-lost")));
    assert!(start.elapsed() < Duration::from_millis(50));
    assert_eq!(h.device.arms.load(Ordering::SeqCst), 1);
    assert!(h.device.strokes.lock().unwrap().iter().all(|s| s.up));
}
#[test]
fn shutdown_confirms_release_of_sustain_and_modifiers() {
    let h = Harness::new(Arc::new(|_| Ok(prepared("a", 0.0, 10.0))));
    h.controller
        .request(Action::Load("a".into(), None))
        .unwrap();
    h.controller.request(Action::Play).unwrap();
    h.wait(|n| matches!(n, Notice::Event));
    h.controller.request(Action::Shutdown).unwrap();
    let strokes = h.device.strokes.lock().unwrap();
    for scan in [0x1e, 0x2a, 0x1d] {
        assert!(strokes.contains(&crate::playback::keyboard::Stroke { scan, up: true }));
    }
}

#[test]
fn pausing_pending_transition_does_not_skip_next_track_on_resume() {
    let (gate, wait) = mpsc::channel();
    let wait = Mutex::new(wait);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let requested = seen.clone();
    let h = Harness::new(Arc::new(move |spec| match spec {
        LoadSpec::Playlist(_, _) => {
            let mut p = prepared("a", 0.0, 0.03);
            p.queue = Some(test_queue(vec!["a".into(), "b".into(), "c".into()]));
            Ok(p)
        }
        LoadSpec::Track(id) | LoadSpec::Context(id, _, _) => {
            requested.lock().unwrap().push(id.clone());
            wait.lock().unwrap().recv().unwrap();
            Ok(prepared(&id, 0.0, 10.0))
        }
    }));
    h.controller.request(Action::AutoAdvance(true)).unwrap();
    h.controller
        .request(Action::Playlist("p".into(), false))
        .unwrap();
    h.wait(|n| matches!(n,Notice::State(s)if s.status==PlaybackStatus::Loading&&s.generation==1));
    h.controller.request(Action::Pause).unwrap();
    gate.send(()).unwrap();
    // FIFO snapshot is a command barrier; a canceled Loaded may arrive afterward,
    // but the saved queue cursor must still point at the first track.
    h.controller.request(Action::Play).unwrap();
    h.wait(|n| matches!(n,Notice::State(s)if s.status==PlaybackStatus::Loading&&s.generation==1));
    gate.send(()).unwrap();
    h.wait(|n| matches!(n,Notice::Plan(s)if s.track.as_ref().is_some_and(|t|t.id=="b")));
    assert_eq!(*seen.lock().unwrap(), ["b", "b"]);
}

#[test]
fn playlist_edits_apply_only_to_the_next_execution() {
    let saved = Arc::new(Mutex::new(vec![
        "a".to_string(),
        "b".to_string(),
        "c".to_string(),
    ]));
    let source = saved.clone();
    let h = Harness::new(Arc::new(move |spec| match spec {
        LoadSpec::Playlist(_, _) => {
            let ids = source.lock().unwrap().clone();
            let mut p = prepared(&ids[0], 0.0, 0.2);
            p.queue = Some(test_queue(ids));
            Ok(p)
        }
        LoadSpec::Track(id) | LoadSpec::Context(id, _, _) => Ok(prepared(&id, 0.0, 10.0)),
    }));
    h.controller.request(Action::AutoAdvance(true)).unwrap();
    h.controller
        .request(Action::Playlist("p".into(), false))
        .unwrap();
    h.wait(|n| matches!(n,Notice::Plan(s)if s.track.as_ref().is_some_and(|t|t.id=="a")));
    *saved.lock().unwrap() = vec!["c".into(), "a".into(), "b".into()];
    h.wait(|n| matches!(n,Notice::Plan(s)if s.track.as_ref().is_some_and(|t|t.id=="b")));
    h.controller.request(Action::Stop).unwrap();
    h.controller.request(Action::AutoAdvance(true)).unwrap();
    h.controller
        .request(Action::Playlist("p".into(), false))
        .unwrap();
    h.wait(|n| matches!(n,Notice::Plan(s)if s.track.as_ref().is_some_and(|t|t.id=="c")));
    let next = h.controller.request(Action::Snapshot).unwrap();
    assert_eq!(next.track.unwrap().id, "c");
}

fn library_loader() -> Loader {
    Arc::new(|spec| {
        let (id, context) = match spec {
            LoadSpec::Context(id, _, random) => (id, Some(random)),
            LoadSpec::Track(id) => (id, None),
            LoadSpec::Playlist(_, _) => unreachable!(),
        };
        let mut p = prepared(&id, 0.0, 10.0);
        if let Some(random) = context {
            p.queue = Some(Queue::new(
                ["a", "b", "c"]
                    .into_iter()
                    .map(|id| Track {
                        id: id.into(),
                        title: id.into(),
                    })
                    .collect(),
                &id,
                None,
                random,
            ));
        }
        Ok(p)
    })
}

#[test]
fn default_policy_ends_without_advancing_and_releases_keys() {
    let h = Harness::new(Arc::new(|_| {
        let mut p = prepared("a", 0.0, 0.02);
        p.queue = Some(test_queue(vec!["a".into(), "b".into()]));
        Ok(p)
    }));
    h.controller
        .request(Action::Load("a".into(), None))
        .unwrap();
    h.controller.request(Action::Play).unwrap();
    h.wait(|n| matches!(n, Notice::State(s) if s.status == PlaybackStatus::Ended));
    let current = h.controller.request(Action::Snapshot).unwrap();
    assert!(!current.state.auto_advance_enabled);
    assert_eq!(current.track.unwrap().id, "a");
    assert_eq!(current.queue.unwrap().index, 0);
    assert!(current.state.active_event_indices.is_empty());
}

#[test]
fn disabling_auto_advance_cancels_pending_transition_without_committing_cursor() {
    let (gate, wait) = mpsc::channel();
    let wait = Mutex::new(wait);
    let h = Harness::new(Arc::new(move |spec| match spec {
        LoadSpec::Playlist(_, _) => {
            let mut p = prepared("a", 0.0, 0.02);
            p.queue = Some(test_queue(vec!["a".into(), "b".into()]));
            Ok(p)
        }
        _ => {
            wait.lock().unwrap().recv().unwrap();
            Ok(prepared("b", 0.0, 10.0))
        }
    }));
    h.controller.request(Action::AutoAdvance(true)).unwrap();
    h.controller
        .request(Action::Playlist("p".into(), false))
        .unwrap();
    h.wait(|n| matches!(n, Notice::State(s) if s.status == PlaybackStatus::Loading && s.generation == 1));
    let ended = h.controller.request(Action::AutoAdvance(false)).unwrap();
    assert_eq!(ended.state.status, PlaybackStatus::Ended);
    assert_eq!(ended.track.unwrap().id, "a");
    assert_eq!(ended.queue.unwrap().index, 0);
    gate.send(()).unwrap();
    let next = h.controller.enqueue(Action::Next).unwrap();
    gate.send(()).unwrap();
    assert_eq!(
        next.recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap()
            .track
            .unwrap()
            .id,
        "b"
    );
    assert!(
        !h.controller
            .request(Action::Snapshot)
            .unwrap()
            .state
            .auto_advance_enabled
    );
}

#[test]
fn manual_skips_respect_pause_focus_loss_and_stop_keeps_context() {
    let h = Harness::new(library_loader());
    let opened = h
        .controller
        .request(Action::Load("a".into(), None))
        .unwrap();
    assert_eq!(opened.state.status, PlaybackStatus::Idle);
    assert_eq!(opened.queue.unwrap().next.unwrap().id, "b");
    let next = h.controller.request(Action::Next).unwrap();
    assert_eq!(next.track.unwrap().id, "b");
    assert_eq!(next.state.status, PlaybackStatus::Idle);
    assert_eq!(h.device.arms.load(Ordering::SeqCst), 0);
    h.controller.request(Action::Play).unwrap();
    h.wait(
        |notice| matches!(notice, Notice::State(state) if state.status == PlaybackStatus::Playing),
    );
    let next = h.controller.request(Action::Next).unwrap();
    assert_eq!(next.state.status, PlaybackStatus::Countdown);
    h.wait(|notice| matches!(notice, Notice::State(state) if state.status == PlaybackStatus::Playing && state.generation == 3));
    assert_eq!(h.device.arms.load(Ordering::SeqCst), 2);
    h.device.focused.store(false, Ordering::SeqCst);
    h.wait(|notice| matches!(notice, Notice::State(state) if state.pause_reason.as_deref() == Some("focus-lost")));
    let previous = h.controller.request(Action::Previous).unwrap();
    assert_eq!(previous.state.status, PlaybackStatus::Countdown);
    h.wait(|notice| matches!(notice, Notice::State(state) if state.status == PlaybackStatus::Playing && state.generation == 4));
    h.controller.request(Action::Pause).unwrap();
    let previous = h.controller.request(Action::Previous).unwrap();
    assert_eq!(previous.state.status, PlaybackStatus::Idle);
    h.controller.request(Action::Stop).unwrap();
    let stopped = h.controller.request(Action::Snapshot).unwrap();
    assert!(stopped.queue.is_some());
    assert!(stopped.state.active_event_indices.is_empty());
    assert_eq!(
        h.controller.request(Action::Next).unwrap().state.status,
        PlaybackStatus::Idle
    );
    assert_eq!(h.device.arms.load(Ordering::SeqCst), 3);
}

#[test]
fn queue_metadata_changes_do_not_replace_plan_and_failed_skip_keeps_cursor() {
    let good = library_loader();
    let h = Harness::new(Arc::new(move |spec| {
        if matches!(&spec, LoadSpec::Track(id) if id == "c") {
            return Err("MIDI indisponível".into());
        }
        good(spec)
    }));
    let opened = h
        .controller
        .request(Action::Load("b".into(), None))
        .unwrap();
    let generation = opened.state.generation;
    h.controller
        .request(Action::Rename("c".into(), "Próxima renomeada".into()))
        .unwrap();
    let renamed = h.controller.request(Action::Snapshot).unwrap();
    assert_eq!(
        renamed.queue.unwrap().next.unwrap().title,
        "Próxima renomeada"
    );
    assert_eq!(renamed.state.generation, generation);
    assert!(h.controller.request(Action::Next).is_err());
    let failed = h.controller.request(Action::Snapshot).unwrap();
    assert_eq!(failed.track.unwrap().id, "b");
    assert_eq!(failed.queue.unwrap().index, 1);
    assert_eq!(failed.state.generation, generation);
    assert_eq!(failed.state.status, PlaybackStatus::Paused);
    assert!(failed.state.error.is_some());
    h.controller.request(Action::Remove("c".into())).unwrap();
    let removed = h.controller.request(Action::Snapshot).unwrap();
    assert!(removed.queue.unwrap().next.is_none());
    h.controller.request(Action::Shuffle(true)).unwrap();
    let shuffled = h.controller.request(Action::Snapshot).unwrap();
    assert_eq!(shuffled.queue.unwrap().mode, "shuffle");
    assert_eq!(shuffled.state.generation, generation);
}

#[test]
fn pending_skip_preserves_renames_and_stop_does_not_commit_the_cursor() {
    let (gate, wait) = mpsc::channel();
    let wait = Mutex::new(wait);
    let ready = library_loader();
    let h = Harness::new(Arc::new(move |spec| {
        if matches!(spec, LoadSpec::Track(_)) {
            wait.lock().unwrap().recv().unwrap();
        }
        let mut p = ready(spec)?;
        if let Some(queue) = &mut p.queue {
            queue.source = QueueKind::Playlist;
            queue.playlist = Some(QueuePlaylist {
                id: "p".into(),
                name: "Nome anterior".into(),
            });
        }
        Ok(p)
    }));
    h.controller
        .request(Action::Load("a".into(), None))
        .unwrap();
    let next = h.controller.enqueue(Action::Next).unwrap();
    h.wait(|notice| matches!(notice, Notice::State(state) if state.status == PlaybackStatus::Loading && state.generation == 1));
    h.controller
        .request(Action::Rename("b".into(), "Novo título".into()))
        .unwrap();
    h.controller
        .request(Action::RenamePlaylist(
            "p".into(),
            "Novo nome da playlist".into(),
        ))
        .unwrap();
    assert!(h.controller.request(Action::Shuffle(true)).is_err());
    assert_eq!(
        h.controller.request(Action::Snapshot).unwrap().state.status,
        PlaybackStatus::Loading
    );
    gate.send(()).unwrap();
    let installed = next.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
    assert_eq!(installed.track.unwrap().title, "Novo título");
    let queue = installed.queue.unwrap();
    assert_eq!(queue.index, 1);
    assert_eq!(queue.playlist.unwrap().name, "Novo nome da playlist");
    let next = h.controller.enqueue(Action::Next).unwrap();
    h.wait(|notice| matches!(notice, Notice::State(state) if state.status == PlaybackStatus::Loading && state.generation == 2));
    h.controller.request(Action::Stop).unwrap();
    gate.send(()).unwrap();
    assert!(next.recv_timeout(Duration::from_secs(2)).unwrap().is_err());
    let stopped = h.controller.request(Action::Snapshot).unwrap();
    assert_eq!(stopped.track.unwrap().id, "b");
    assert_eq!(stopped.queue.unwrap().index, 1);
    assert_eq!(stopped.state.status, PlaybackStatus::Stopped);
    assert_eq!(h.device.arms.load(Ordering::SeqCst), 0);
}
