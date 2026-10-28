use midly::{
    num::u28, Format, Header, MetaMessage, MidiMessage, PitchBend, Smf, Timing, TrackEvent,
    TrackEventKind,
};
use std::path::Path;

const FFT_HOP: f32 = 256.0;
const SAMPLE_RATE: f32 = 22_050.0;
const ONSET_THRESHOLD: f32 = 0.5;
const FRAME_THRESHOLD: f32 = 0.3;
const MIN_NOTE_FRAMES: usize = 11;

#[derive(Debug, Clone)]
pub struct NoteEvent {
    pub start_frame: usize,
    pub end_frame: usize,
    pub pitch: u8,
    pub velocity: u8,
    pub pitch_bends: Vec<(usize, i16)>,
}

pub fn decode_notes(note: &[f32], onset: &[f32], frames: usize) -> Vec<NoteEvent> {
    let onsets = infer_onsets(onset, note, frames);
    let mut remaining_energy = note.to_vec();
    let mut result = Vec::new();
    let mut peaks = Vec::new();

    for time in 1..frames.saturating_sub(1) {
        for pitch in 0..88 {
            let index = time * 88 + pitch;
            if onsets[index] > onsets[(time - 1) * 88 + pitch]
                && onsets[index] > onsets[(time + 1) * 88 + pitch]
                && onsets[index] >= ONSET_THRESHOLD
            {
                peaks.push((time, pitch, onsets[index]));
            }
        }
    }
    peaks.sort_by_key(|(time, pitch, _)| (std::cmp::Reverse(*time), std::cmp::Reverse(*pitch)));

    for (start, pitch, _) in peaks {
        let end = find_note_end(&remaining_energy, frames, start, pitch);
        if end.saturating_sub(start) <= MIN_NOTE_FRAMES {
            continue;
        }
        let energy = mean_pitch(note, frames, start, end, pitch);
        erase_pitch_band(&mut remaining_energy, frames, start, end, pitch);
        result.push(make_note(start, end, pitch, energy));
    }

    // Basic Pitch's melodia trick repeatedly starts a note at the strongest
    // remaining activation, even if the model did not emit an onset there.
    while let Some((middle, pitch, peak)) = max_activation(&remaining_energy, frames) {
        if peak <= FRAME_THRESHOLD {
            break;
        }
        remaining_energy[middle * 88 + pitch] = 0.0;

        let end = extend_forward(&mut remaining_energy, frames, middle, pitch);
        let start = extend_backward(&mut remaining_energy, frames, middle, pitch);
        if end.saturating_sub(start) <= MIN_NOTE_FRAMES {
            continue;
        }
        let energy = mean_pitch(note, frames, start, end, pitch);
        result.push(make_note(start, end, pitch, energy));
    }

    result.sort_by_key(|note| (note.start_frame, note.pitch));
    result
}

pub fn add_pitch_bends(notes: &mut [NoteEvent], contour: &[f32], frames: usize) {
    for index in 0..notes.len() {
        let overlaps = notes.iter().enumerate().any(|(other, candidate)| {
            other != index
                && candidate.start_frame < notes[index].end_frame
                && notes[index].start_frame < candidate.end_frame
        });
        if overlaps {
            continue;
        }

        let note = &mut notes[index];
        let contour_pitch = contour_bin(note.pitch);
        let start = note.start_frame.min(frames);
        let end = note.end_frame.min(frames);
        for time in start..end {
            let mut best = f32::MIN;
            let mut best_offset = 0_i16;
            for offset in -25_i16..=25 {
                let bin = contour_pitch + offset as isize;
                if !(0..264).contains(&bin) {
                    continue;
                }
                let value = contour[time * 264 + bin as usize]
                    * (-0.5 * (offset as f32 / 5.0).powi(2)).exp();
                if value > best {
                    best = value;
                    best_offset = offset;
                }
            }
            note.pitch_bends.push((time, best_offset));
        }
    }
}

fn contour_bin(midi_pitch: u8) -> isize {
    let frequency = 440.0 * 2.0_f32.powf((midi_pitch as f32 - 69.0) / 12.0);
    (36.0 * (frequency / 27.5).log2()).round() as isize
}

fn infer_onsets(onset: &[f32], frames: &[f32], n_frames: usize) -> Vec<f32> {
    let max_onset = onset.iter().copied().fold(0.0_f32, f32::max);
    let mut differences = vec![f32::INFINITY; n_frames * 88];
    for offset in 1..=2 {
        for time in 0..n_frames {
            for pitch in 0..88 {
                let index = time * 88 + pitch;
                let previous = if time >= offset {
                    frames[(time - offset) * 88 + pitch]
                } else {
                    0.0
                };
                differences[index] = differences[index].min(frames[index] - previous);
            }
        }
    }
    for value in &mut differences {
        *value = value.max(0.0);
    }
    for time in 0..2.min(n_frames) {
        for pitch in 0..88 {
            differences[time * 88 + pitch] = 0.0;
        }
    }
    let max_difference = differences.iter().copied().fold(0.0_f32, f32::max);
    if max_difference > 0.0 {
        for value in &mut differences {
            *value *= max_onset / max_difference;
        }
    }
    onset
        .iter()
        .zip(differences)
        .map(|(predicted, inferred)| predicted.max(inferred))
        .collect()
}

