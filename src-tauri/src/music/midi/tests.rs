use super::*;
use midly::{Header, TrackEvent};

fn event(delta: u32, kind: TrackEventKind<'static>) -> TrackEvent<'static> {
    TrackEvent {
        delta: delta.into(),
        kind,
    }
}
fn on(channel: u8, key: u8) -> TrackEventKind<'static> {
    TrackEventKind::Midi {
        channel: channel.into(),
        message: MidiMessage::NoteOn {
            key: key.into(),
            vel: 100.into(),
        },
    }
}
fn off(channel: u8, key: u8) -> TrackEventKind<'static> {
    TrackEventKind::Midi {
        channel: channel.into(),
        message: MidiMessage::NoteOff {
            key: key.into(),
            vel: 0.into(),
        },
    }
}
fn encode(format: Format, timing: Timing, mut tracks: Vec<Vec<TrackEvent<'static>>>) -> Vec<u8> {
    for track in &mut tracks {
        track.push(event(0, TrackEventKind::Meta(MetaMessage::EndOfTrack)));
    }
    let smf = Smf {
        header: Header::new(format, timing),
        tracks,
    };
    let mut bytes = Vec::new();
    smf.write_std(&mut bytes).unwrap();
    bytes
}
pub(crate) fn fixture_bytes() -> Vec<u8> {
    encode(
        Format::Parallel,
        Timing::Metrical(480.into()),
        vec![
            vec![
                event(
                    0,
                    TrackEventKind::Meta(MetaMessage::Tempo(1_000_000.into())),
                ),
                event(
                    480,
                    TrackEventKind::Meta(MetaMessage::Tempo(500_000.into())),
                ),
            ],
            vec![
                event(0, TrackEventKind::Meta(MetaMessage::TrackName(b"Piano"))),
                event(480, on(0, 60)),
                event(480, off(0, 60)),
            ],
            vec![
                event(0, TrackEventKind::Meta(MetaMessage::Text(b"Flute/Piccolo"))),
                event(
                    0,
                    TrackEventKind::Midi {
                        channel: 1.into(),
                        message: MidiMessage::ProgramChange { program: 73.into() },
                    },
                ),
                event(0, on(1, 96)),
                event(240, off(1, 96)),
                event(240, on(1, 72)),
                event(1440, off(1, 72)),
            ],
            vec![event(0, on(9, 36)), event(120, off(9, 36))],
            vec![event(
                0,
                TrackEventKind::Meta(MetaMessage::Text(b"Credits only")),
            )],
        ],
    )
}
#[test]
fn parts_keep_names_channels_global_tempo_range_and_original_timeline() {
    let doc = read_document(&fixture_bytes()).unwrap();
    assert_eq!(doc.parts.len(), 3);
    assert_eq!(doc.notes.len(), 4);
    assert_eq!(doc.parts[0].name, "Piano");
    assert_eq!(doc.parts[1].name, "Flute/Piccolo");
    assert_eq!(doc.parts[1].instrument.as_deref(), Some("Flute"));
    assert_eq!(doc.parts[1].note_count, 2);
    assert_eq!(doc.parts[1].playable_note_count, 1);
    assert!(doc.parts[2].percussion);
    assert_eq!(doc.parts[2].channel, 10);
    let all = doc.selection(None).unwrap();
    assert_eq!(all.selected_part_ids.len(), 3);
    let piano = doc.plan(&[doc.parts[0].id.clone()]);
    assert_eq!(piano.events.len(), 1);
    assert_eq!(piano.events[0].time, 1.0);
    assert_eq!(piano.duration, doc.duration);
    assert!(doc.duration >= 2.5);
    let silence = doc.plan(&[]);
    assert!(silence.events.is_empty());
    assert_eq!(silence.duration, piano.duration);
    assert!(doc.selection(Some(&["invalid".into()])).is_err());
}
#[test]
fn single_track_files_split_by_channel_and_fallback_to_instruments() {
    let bytes = encode(
        Format::SingleTrack,
        Timing::Metrical(480.into()),
        vec![vec![
            event(
                0,
                TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::ProgramChange { program: 40.into() },
                },
            ),
            event(0, on(0, 60)),
            event(0, on(2, 64)),
            event(480, off(0, 60)),
            event(0, off(2, 64)),
        ]],
    );
    let doc = read_document(&bytes).unwrap();
    assert_eq!(doc.parts.len(), 2);
    assert_eq!(doc.parts[0].name, "Violin");
    assert_eq!(doc.parts[1].name, "Parte 2");
    assert_eq!(doc.parts[0].track_index, doc.parts[1].track_index);
    assert_ne!(doc.parts[0].id, doc.parts[1].id);
}
#[test]
fn overlapping_same_channel_and_pitch_keep_their_track_ownership() {
    let bytes = encode(
        Format::Parallel,
        Timing::Metrical(480.into()),
        vec![
            vec![event(0, on(0, 60)), event(960, off(0, 60))],
            vec![event(240, on(0, 60)), event(240, off(0, 60))],
        ],
    );
    let doc = read_document(&bytes).unwrap();
    assert_eq!(doc.parts.len(), 2);
    assert_eq!(doc.notes[0].part_id, "0:0");
    assert_eq!(doc.notes[0].note.duration, 1.0);
    assert_eq!(doc.notes[1].part_id, "1:0");
    assert_eq!(doc.notes[1].note.duration, 0.25);
}
#[test]
fn cross_track_releases_and_velocity_zero_are_supported() {
    let bytes = encode(
        Format::Parallel,
        Timing::Metrical(480.into()),
        vec![
            vec![event(0, on(0, 60))],
            vec![event(
                480,
                TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::NoteOn {
                        key: 60.into(),
                        vel: 0.into(),
                    },
                },
            )],
        ],
    );
    let doc = read_document(&bytes).unwrap();
    assert_eq!(doc.parts.len(), 1);
    assert_eq!(doc.notes[0].part_id, "0:0");
    assert_eq!(doc.notes[0].note.duration, 0.5);
}
#[test]
fn unsupported_timing_and_format_have_explicit_errors() {
    let tracks = vec![vec![event(0, on(0, 60)), event(480, off(0, 60))]];
    let sequential = encode(
        Format::Sequential,
        Timing::Metrical(480.into()),
        tracks.clone(),
    );
    assert!(read_document(&sequential)
        .unwrap_err()
        .contains("formato 2"));
    let timecode = encode(
        Format::SingleTrack,
        Timing::Timecode(midly::Fps::Fps24, 80),
        tracks,
    );
    assert!(read_document(&timecode).unwrap_err().contains("timecode"));
}
