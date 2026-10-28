use std::collections::HashMap;

use midly::{MidiMessage, Smf, Timing, TrackEventKind};

use crate::music::types::MidiNote;

#[derive(Clone)]
struct RawEvent {
    tick: u64,
    order: u8,
    channel: u8,
    key: u8,
    message: MidiMessage,
}

pub fn read_notes(bytes: &[u8]) -> Result<Vec<MidiNote>, String> {
    let smf = Smf::parse(bytes).map_err(|error| format!("MIDI inválido: {error}"))?;
    let ppq = match smf.header.timing {
        Timing::Metrical(value) => value.as_int() as u64,
        Timing::Timecode(_, _) => return Err("MIDI com timecode não é suportado.".to_string()),
    };
    let mut events = Vec::new();
    let mut tempos = vec![(0_u64, 500_000_u32)];
    for track in &smf.tracks {
        let mut tick = 0_u64;
        for event in track {
            tick += event.delta.as_int() as u64;
            match event.kind {
                TrackEventKind::Meta(midly::MetaMessage::Tempo(value)) => {
                    tempos.push((tick, value.as_int()));
                }
                TrackEventKind::Midi { channel, message } => match message {
                    MidiMessage::NoteOn { key, vel } if vel.as_int() > 0 => events.push(RawEvent {
                        tick,
                        order: 1,
                        channel: channel.as_int(),
                        key: key.as_int(),
                        message: MidiMessage::NoteOn { key, vel },
                    }),
                    MidiMessage::NoteOn { key, vel } => events.push(RawEvent {
                        tick,
                        order: 0,
                        channel: channel.as_int(),
                        key: key.as_int(),
                        message: MidiMessage::NoteOn { key, vel },
                    }),
                    MidiMessage::NoteOff { key, vel } => events.push(RawEvent {
                        tick,
                        order: 0,
                        channel: channel.as_int(),
                        key: key.as_int(),
                        message: MidiMessage::NoteOff { key, vel },
                    }),
                    _ => {}
                },
                _ => {}
            }
        }
    }
    tempos.sort_by_key(|tempo| tempo.0);
    events.sort_by_key(|event| (event.tick, event.order));
    let seconds = |tick: u64| -> f64 {
        let mut elapsed = 0.0;
        let mut previous_tick = 0_u64;
        let mut tempo = 500_000_u32;
        for &(tempo_tick, next_tempo) in &tempos {
            if tempo_tick > tick {
                break;
            }
            elapsed +=
                (tempo_tick - previous_tick) as f64 * tempo as f64 / ppq as f64 / 1_000_000.0;
            previous_tick = tempo_tick;
            tempo = next_tempo;
        }
        elapsed + (tick - previous_tick) as f64 * tempo as f64 / ppq as f64 / 1_000_000.0
    };

    let mut active: HashMap<(u8, u8), Vec<(f64, f64)>> = HashMap::new();
    let mut notes = Vec::new();
    for event in events {
        let time = seconds(event.tick);
        match event.message {
            MidiMessage::NoteOn { vel, .. } if vel.as_int() > 0 => {
                active
                    .entry((event.channel, event.key))
                    .or_default()
                    .push((time, vel.as_int() as f64 / 127.0));
            }
            MidiMessage::NoteOn { .. } | MidiMessage::NoteOff { .. } => {
                if let Some(starts) = active.get_mut(&(event.channel, event.key)) {
                    if !starts.is_empty() {
                        let (start, velocity) = starts.remove(0);
                        notes.push(MidiNote {
                            time: start,
                            pitch: event.key as i32,
                            velocity,
                            duration: (time - start).max(0.0),
                        });
                    }
                }
            }
            _ => {}
        }
    }
    notes.sort_by(|left, right| left.time.total_cmp(&right.time));
    Ok(notes)
}