fn find_note_end(energy: &[f32], frames: usize, start: usize, pitch: usize) -> usize {
    let mut index = start + 1;
    let mut quiet = 0;
    while index < frames.saturating_sub(1) && quiet < 11 {
        if energy[index * 88 + pitch] < FRAME_THRESHOLD {
            quiet += 1;
        } else {
            quiet = 0;
        }
        index += 1;
    }
    index.saturating_sub(quiet)
}

fn erase_pitch_band(energy: &mut [f32], _frames: usize, start: usize, end: usize, pitch: usize) {
    for time in start..end {
        for nearby in pitch.saturating_sub(1)..=(pitch + 1).min(87) {
            energy[time * 88 + nearby] = 0.0;
        }
    }
}

fn extend_forward(energy: &mut [f32], frames: usize, middle: usize, pitch: usize) -> usize {
    let mut index = middle + 1;
    let mut quiet = 0;
    while index < frames.saturating_sub(1) && quiet < 11 {
        if energy[index * 88 + pitch] < FRAME_THRESHOLD {
            quiet += 1;
        } else {
            quiet = 0;
        }
        erase_pitch_band(energy, frames, index, index + 1, pitch);
        index += 1;
    }
    index.saturating_sub(1 + quiet)
}

fn extend_backward(energy: &mut [f32], frames: usize, middle: usize, pitch: usize) -> usize {
    let mut index = middle as isize - 1;
    let mut quiet = 0;
    while index > 0 && quiet < 11 {
        let time = index as usize;
        if energy[time * 88 + pitch] < FRAME_THRESHOLD {
            quiet += 1;
        } else {
            quiet = 0;
        }
        erase_pitch_band(energy, frames, time, time + 1, pitch);
        index -= 1;
    }
    (index + 1 + quiet as isize).max(0) as usize
}

fn max_activation(energy: &[f32], frames: usize) -> Option<(usize, usize, f32)> {
    energy
        .as_chunks::<88>()
        .0
        .iter()
        .take(frames)
        .enumerate()
        .flat_map(|(time, row)| {
            row.iter()
                .copied()
                .enumerate()
                .map(move |(pitch, value)| (time, pitch, value))
        })
        .max_by(|left, right| {
            left.2
                .total_cmp(&right.2)
                .then_with(|| right.0.cmp(&left.0))
                .then_with(|| right.1.cmp(&left.1))
        })
}

fn mean_pitch(energy: &[f32], _frames: usize, start: usize, end: usize, pitch: usize) -> f32 {
    let length = end.saturating_sub(start).max(1);
    (start..end)
        .map(|time| energy[time * 88 + pitch])
        .sum::<f32>()
        / length as f32
}

fn make_note(start: usize, end: usize, pitch: usize, energy: f32) -> NoteEvent {
    NoteEvent {
        start_frame: start,
        end_frame: end,
        pitch: (pitch + 21) as u8,
        velocity: (energy.clamp(0.0, 1.0) * 127.0).round() as u8,
        pitch_bends: Vec::new(),
    }
}

