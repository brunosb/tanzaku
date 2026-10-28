use std::{
    sync::{mpsc, mpsc::Sender},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{input, planner::PlaybackPlan, timing::PreciseWaiter};

const STATE_INTERVAL: Duration = Duration::from_millis(33);
const COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Idle,
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
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            status: PlaybackStatus::Idle,
            position: 0.0,
            duration: 0.0,
            speed: 1.0,
            current_event_index: 0,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackEventNotice<'a> {
    event: &'a crate::planner::PlaybackEvent,
    index: usize,
    late_by_ms: f64,
}

enum Command {
    Load(PlaybackPlan, Sender<PlaybackState>),
    Play(Sender<Result<(), String>>),
    Pause(Sender<()>),
    Stop(Sender<()>),
    Seek(f64, Sender<()>),
    SetSpeed(f64, Sender<()>),
}

#[derive(Clone)]
pub struct PlaybackController {
    commands: Sender<Command>,
}

impl PlaybackController {
    pub fn new(app: AppHandle) -> Self {
        let (commands, receiver) = mpsc::channel();
        thread::spawn(move || run_worker(app, receiver));
        Self { commands }
    }

    pub fn load(&self, plan: PlaybackPlan) -> Result<PlaybackState, String> {
        let (reply, result) = mpsc::channel();
        self.commands
            .send(Command::Load(plan, reply))
            .map_err(|error| error.to_string())?;
        result.recv().map_err(|error| error.to_string())
    }

    pub fn play(&self) -> Result<(), String> {
        let (reply, result) = mpsc::channel();
        self.commands
            .send(Command::Play(reply))
            .map_err(|error| error.to_string())?;
        result.recv().map_err(|error| error.to_string())?
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send_unit(Command::Pause)
    }

    pub fn stop(&self) -> Result<(), String> {
        self.send_unit(Command::Stop)
    }

    pub fn seek(&self, position: f64) -> Result<(), String> {
        let (reply, result) = mpsc::channel();
        self.commands
            .send(Command::Seek(position, reply))
            .map_err(|error| error.to_string())?;
        result.recv().map_err(|error| error.to_string())
    }

    pub fn set_speed(&self, speed: f64) -> Result<(), String> {
        let (reply, result) = mpsc::channel();
        self.commands
            .send(Command::SetSpeed(speed, reply))
            .map_err(|error| error.to_string())?;
        result.recv().map_err(|error| error.to_string())
    }

    fn send_unit(&self, command: impl FnOnce(Sender<()>) -> Command) -> Result<(), String> {
        let (reply, result) = mpsc::channel();
        self.commands
            .send(command(reply))
            .map_err(|error| error.to_string())?;
        result.recv().map_err(|error| error.to_string())
    }
}

struct DueEvent {
    index: usize,
    event: crate::planner::PlaybackEvent,
    late_by_ms: f64,
}

struct Advance {
    due_events: Vec<DueEvent>,
    state_changed: bool,
    ended: bool,
}

struct PlaybackModel {
    plan: PlaybackPlan,
    state: PlaybackState,
    started_at: Option<Instant>,
    base_position: f64,
    last_state_emit: Instant,
    playback_generation: u64,
    keyboard_generation: u64,
}

impl PlaybackModel {
    fn new(now: Instant) -> Self {
        Self {
            plan: PlaybackPlan {
                events: Vec::new(),
                duration: 0.0,
                stats: Default::default(),
            },
            state: PlaybackState::default(),
            started_at: None,
            base_position: 0.0,
            last_state_emit: now,
            playback_generation: 0,
            keyboard_generation: 0,
        }
    }

    fn position_at(&self, now: Instant) -> f64 {
        if self.state.status != PlaybackStatus::Playing {
            return self.state.position;
        }
        let elapsed = self
            .started_at
            .map(|started_at| now.saturating_duration_since(started_at).as_secs_f64())
            .unwrap_or_default();
        (self.base_position + elapsed * self.state.speed).min(self.state.duration)
    }

    fn play(&mut self, now: Instant) -> Result<(), String> {
        if self.plan.events.is_empty() {
            return Err("Não há notas carregadas para reproduzir.".to_string());
        }
        if self.state.status == PlaybackStatus::Playing {
            return Ok(());
        }
        if matches!(
            self.state.status,
            PlaybackStatus::Ended | PlaybackStatus::Stopped
        ) {
            self.state.position = 0.0;
            self.state.current_event_index = 0;
        }
        self.base_position = self.state.position;
        self.started_at = Some(now);
        self.playback_generation = self.playback_generation.wrapping_add(1);
        self.state.status = PlaybackStatus::Playing;
        self.last_state_emit = now;
        Ok(())
    }

    fn pause(&mut self, now: Instant) {
        if self.state.status == PlaybackStatus::Playing {
            self.state.position = self.position_at(now);
            self.state.status = PlaybackStatus::Paused;
            self.started_at = None;
            self.playback_generation = self.playback_generation.wrapping_add(1);
        }
    }

