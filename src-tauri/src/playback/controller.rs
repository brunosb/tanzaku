use super::{
    events::AppPublisher,
    loader::{Prepared, WorkerConfig},
    types::{QueueInput, Snapshot},
    worker::run_worker,
};
use crate::platform::input::NativeDevice;
use std::{
    sync::mpsc::{self, Sender},
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
    Speed(f64),
    Repeat,
    Clear,
    Remove(String),
    Rename(String, String),
    Snapshot,
    Shutdown,
}
pub(super) enum Command {
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
