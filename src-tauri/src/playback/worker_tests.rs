use super::{
    controller::{Action, PlaybackController},
    events::Publisher,
    keyboard::Device,
    loader::{LoadSpec, Loader, Prepared, Queue, WorkerConfig},
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
    Plan(Snapshot),
    Event,
}
struct Probe(Sender<Notice>);
impl Publisher for Probe {
    fn state(&self, v: PlaybackState) {
        let _ = self.0.send(Notice::State(v));
    }
    fn plan(&self, v: Snapshot) {
        let _ = self.0.send(Notice::Plan(v));
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
#[test]
fn stopped_loading_cannot_resurrect() {
    let (gate, wait) = mpsc::channel();
    let wait = Mutex::new(wait);
    let h = Harness::new(Arc::new(move |_| {
        wait.lock().unwrap().recv().unwrap();
        Ok(prepared("a", 0.0, 1.0))
    }));
    let pending = h.controller.enqueue(Action::Load("a".into())).unwrap();
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
            p.queue = Some(Queue {
                ids: vec!["a".into(), "b".into()],
                index: 0,
                shuffle: false,
            });
            Ok(p)
        }
        LoadSpec::Track(id) => Ok(prepared(&id, 0.0, 10.0)),
    }));
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
    h.controller.request(Action::Load("a".into())).unwrap();
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
    h.controller.request(Action::Load("a".into())).unwrap();
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
            p.queue = Some(Queue {
                ids: vec!["a".into(), "b".into(), "c".into()],
                index: 0,
                shuffle: false,
            });
            Ok(p)
        }
        LoadSpec::Track(id) => {
            requested.lock().unwrap().push(id.clone());
            wait.lock().unwrap().recv().unwrap();
            Ok(prepared(&id, 0.0, 10.0))
        }
    }));
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
            p.queue = Some(Queue {
                ids,
                index: 0,
                shuffle: false,
            });
            Ok(p)
        }
        LoadSpec::Track(id) => Ok(prepared(&id, 0.0, 10.0)),
    }));
    h.controller
        .request(Action::Playlist("p".into(), false))
        .unwrap();
    h.wait(|n| matches!(n,Notice::Plan(s)if s.track.as_ref().is_some_and(|t|t.id=="a")));
    *saved.lock().unwrap() = vec!["c".into(), "a".into(), "b".into()];
    h.wait(|n| matches!(n,Notice::Plan(s)if s.track.as_ref().is_some_and(|t|t.id=="b")));
    h.controller.request(Action::Stop).unwrap();
    h.controller
        .request(Action::Playlist("p".into(), false))
        .unwrap();
    h.wait(|n| matches!(n,Notice::Plan(s)if s.track.as_ref().is_some_and(|t|t.id=="c")));
    let next = h.controller.request(Action::Snapshot).unwrap();
    assert_eq!(next.track.unwrap().id, "c");
}
