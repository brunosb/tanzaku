use super::{
    planner::build_playback_plan,
    types::{MidiNote, MidiPart, MidiParts, PlaybackPlan},
};
use midly::{Format, MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};

#[derive(Debug, Clone)]
pub(crate) struct PartNote {
    pub part_id: String,
    pub note: MidiNote,
}
#[derive(Debug, Clone)]
pub(crate) struct MidiDocument {
    pub notes: Vec<PartNote>,
    pub parts: Vec<MidiPart>,
    pub duration: f64,
}
impl MidiDocument {
    pub fn selection(&self, selected: Option<&[String]>) -> Result<MidiParts, String> {
        let ids = selected.map(|ids| ids.iter().cloned().collect::<BTreeSet<_>>());
        if ids.as_ref().is_some_and(|ids| {
            ids.iter()
                .any(|id| !self.parts.iter().any(|part| &part.id == id))
        }) {
            return Err("A seleção contém uma parte que não existe neste MIDI.".into());
        }
        Ok(MidiParts {
            parts: self.parts.clone(),
            selected_part_ids: self
                .parts
                .iter()
                .filter(|part| ids.as_ref().is_none_or(|ids| ids.contains(&part.id)))
                .map(|part| part.id.clone())
                .collect(),
        })
    }
    pub fn plan(&self, selected: &[String]) -> PlaybackPlan {
        let selected = selected.iter().collect::<BTreeSet<_>>();
        let notes = self
            .notes
            .iter()
            .filter(|n| selected.contains(&n.part_id))
            .map(|n| n.note.clone())
            .collect::<Vec<_>>();
        let mut plan = build_playback_plan(&notes);
        plan.duration = self.duration;
        plan
    }
}

struct RawEvent {
    tick: u64,
    track: usize,
    channel: u8,
    key: u8,
    velocity: u8,
    up: bool,
}
#[derive(Default)]
struct Labels {
    name: Option<String>,
    instrument: Option<String>,
    text: Option<String>,
    programs: BTreeMap<u8, BTreeSet<u8>>,
}
fn label(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8(bytes.to_vec())
        .unwrap_or_else(|_| bytes.iter().map(|&b| char::from(b)).collect());
    let text = text
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    (!text.is_empty()).then_some(text)
}