    fn stop(&mut self) {
        self.playback_generation = self.playback_generation.wrapping_add(1);
        self.started_at = None;
        self.state.status = PlaybackStatus::Stopped;
        self.state.position = 0.0;
        self.state.current_event_index = 0;
    }

    fn seek(&mut self, position: f64) {
        self.playback_generation = self.playback_generation.wrapping_add(1);
        self.started_at = None;
        self.state.position = if position.is_finite() {
            position.clamp(0.0, self.state.duration)
        } else {
            0.0
        };
        self.state.current_event_index = self
            .plan
            .events
            .iter()
            .position(|event| event.time >= self.state.position)
            .unwrap_or(self.plan.events.len());
        self.state.status = PlaybackStatus::Paused;
    }

    fn set_speed(&mut self, speed: f64, now: Instant) {
        let next = if speed.is_finite() {
            speed.clamp(0.1, 4.0)
        } else {
            1.0
        };
        if self.state.status == PlaybackStatus::Playing {
            self.state.position = self.position_at(now);
            self.base_position = self.state.position;
            self.started_at = Some(now);
        }
        self.state.speed = next;
    }

    fn load(&mut self, plan: PlaybackPlan) {
        self.playback_generation = self.playback_generation.wrapping_add(1);
        self.keyboard_generation = self.keyboard_generation.wrapping_add(1);
        self.started_at = None;
        self.base_position = 0.0;
        self.plan = plan;
        self.state.status = PlaybackStatus::Idle;
        self.state.position = 0.0;
        self.state.duration = self.plan.duration;
        self.state.current_event_index = 0;
    }

    fn advance(&mut self, now: Instant) -> Advance {
        if self.state.status != PlaybackStatus::Playing {
            return Advance {
                due_events: Vec::new(),
                state_changed: false,
                ended: false,
            };
        }

        let position = self.position_at(now);
        let mut due_events = Vec::new();
        while self.state.current_event_index < self.plan.events.len() {
            let index = self.state.current_event_index;
            let event = &self.plan.events[index];
            if event.time > position + 0.000_001 {
                break;
            }
            let expected_at = self.event_deadline(event.time);
            due_events.push(DueEvent {
                index,
                event: event.clone(),
                late_by_ms: now.saturating_duration_since(expected_at).as_secs_f64() * 1000.0,
            });
            self.state.current_event_index += 1;
        }

        self.state.position = position;
        let ended = position >= self.state.duration;
        if ended {
            self.state.status = PlaybackStatus::Ended;
            self.started_at = None;
            self.state.position = self.state.duration;
            self.playback_generation = self.playback_generation.wrapping_add(1);
        }
        let state_changed = ended || now.duration_since(self.last_state_emit) >= STATE_INTERVAL;
        if state_changed {
            self.last_state_emit = now;
        }
        Advance {
            due_events,
            state_changed,
            ended,
        }
    }

    fn event_deadline(&self, event_time: f64) -> Instant {
        let start = self.started_at.unwrap_or_else(Instant::now);
        let seconds = ((event_time - self.base_position).max(0.0) / self.state.speed).max(0.0);
        start + Duration::try_from_secs_f64(seconds).unwrap_or(Duration::MAX)
    }
}

fn run_worker(app: AppHandle, receiver: mpsc::Receiver<Command>) {
    let now = Instant::now();
    let mut model = PlaybackModel::new(now);
    let mut waiter = PreciseWaiter::new();

    loop {
        loop {
            match receiver.try_recv() {
                Ok(command) => handle_command(&app, &mut model, command),
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return,
            }
        }

        let now = Instant::now();
        let advance = model.advance(now);
        for due in advance.due_events {
            let _ = input::event(input::KeyboardEvent {
                keys: due.event.keys.clone(),
                hold_ms: (due.event.hold * 1000.0).round().max(0.0) as u64,
                generation: model.keyboard_generation,
            });
            let _ = app.emit(
                "playback-event",
                PlaybackEventNotice {
                    event: &due.event,
                    index: due.index,
                    late_by_ms: due.late_by_ms,
                },
            );
        }

        if advance.ended {
            model.keyboard_generation = model.keyboard_generation.wrapping_add(1);
            input::reset(model.keyboard_generation);
        }
        if advance.state_changed {
            let _ = app.emit("playback-state", model.state.clone());
        }

        if model.state.status == PlaybackStatus::Playing {
            waiter.wait(COMMAND_POLL_INTERVAL);
        } else {
            match receiver.recv() {
                Ok(command) => handle_command(&app, &mut model, command),
                Err(_) => return,
            }
        }
    }
}

