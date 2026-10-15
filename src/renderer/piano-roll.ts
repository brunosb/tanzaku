export type PianoRollNote = {
    time: number
    duration: number
    label: string
    modifier: 'shift' | 'ctrl' | null
}

export function pianoRollClass(modifier: PianoRollNote['modifier']): string {
    return modifier ?? 'natural'
}
