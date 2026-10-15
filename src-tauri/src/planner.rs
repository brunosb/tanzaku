use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Clone)]
pub struct MidiNote {
    pub time: f64,
    pub pitch: i32,
    pub velocity: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Key {
    pub name: String,
    pub modifier: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaybackEvent {
    pub time: f64,
    pub keys: Vec<Key>,
    pub hold: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaybackPlan {
    pub events: Vec<PlaybackEvent>,
    pub duration: f64,
    pub stats: BTreeMap<String, f64>,
}

const ROWS: [&str; 3] = ["ZXCVBNM", "ASDFGHJ", "QWERTYU"];

pub fn map_pitch(pitch: i32, low_pitch: i32, high_pitch: i32) -> Option<Key> {
    if pitch < low_pitch || pitch > high_pitch {
        return None;
    }
    let offset = pitch - low_pitch;
    let octave = (offset / 12) as usize;
    let pitch_class = offset % 12;
    let natural_index = match pitch_class {
        0 => Some(0),
        2 => Some(1),
        4 => Some(2),
        5 => Some(3),
        7 => Some(4),
        9 => Some(5),
        11 => Some(6),
        _ => None,
    };
    if let Some(index) = natural_index {
        let name = ROWS.get(octave)?.chars().nth(index)?.to_string();
        return Some(Key {
            name: name.clone(),
            modifier: None,
            label: name,
        });
    }

    let accidental = match pitch_class {
        1 => Some((0, "shift")),
        3 => Some((2, "ctrl")),
        6 => Some((3, "shift")),
        8 => Some((4, "shift")),
        10 => Some((6, "ctrl")),
        _ => None,
    }?;
    let name = ROWS.get(octave)?.chars().nth(accidental.0)?.to_string();
    Some(Key {
        name: name.clone(),
        modifier: Some(accidental.1.to_string()),
        label: format!(
            "{}{}",
            if accidental.1 == "shift" {
                "⇧"
            } else {
                "⌃"
            },
            name
        ),
    })
}

fn choose_notes(notes: &[MidiNote], max_poly: usize) -> Vec<MidiNote> {
    let mut unique = BTreeMap::new();
    for note in notes {
        unique.insert(note.pitch, note.clone());
    }
    let mut values = unique.into_values().collect::<Vec<_>>();
    values.sort_by_key(|note| note.pitch);
    if values.len() <= max_poly {
        return values;
    }
    if max_poly <= 1 {
        return values.into_iter().rev().take(1).collect();
    }
    let first = values.first().cloned().expect("notes are not empty");
    let last = values.last().cloned().expect("notes are not empty");
    let mut remaining = values[1..values.len() - 1].to_vec();
    remaining.sort_by(|left, right| right.velocity.total_cmp(&left.velocity));
    let mut selected = vec![first, last];
    selected.extend(remaining.into_iter().take(max_poly - 2));
    selected.sort_by_key(|note| note.pitch);
    selected
}

pub fn build_playback_plan(input: &[MidiNote]) -> PlaybackPlan {
    let mut stats = BTreeMap::new();
    if input.is_empty() {
        for key in ["notes", "groups", "chords", "rolled", "shifted", "dropped"] {
            stats.insert(key.to_string(), 0.0);
        }
        return PlaybackPlan {
            events: Vec::new(),
            duration: 0.0,
            stats,
        };
    }

    let mut mapped = Vec::new();
    let mut dropped = 0;
    for note in input {
        if let Some(key) = map_pitch(note.pitch, 48, 83) {
            mapped.push((note.clone(), key));
        } else {
            dropped += 1;
        }
    }
    mapped.sort_by(|left, right| {
        left.0
            .time
            .total_cmp(&right.0.time)
            .then(left.0.pitch.cmp(&right.0.pitch))
    });

    let mut groups: Vec<Vec<(MidiNote, Key)>> = Vec::new();
    for note in mapped {
        if let Some(current) = groups.last_mut() {
            if (note.0.time - current[0].0.time) * 1000.0 <= 20.0 {
                current.push(note);
                continue;
            }
        }
        groups.push(vec![note]);
    }

    let mut events = Vec::new();
    let mut chords = 0;
    let mut rolled = 0;
    for group in &groups {
        let notes = group.iter().map(|item| item.0.clone()).collect::<Vec<_>>();
        let selected = choose_notes(&notes, 6);
        if selected.len() > 1 {
            chords += 1;
        }
        for (index, note) in selected.iter().enumerate() {
            let key = group
                .iter()
                .find(|item| item.0.pitch == note.pitch)
                .map(|item| item.1.clone())
                .expect("selected note must have a mapped key");
            let time = group[0].0.time
                + if selected.len() > 1 {
                    index as f64 * 0.005
                } else {
                    0.0
                };
            if selected.len() > 1 {
                rolled += 1;
            }
            events.push(PlaybackEvent {
                time,
                keys: vec![key],
                hold: 0.03_f64.max(note.duration),
            });
        }
        dropped += group.len() as i32 - selected.len() as i32;
    }
    events.sort_by(|left, right| left.time.total_cmp(&right.time));
    let duration = events
        .last()
        .map(|event| event.time + event.hold)
        .unwrap_or(0.0);
    stats.insert("notes".to_string(), input.len() as f64);
    stats.insert("groups".to_string(), groups.len() as f64);
    stats.insert("chords".to_string(), chords as f64);
    stats.insert("rolled".to_string(), rolled as f64);
    stats.insert("shift".to_string(), 0.0);
    stats.insert("dropped".to_string(), dropped.max(0) as f64);
    PlaybackPlan {
        events,
        duration,
        stats,
    }
}
