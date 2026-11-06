use super::{
    events::AppPublisher,
    loader::{Prepared, WorkerConfig},
    types::{QueueInput, Snapshot},
    worker::run_worker,
};
use crate::platform::input::NativeDevice;
use std::{
    sync::mpsc::{self, Sender},
    sync::{Arc, Mutex},
    thread,
};
use tauri::AppHandle;
pub enum Action {
    Load(String, Option<QueueInput>),
    Playlist(String, bool),
    Previous,
    Next,
    Shuffle(bool),
    AutoAdvance(bool),
    BackgroundPlayback(bool),
    RestoreBackground(bool),
    RenamePlaylist(String, String),
    Play,
    Pause,
    Stop,
    Seek(f64, bool),
    SeekRelative(f64),
    StartMode(crate::preferences::StartPolicy),
    ApplyMidiParts {
        track_id: String,
        source: Arc<super::loader::MidiSource>,
        selection: crate::music::types::MidiParts,
        plan: crate::music::types::PlaybackPlan,
    },
    Speed(f64),
    Repeat,
    Clear,
    Remove(String),
    Rename(String, String),
    Snapshot,
    Shutdown,
}
pub(super) enum Command {
    InspectMidi {
        track_id: String,
        reply: Sender<Result<Arc<super::loader::MidiSource>, String>>,
    },
    Request(Action, Sender<Result<Snapshot, String>>),
    Loaded {
        token: u64,
        result: Result<Prepared, String>,
        start: super::loader::StartMode,
        reply: Option<Sender<Result<Snapshot, String>>>,
    },
}
#[derive(Clone)]
pub struct PlaybackController {
    pub(super) commands: Sender<Command>,
    pub(super) selections: Arc<Mutex<()>>,
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
        Self {
            commands,
            selections: Arc::default(),
        }
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
    pub(crate) fn set_midi_parts(
        &self,
        track_id: String,
        part_ids: Vec<String>,
    ) -> Result<Snapshot, String> {
        // Serialize preparation and persistence outside the musical worker. The
        // worker continues playing and applies to its current position/status.
        let _serial = self.selections.lock().map_err(|e| e.to_string())?;
        let (reply, receiver) = mpsc::channel();
        self.commands
            .send(Command::InspectMidi {
                track_id: track_id.clone(),
                reply,
            })
            .map_err(|e| e.to_string())?;
        let source = receiver.recv().map_err(|e| e.to_string())??;
        let selection = source.document.selection(Some(&part_ids))?;
        let plan = source.document.plan(&selection.selected_part_ids);
        {
            let _guard = crate::library::transaction()?;
            if crate::library::storage_root()? != source.root {
                return Err("A biblioteca foi alterada.".into());
            }
            crate::library::save_selected_parts(&track_id, &selection.selected_part_ids)?;
        }
        self.request(Action::ApplyMidiParts {
            track_id,
            source,
            selection,
            plan,
        })
    }
}