pub fn frame_time(frame: usize) -> f64 {
    let hop = FFT_HOP as f64 / SAMPLE_RATE as f64;
    let window_offset = hop * (172.0 - 43_844.0 / FFT_HOP as f64) + 0.0018;
    frame as f64 * hop - window_offset * (frame / 172) as f64
}
pub fn write_midi(path: &Path, notes: &[NoteEvent]) -> Result<(), String> {
    let ticks_per_beat = 480_u32;
    let ticks_per_second = 960.0_f64;
    let mut events = Vec::with_capacity(notes.len() * 4 + 2);
    events.push((
        0_u32,
        0_u8,
        TrackEventKind::Meta(MetaMessage::Tempo(500_000.into())),
    ));
    for note in notes {
        let start = (frame_time(note.start_frame) * ticks_per_second).round() as u32;
        let end = (frame_time(note.end_frame) * ticks_per_second).round() as u32;
        for (frame, bend) in &note.pitch_bends {
            let time = (frame_time(*frame) * ticks_per_second).round() as u32;
            events.push((
                time,
                0_u8,
                TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::PitchBend {
                        bend: PitchBend::from_int(
                            ((*bend as f64 * 4096.0 / 3.0).round() as i32).clamp(-8192, 8191)
                                as i16,
                        ),
                    },
                },
            ));
        }
        events.push((
            start,
            1_u8,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOn {
                    key: note.pitch.into(),
                    vel: note.velocity.max(1).into(),
                },
            },
        ));
        events.push((
            end.max(start + 1),
            2_u8,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOff {
                    key: note.pitch.into(),
                    vel: 0.into(),
                },
            },
        ));
    }
    events.sort_by_key(|event| (event.0, event.1));

    let mut track = Vec::with_capacity(events.len() + 1);
    let mut previous = 0;
    for (absolute, _, kind) in events {
        track.push(TrackEvent {
            delta: u28::new(absolute.saturating_sub(previous)),
            kind,
        });
        previous = absolute;
    }
    track.push(TrackEvent {
        delta: 0.into(),
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });

    let smf = Smf {
        header: Header::new(
            Format::SingleTrack,
            Timing::Metrical((ticks_per_beat as u16).into()),
        ),
        tracks: vec![track],
    };
    let mut bytes = Vec::new();
    smf.write_std(&mut bytes)
        .map_err(|error| format!("Não foi possível gerar o MIDI: {error}"))?;
    std::fs::write(path, bytes).map_err(|error| format!("Não foi possível salvar o MIDI: {error}"))
}

#[cfg(test)]
mod tests {
    use super::decode_notes;

    #[test]
    fn decodes_a_sustained_note_from_onset_and_frames() {
        let frames = 20;
        let mut note = vec![0.0_f32; frames * 88];
        let mut onset = vec![0.0_f32; frames * 88];
        onset[2 * 88] = 0.9;
        for frame in 0..frames {
            note[frame * 88] = 0.8;
        }

        let decoded = decode_notes(&note, &onset, frames);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].pitch, 21);
        assert_eq!(decoded[0].start_frame, 2);
        assert_eq!(decoded[0].end_frame, frames - 1);
    }
}

#[cfg(test)]
mod reference_tests {
    use super::*;
    #[test]
    fn matches_basic_pitch_040_controlled_tensors_and_midi_ticks() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/basic-pitch-0.4.0.json"
        )))
        .unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let frames = case["frames"].as_u64().unwrap() as usize;
            let mut note = vec![0.0_f32; frames * 88];
            let mut onset = note.clone();
            for band in case["bands"].as_array().unwrap() {
                for t in band[0].as_u64().unwrap()..band[1].as_u64().unwrap() {
                    note[t as usize * 88 + band[2].as_u64().unwrap() as usize] =
                        band[3].as_f64().unwrap() as f32;
                }
            }
            for v in case["onsets"].as_array().unwrap() {
                onset[v[0].as_u64().unwrap() as usize * 88 + v[1].as_u64().unwrap() as usize] =
                    v[2].as_f64().unwrap() as f32;
            }
            let notes = decode_notes(&note, &onset, frames);
            let expected = case["expected"].as_array().unwrap();
            assert_eq!(notes.len(), expected.len(), "{}", case["name"]);
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("out.mid");
            write_midi(&path, &notes).unwrap();
            let bytes = std::fs::read(path).unwrap();
            let parsed = crate::music::midi::read_notes(&bytes).unwrap();
            for ((actual, e), midi) in notes.iter().zip(expected).zip(parsed) {
                assert_eq!(
                    (
                        actual.start_frame,
                        actual.end_frame,
                        actual.pitch,
                        actual.velocity
                    ),
                    (
                        e["start"].as_u64().unwrap() as usize,
                        e["end"].as_u64().unwrap() as usize,
                        e["pitch"].as_u64().unwrap() as u8,
                        e["velocity"].as_u64().unwrap() as u8
                    ),
                    "{}",
                    case["name"]
                );
                assert!((midi.time * 960.0 - e["startTick"].as_f64().unwrap()).abs() <= 1.0);
                assert!(
                    ((midi.time + midi.duration) * 960.0 - e["endTick"].as_f64().unwrap()).abs()
                        <= 1.0
                );
            }
        }
    }
    #[test]
    fn extreme_bends_keep_sign_and_saturate_before_cast() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bend.mid");
        write_midi(
            &path,
            &[NoteEvent {
                start_frame: 1,
                end_frame: 30,
                pitch: 60,
                velocity: 100,
                pitch_bends: vec![(1, 25), (2, -25)],
            }],
        )
        .unwrap();
        let bytes = std::fs::read(path).unwrap();
        let smf = Smf::parse(&bytes).unwrap();
        let bends = smf.tracks[0]
            .iter()
            .filter_map(|e| match e.kind {
                TrackEventKind::Midi {
                    message: MidiMessage::PitchBend { bend },
                    ..
                } => Some(bend.as_int()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(bends, [8191, -8192]);
    }
}
