use super::{
    controller::{Action, Command},
    events::Publisher,
    keyboard::{Device, Keyboard},
    loader::{load, LoadSpec, StartMode, WorkerConfig},
    model::{empty_plan, Model},
    types::*,
};
use crate::platform::timing::PreciseWaiter;
use std::{
    sync::mpsc::{self, Sender},
    time::{Duration, Instant},
};
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
pub(super) fn run_worker(
    app: impl Publisher,
    receiver: mpsc::Receiver<Command>,
    sender: Sender<Command>,
    device: impl Device,
    config: WorkerConfig,
) {
    let mut m = Model::new(Instant::now());
    match &config.auto_advance {
        Ok(enabled) => m.state.auto_advance_enabled = *enabled,
        Err(error) => m.state.error = Some(error.clone()),
    }
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
                    start,
                    reply,
                } => {
                    if token != m.token || !m.pending {
                        if let Some(reply) = reply {
                            let _ = reply.send(Err("Carregamento cancelado.".to_string()));
                        }
                        continue;
                    }
                    m.pending = false;
                    m.automatic_pending = false;
                    let result = result.and_then(|p| {
                        release(&mut m, &mut k, start != StartMode::Continue)?;
                        m.install(p);
                        if start == StartMode::Countdown {
                            m.countdown = Some(Instant::now() + config.countdown);
                            m.state.status = PlaybackStatus::Countdown;
                            m.state.countdown_remaining = 5;
                        }
                        if start == StartMode::Continue {
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
                        m.state.pause_reason = Some("load-error".to_string());
                        let _ = release(&mut m, &mut k, true);
                        publish(&app, &mut m, &k, true);
                    }
                    if let Some(reply) = reply {
                        let _ = reply.send(result);
                    }
                }
                Command::Request(action, reply) => {
                    if m.pending && matches!(action, Action::Shuffle(_)) {
                        let _ = reply.send(Err("Aguarde o carregamento.".to_string()));
                        continue;
                    }
                    let request = match &action {
                        Action::Load(id, context) => Some((
                            LoadSpec::Context(
                                id.clone(),
                                context
                                    .clone()
                                    .unwrap_or(QueueInput::Library { track_ids: vec![] }),
                                m.shuffle_enabled,
                            ),
                            StartMode::Loaded,
                            None,
                        )),
                        Action::Playlist(id, random) => Some((
                            LoadSpec::Playlist(id.clone(), *random),
                            StartMode::Countdown,
                            None,
                        )),
                        Action::Previous | Action::Next => {
                            if m.pending {
                                let _ = reply.send(Err("Aguarde o carregamento.".to_string()));
                                continue;
                            }
                            let forward = matches!(action, Action::Next);
                            let Some(queue) = m
                                .queue
                                .as_ref()
                                .and_then(|queue| queue.step(forward, m.state.repeat_enabled))
                            else {
                                let _ = reply.send(Ok(m.snapshot()));
                                continue;
                            };
                            let resume = matches!(
                                m.state.status,
                                PlaybackStatus::Playing | PlaybackStatus::Countdown
                            ) || (m.state.status == PlaybackStatus::Paused
                                && m.state.pause_reason.as_deref() == Some("focus-lost"));
                            Some((
                                LoadSpec::Track(queue.current().to_string()),
                                if resume {
                                    StartMode::Countdown
                                } else {
                                    StartMode::Loaded
                                },
                                Some(queue),
                            ))
                        }
                        _ => None,
                    };
                    if let Some((spec, start, queue)) = request {
                        m.state.position = m.position(Instant::now());
                        m.cancel();
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
                            spec,
                            start,
                            Some(reply),
                            queue,
                        );
                        continue;
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
                                plan_changed = true;
                            }
                            Action::AutoAdvance(enabled) => {
                                m.state.auto_advance_enabled = enabled;
                                if !enabled && m.automatic_pending {
                                    m.cancel();
                                    m.state.status = PlaybackStatus::Ended;
                                    release(&mut m, &mut k, true)?;
                                }
                            }
                            Action::Shuffle(enabled) => {
                                m.shuffle_enabled = enabled;
                                if let (Some(queue), Some(track)) = (&mut m.queue, &m.track) {
                                    queue.set_shuffle(enabled, &track.id);
                                }
                                plan_changed = true;
                            }
                            Action::RenamePlaylist(id, name) => {
                                m.renamed_playlists.insert(id.clone(), name.clone());
                                if let Some(playlist) =
                                    m.queue.as_mut().and_then(|queue| queue.playlist.as_mut())
                                {
                                    if playlist.id == id {
                                        playlist.name = name;
                                        plan_changed = true;
                                    }
                                }
                            }
                            Action::Clear | Action::Shutdown => {
                                m.cancel();
                                m.queue = None;
                                m.renamed_tracks.clear();
                                m.renamed_playlists.clear();
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
                                if m.pending {
                                    m.pause(Instant::now(), None);
                                    release(&mut m, &mut k, true)?;
                                }
                                if m.track.as_ref().is_some_and(|t| t.id == id) {
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
                                } else if let Some(queue) = &mut m.queue {
                                    queue.remove(&id);
                                    plan_changed = true;
                                }
                            }
                            Action::Rename(id, title) => {
                                m.renamed_tracks.insert(id.clone(), title.clone());
                                if let Some(queue) = &mut m.queue {
                                    queue.rename(&id, &title);
                                    plan_changed = true;
                                }
                                if let Some(t) = &mut m.track {
                                    if t.id == id {
                                        t.title = title;
                                        plan_changed = true;
                                    }
                                }
                            }
                            Action::Snapshot => {}
                            Action::Load(_, _)
                            | Action::Playlist(_, _)
                            | Action::Previous
                            | Action::Next => unreachable!(),
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
                    m.automatic_pending = true;
                    m.state.status = PlaybackStatus::Loading;
                    load(
                        &sender,
                        &config.loader,
                        m.token,
                        LoadSpec::Track(id),
                        StartMode::Continue,
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