pub(crate) fn read_document(bytes: &[u8]) -> Result<MidiDocument, String> {
    let smf = Smf::parse(bytes).map_err(|error| format!("MIDI inválido: {error}"))?;
    if smf.header.format == Format::Sequential {
        return Err("MIDI formato 2 contém músicas independentes e não é suportado.".into());
    }
    let ppq = match smf.header.timing {
        Timing::Metrical(value) if value.as_int() > 0 => u64::from(value.as_int()),
        Timing::Metrical(_) => return Err("MIDI com resolução temporal inválida.".into()),
        Timing::Timecode(_, _) => return Err("MIDI com timecode não é suportado.".into()),
    };
    let mut events = Vec::new();
    let mut tempos = vec![(0_u64, 500_000_u32)];
    let mut labels = Vec::new();
    let mut channel_programs: BTreeMap<u8, BTreeSet<u8>> = BTreeMap::new();
    for (track_index, track) in smf.tracks.iter().enumerate() {
        let mut tick = 0_u64;
        let mut names = Labels::default();
        for event in track {
            tick += u64::from(event.delta.as_int());
            match event.kind {
                TrackEventKind::Meta(MetaMessage::Tempo(value)) => {
                    if value.as_int() == 0 {
                        return Err("MIDI com andamento inválido.".into());
                    }
                    tempos.push((tick, value.as_int()));
                }
                TrackEventKind::Meta(MetaMessage::TrackName(bytes)) => {
                    if names.name.is_none() {
                        names.name = label(bytes);
                    }
                }
                TrackEventKind::Meta(MetaMessage::InstrumentName(bytes)) => {
                    if names.instrument.is_none() {
                        names.instrument = label(bytes);
                    }
                }
                TrackEventKind::Meta(MetaMessage::Text(bytes)) => {
                    if names.text.is_none() {
                        names.text = label(bytes);
                    }
                }
                TrackEventKind::Midi { channel, message } => {
                    let channel = channel.as_int();
                    match message {
                        MidiMessage::NoteOn { key, vel } => events.push(RawEvent {
                            tick,
                            track: track_index,
                            channel,
                            key: key.as_int(),
                            velocity: vel.as_int(),
                            up: vel.as_int() == 0,
                        }),
                        MidiMessage::NoteOff { key, .. } => events.push(RawEvent {
                            tick,
                            track: track_index,
                            channel,
                            key: key.as_int(),
                            velocity: 0,
                            up: true,
                        }),
                        MidiMessage::ProgramChange { program } => {
                            names
                                .programs
                                .entry(channel)
                                .or_default()
                                .insert(program.as_int());
                            channel_programs
                                .entry(channel)
                                .or_default()
                                .insert(program.as_int());
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        labels.push(names);
    }
    tempos.sort_by_key(|tempo| tempo.0);
    let mut segments = Vec::new();
    let (mut previous, mut elapsed, mut current) = (0_u64, 0.0, 500_000_u32);
    for (tick, tempo) in tempos {
        elapsed += (tick - previous) as f64 * f64::from(current) / ppq as f64 / 1_000_000.0;
        segments.push((tick, elapsed, tempo));
        previous = tick;
        current = tempo;
    }
    let seconds = |tick: u64| {
        let index = segments.partition_point(|segment| segment.0 <= tick) - 1;
        let (start, elapsed, tempo) = segments[index];
        elapsed + (tick - start) as f64 * f64::from(tempo) / ppq as f64 / 1_000_000.0
    };
    events.sort_by_key(|event| (event.tick, !event.up));
    type Active = HashMap<(usize, u8, u8), VecDeque<(f64, f64)>>;
    let mut active = Active::new();
    let mut notes = Vec::new();
    for event in events {
        let time = seconds(event.tick);
        let key = (event.track, event.channel, event.key);
        if !event.up {
            active
                .entry(key)
                .or_default()
                .push_back((time, f64::from(event.velocity) / 127.0));
        } else {
            // Releases usually belong to the same track. Cross-track releases
            // still belong to the track that originally attacked the note.
            let owner = if active.get(&key).is_some_and(|starts| !starts.is_empty()) {
                Some(key)
            } else {
                active
                    .iter()
                    .filter(|((_, channel, pitch), starts)| {
                        *channel == event.channel && *pitch == event.key && !starts.is_empty()
                    })
                    .min_by(|a, b| a.1[0].0.total_cmp(&b.1[0].0).then_with(|| a.0.cmp(b.0)))
                    .map(|(key, _)| *key)
            };
            if let Some(owner) = owner {
                let (start, velocity) = active.get_mut(&owner).unwrap().pop_front().unwrap();
                notes.push(PartNote {
                    part_id: format!("{}:{}", owner.0, owner.1),
                    note: MidiNote {
                        time: start,
                        pitch: i32::from(event.key),
                        velocity,
                        duration: (time - start).max(0.0),
                    },
                });
            }
        }
    }
    notes.sort_by(|a, b| a.note.time.total_cmp(&b.note.time));
    let mut grouped: HashMap<&str, Vec<&PartNote>> = HashMap::new();
    for note in &notes {
        grouped.entry(&note.part_id).or_default().push(note);
    }
    let mut parts = Vec::new();
    for (track_index, names) in labels.into_iter().enumerate() {
        for channel in 0..16 {
            let id = format!("{track_index}:{channel}");
            let Some(part_notes) = grouped.get(id.as_str()) else {
                continue;
            };
            let percussion = channel == 9;
            let programs = names
                .programs
                .get(&channel)
                .or_else(|| channel_programs.get(&channel));
            let instrument = if percussion {
                Some("Percussão".to_string())
            } else {
                programs.map(|programs| {
                    if programs.len() == 1 {
                        super::instruments::name(*programs.first().unwrap()).to_string()
                    } else {
                        "Múltiplos timbres".into()
                    }
                })
            };
            let name = names
                .name
                .as_ref()
                .or(names.instrument.as_ref())
                .or(names.text.as_ref())
                .cloned()
                .or_else(|| instrument.clone())
                .unwrap_or_else(|| format!("Parte {}", parts.len() + 1));
            parts.push(MidiPart {
                id,
                track_index: track_index + 1,
                channel: channel + 1,
                name,
                instrument,
                percussion,
                note_count: part_notes.len(),
                playable_note_count: part_notes
                    .iter()
                    .filter(|n| (48..=83).contains(&n.note.pitch))
                    .count(),
                start_time: part_notes[0].note.time,
            });
        }
    }
    // Six rolled attacks and their minimum hold must fit in every subset, so
    // muting parts cannot change the end or strand a scheduled key release.
    let duration = notes
        .iter()
        .map(|n| n.note.time + n.note.duration.max(0.03) + 0.025)
        .fold(0.0, f64::max);
    Ok(MidiDocument {
        notes,
        parts,
        duration,
    })
}

pub fn read_notes(bytes: &[u8]) -> Result<Vec<MidiNote>, String> {
    Ok(read_document(bytes)?
        .notes
        .into_iter()
        .map(|n| n.note)
        .collect())
}

#[cfg(test)]
pub(crate) mod tests;
