export type Modifier = 'shift' | 'ctrl' | null

export type Key = {
    name: string
    modifier: Modifier
    label: string
}

export type MidiNote = {
    time: number
    pitch: number
    velocity: number
    duration: number
}

export type MappedNote = MidiNote & {
    mappedPitch: number
    key: Key
}

export type PlaybackEvent = {
    time: number
    keys: Key[]
    hold: number
}

export type PlaybackPlan = {
    events: PlaybackEvent[]
    duration: number
    stats: Record<string, number>
}

export type PlanConfig = {
    lowPitch: number
    highPitch: number
    transpose: number
    maxPoly: number
    holdMs: number
    chordWindowMs: number
    rollStepMs: number
}

const ROWS = ['ZXCVBNM', 'ASDFGHJ', 'QWERTYU']
const NATURAL_INDEX: Record<number, number> = {
    0: 0,
    2: 1,
    4: 2,
    5: 3,
    7: 4,
    9: 5,
    11: 6,
}

// This is the game's actual WWM spelling. In particular, C#/F#/G# use Shift
// on the preceding natural, while Eb/Bb use Ctrl on the following natural.
const ACCIDENTALS: Record<number, [number, Exclude<Modifier, null>]> = {
    1: [0, 'shift'],
    3: [2, 'ctrl'],
    6: [3, 'shift'],
    8: [4, 'shift'],
    10: [6, 'ctrl'],
}

export function mapPitch(
    pitch: number,
    lowPitch = 48,
    highPitch = 83,
): Key | null {
    if (!Number.isInteger(pitch) || pitch < lowPitch || pitch > highPitch)
        return null
    const offset = pitch - lowPitch
    const octave = Math.floor(offset / 12)
    const pitchClass = offset % 12
    const natural = NATURAL_INDEX[pitchClass]
    if (natural !== undefined) {
        const name = ROWS[octave]?.[natural]
        return name ? { name, modifier: null, label: name } : null
    }
    const accidental = ACCIDENTALS[pitchClass]
    const name = accidental && ROWS[octave]?.[accidental[0]]
    return name
        ? {
              name,
              modifier: accidental[1],
              label: `${accidental[1] === 'shift' ? '⇧' : '⌃'}${name}`,
          }
        : null
}

function chooseNotes<T extends MidiNote>(notes: T[], maxPoly: number): T[] {
    const unique = [
        ...new Map(notes.map((note) => [note.pitch, note])).values(),
    ].sort((a, b) => a.pitch - b.pitch)
    if (unique.length <= maxPoly) return unique
    if (maxPoly <= 1) return [unique.at(-1)!]
    const edges = [unique[0], unique.at(-1)!]
    const remaining = unique
        .filter((note) => !edges.includes(note))
        .sort((a, b) => b.velocity - a.velocity)
    return [...edges, ...remaining]
        .slice(0, maxPoly)
        .sort((a, b) => a.pitch - b.pitch)
}

export function buildPlaybackPlan(
    input: MidiNote[],
    config: PlanConfig,
): PlaybackPlan {
    if (!input.length)
        return {
            events: [],
            duration: 0,
            stats: {
                notes: 0,
                groups: 0,
                chords: 0,
                rolled: 0,
                shifted: 0,
                dropped: 0,
            },
        }
    const shift = 0
    const mapped: MappedNote[] = []
    let dropped = 0
    for (const note of input) {
        const mappedPitch = note.pitch + config.transpose + shift
        const key = mapPitch(mappedPitch, config.lowPitch, config.highPitch)
        if (!key) {
            dropped++
            continue
        }
        mapped.push({ ...note, mappedPitch, key })
    }
    mapped.sort((a, b) => a.time - b.time || a.mappedPitch - b.mappedPitch)

    const groups: MappedNote[][] = []
    for (const note of mapped) {
        const current = groups.at(-1)
        if (
            current &&
            (note.time - current[0].time) * 1000 <= config.chordWindowMs
        )
            current.push(note)
        else groups.push([note])
    }

    const events: PlaybackEvent[] = []
    let chords = 0
    let rolled = 0
    for (const group of groups) {
        const selected = chooseNotes(
            group,
            Math.max(1, Math.floor(config.maxPoly)),
        )
        if (selected.length > 1) chords++
        for (const [index, note] of selected.entries()) {
            const time =
                group[0].time +
                (selected.length > 1 ? (index * config.rollStepMs) / 1000 : 0)
            if (selected.length > 1) rolled++
            events.push({
                time,
                keys: [note.key],
                hold: Math.max(config.holdMs / 1000, note.duration),
            })
        }
        dropped += group.length - selected.length
    }
    events.sort((a, b) => a.time - b.time)
    const last = events.at(-1)
    const duration = last ? last.time + last.hold : 0
    return {
        events,
        duration,
        stats: {
            notes: input.length,
            groups: groups.length,
            chords,
            rolled,
            shift,
            dropped,
        },
    }
}
