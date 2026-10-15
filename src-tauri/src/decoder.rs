use midly::{
    num::u28, Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind,
};
use std::path::Path;

const FFT_HOP: f32 = 256.0;
const SAMPLE_RATE: f32 = 22_050.0;
const FRAME_RATE: f32 = SAMPLE_RATE / FFT_HOP;
const ONSET_THRESHOLD: f32 = 0.5;
const FRAME_THRESHOLD: f32 = 0.3;
const MIN_NOTE_FRAMES: usize = 9;

#[derive(Debug, Clone)]
pub struct NoteEvent {
    pub start_frame: usize,
    pub end_frame: usize,
    pub pitch: u8,
    pub velocity: u8,
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
        let energy = mean_pitch(&note, frames, start, end, pitch);
        erase_pitch_band(&mut remaining_energy, frames, start, end, pitch);
        result.push(make_note(start, end, pitch, energy));
    }

    // Basic Pitch's melodia trick repeatedly starts a note at the strongest
    // remaining activation, even if the model did not emit an onset there.
    loop {
        let Some((middle, pitch, peak)) = max_activation(&remaining_energy, frames) else {
            break;
        };
        if peak <= FRAME_THRESHOLD {
            break;
        }
        remaining_energy[middle * 88 + pitch] = 0.0;

        let end = extend_forward(&mut remaining_energy, frames, middle, pitch);
        let start = extend_backward(&mut remaining_energy, frames, middle, pitch);
        if end.saturating_sub(start) <= MIN_NOTE_FRAMES {
            continue;
        }
        let energy = mean_pitch(&note, frames, start, end, pitch);
        result.push(make_note(start, end, pitch, energy));
    }

    result.sort_by_key(|note| (note.start_frame, note.pitch));
    result
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
        .chunks_exact(88)
        .take(frames)
        .enumerate()
        .flat_map(|(time, row)| {
            row.iter()
                .copied()
                .enumerate()
                .map(move |(pitch, value)| (time, pitch, value))
        })
        .max_by(|left, right| left.2.total_cmp(&right.2))
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
    }
}

pub fn write_midi(path: &Path, notes: &[NoteEvent]) -> Result<(), String> {
    let ticks_per_beat = 480_u32;
    let ticks_per_second = 960.0_f32;
    let mut events = Vec::with_capacity(notes.len() * 2 + 2);
    events.push((
        0_u32,
        TrackEventKind::Meta(MetaMessage::Tempo(500_000.into())),
    ));
    for note in notes {
        let start = ((note.start_frame as f32 / FRAME_RATE) * ticks_per_second).round() as u32;
        let end = ((note.end_frame as f32 / FRAME_RATE) * ticks_per_second).round() as u32;
        events.push((
            start,
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
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOff {
                    key: note.pitch.into(),
                    vel: 0.into(),
                },
            },
        ));
    }
    events.sort_by_key(|event| event.0);

    let mut track = Vec::with_capacity(events.len() + 1);
    let mut previous = 0;
    for (absolute, kind) in events {
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
