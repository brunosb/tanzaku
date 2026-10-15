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
    let mut result = Vec::new();
    let mut consumed = vec![false; frames * 88];

    for time in 0..frames.saturating_sub(1) {
        for pitch in 0..88 {
            let index = time * 88 + pitch;
            let value = onset[index];
            if value < ONSET_THRESHOLD
                || (time > 0 && onset[(time - 1) * 88 + pitch] > value)
                || onset[(time + 1) * 88 + pitch] > value
                || consumed[index]
            {
                continue;
            }

            let mut end = time + 1;
            let mut quiet = 0;
            while end < frames {
                if note[end * 88 + pitch] < FRAME_THRESHOLD {
                    quiet += 1;
                    if quiet >= 11 {
                        break;
                    }
                } else {
                    quiet = 0;
                }
                end += 1;
            }
            end = end.saturating_sub(quiet);
            if end.saturating_sub(time) < MIN_NOTE_FRAMES {
                continue;
            }

            let mut energy = 0.0;
            for frame in time..end {
                energy += note[frame * 88 + pitch];
                consumed[frame * 88 + pitch] = true;
            }
            let average = energy / (end - time) as f32;
            result.push(NoteEvent {
                start_frame: time,
                end_frame: end,
                pitch: (pitch + 21) as u8,
                velocity: (average.clamp(0.0, 1.0) * 127.0).round() as u8,
            });
        }
    }
    result.sort_by_key(|note| (note.start_frame, note.pitch));
    result
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
        onset[0] = 0.9;
        for frame in 0..frames {
            note[frame * 88] = 0.8;
        }

        let decoded = decode_notes(&note, &onset, frames);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].pitch, 21);
        assert_eq!(decoded[0].start_frame, 0);
        assert_eq!(decoded[0].end_frame, frames);
    }
}