fn handle_command(app: &AppHandle, model: &mut PlaybackModel, command: Command) {
    match command {
        Command::Load(plan, reply) => {
            model.load(plan);
            input::release(model.keyboard_generation);
            let _ = app.emit("playback-state", model.state.clone());
            let _ = reply.send(model.state.clone());
        }
        Command::Play(reply) => {
            let result = model.play(Instant::now());
            if result.is_ok() {
                let _ = app.emit("playback-state", model.state.clone());
            }
            let _ = reply.send(result);
        }
        Command::Pause(reply) => {
            model.pause(Instant::now());
            model.keyboard_generation = model.keyboard_generation.wrapping_add(1);
            input::reset(model.keyboard_generation);
            let _ = app.emit("playback-state", model.state.clone());
            let _ = reply.send(());
        }
        Command::Stop(reply) => {
            model.stop();
            model.keyboard_generation = model.keyboard_generation.wrapping_add(1);
            input::reset(model.keyboard_generation);
            let _ = app.emit("playback-state", model.state.clone());
            let _ = reply.send(());
        }
        Command::Seek(position, reply) => {
            model.seek(position);
            model.keyboard_generation = model.keyboard_generation.wrapping_add(1);
            input::reset(model.keyboard_generation);
            let _ = app.emit("playback-state", model.state.clone());
            let _ = reply.send(());
        }
        Command::SetSpeed(speed, reply) => {
            model.set_speed(speed, Instant::now());
            let _ = app.emit("playback-state", model.state.clone());
            let _ = reply.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planner::{Key, PlaybackEvent};

    fn plan(times: &[f64]) -> PlaybackPlan {
        PlaybackPlan {
            events: times
                .iter()
                .map(|time| PlaybackEvent {
                    time: *time,
                    keys: vec![Key {
                        name: "A".to_string(),
                        modifier: None,
                        label: "A".to_string(),
                    }],
                    hold: 0.1,
                })
                .collect(),
            duration: times.last().copied().unwrap_or_default() + 0.1,
            stats: Default::default(),
        }
    }

    #[test]
    fn dispatch_deadlines_follow_absolute_times_for_five_ms_rolls() {
        let start = Instant::now();
        let mut model = PlaybackModel::new(start);
        model.load(plan(&[0.0, 0.005, 0.010, 0.025]));
        model.play(start).unwrap();

        let first = model.advance(start);
        assert_eq!(
            first
                .due_events
                .iter()
                .map(|event| event.index)
                .collect::<Vec<_>>(),
            [0]
        );
        let second = model.advance(start + Duration::from_millis(5));
        assert_eq!(
            second
                .due_events
                .iter()
                .map(|event| event.index)
                .collect::<Vec<_>>(),
            [1]
        );
        let third = model.advance(start + Duration::from_millis(10));
        assert_eq!(
            third
                .due_events
                .iter()
                .map(|event| event.index)
                .collect::<Vec<_>>(),
            [2]
        );
        assert_eq!(
            model.event_deadline(0.025),
            start + Duration::from_millis(25)
        );
    }

    #[test]
    fn late_callback_does_not_move_later_event_deadlines() {
        let start = Instant::now();
        let mut model = PlaybackModel::new(start);
        model.load(plan(&[0.0, 0.005, 0.010, 0.025]));
        model.play(start).unwrap();

        let late = model.advance(start + Duration::from_millis(12));
        assert_eq!(
            late.due_events
                .iter()
                .map(|event| event.index)
                .collect::<Vec<_>>(),
            [0, 1, 2]
        );
        assert_eq!(
            model.event_deadline(0.025),
            start + Duration::from_millis(25)
        );
        let last = model.advance(start + Duration::from_millis(25));
        assert_eq!(
            last.due_events
                .iter()
                .map(|event| event.index)
                .collect::<Vec<_>>(),
            [3]
        );
    }

    #[test]
    fn speed_pause_seek_and_stop_keep_state_aligned() {
        let start = Instant::now();
        let mut model = PlaybackModel::new(start);
        model.load(plan(&[0.0, 1.0, 2.0, 3.0]));
        model.play(start).unwrap();
        model.set_speed(2.0, start + Duration::from_millis(500));
        assert!((model.state.position - 0.5).abs() < 0.000_001);
        assert_eq!(
            model.event_deadline(2.0),
            start + Duration::from_millis(1250)
        );

        model.pause(start + Duration::from_millis(750));
        assert_eq!(model.state.status, PlaybackStatus::Paused);
        assert!((model.state.position - 1.0).abs() < 0.000_001);
        model.seek(2.5);
        assert_eq!(model.state.current_event_index, 3);
        model.stop();
        assert_eq!(model.state.position, 0.0);
        assert_eq!(model.state.status, PlaybackStatus::Stopped);
    }

    #[test]
    fn half_speed_keeps_absolute_event_deadlines() {
        let start = Instant::now();
        let mut model = PlaybackModel::new(start);
        model.load(plan(&[0.0, 1.0, 2.0]));
        model.play(start).unwrap();
        model.set_speed(0.5, start + Duration::from_millis(500));

        assert!((model.state.position - 0.5).abs() < 0.000_001);
        assert_eq!(
            model.event_deadline(2.0),
            start + Duration::from_millis(3500)
        );
    }

    #[test]
    fn completion_emits_ended_after_all_event_holds() {
        let start = Instant::now();
        let mut model = PlaybackModel::new(start);
        model.load(plan(&[0.0, 0.5]));
        model.play(start).unwrap();

        let advance = model.advance(start + Duration::from_millis(600));
        assert!(advance.ended);
        assert_eq!(model.state.status, PlaybackStatus::Ended);
        assert_eq!(model.state.current_event_index, 2);
    }
}
