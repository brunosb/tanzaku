export type Key = {
    name: string
    modifier: 'shift' | 'ctrl' | null
    label: string
}
export type PlaybackEvent = { time: number; hold: number; keys: Key[] }
export type PlaybackPlan = {
    duration: number
    events: PlaybackEvent[]
    stats?: Record<string, number>
}
export type MidiPart = {
    id: string
    trackIndex: number
    channel: number
    name: string
    instrument: string | null
    percussion: boolean
    noteCount: number
    playableNoteCount: number
    startTime: number
}
export type MidiParts = { parts: MidiPart[]; selectedPartIds: string[] }
export type PlaybackState = {
    status:
        | 'idle'
        | 'loading'
        | 'countdown'
        | 'waiting-for-game'
        | 'playing'
        | 'paused'
        | 'stopped'
        | 'ended'
    position: number
    duration: number
    speed: number
    currentEventIndex: number
    generation: number
    sequence: number
    activeEventIndices: number[]
    countdownRemaining: number
    repeatEnabled: boolean
    autoAdvanceEnabled: boolean
    backgroundPlaybackEnabled: boolean
    pauseReason: string | null
    error: string | null
}
export type DispatchTiming = {
    lateByMs: number
    sendMs: number
    generation: number
    sequence: number
}
export type Track = { id: string; title: string }
export type LibraryEntry = Track & {
    file: string
    sourceUrl?: string | null
    duration?: number | null
    addedAt?: string | null
    selectedPartIds?: string[] | null
}
export type ImportReport = {
    imported: LibraryEntry[]
    failed: { fileName: string; error: string }[]
}
export type Playlist = {
    id: string
    name: string
    trackIds: string[]
    createdAt?: string
}
export type PlaybackSource =
    | { kind: 'library'; trackIds: string[] }
    | { kind: 'playlist'; playlistId: string }
export type PlaybackQueue = {
    source: 'library' | 'playlist'
    playlist: { id: string; name: string } | null
    mode: 'order' | 'shuffle'
    index: number
    total: number
    previous: Track | null
    next: Track | null
}
export type Snapshot = {
    state: PlaybackState
    track: Track | null
    plan: PlaybackPlan
    queue: PlaybackQueue | null
    midiParts?: MidiParts | null
}
export type YoutubeProgress = {
    jobId: string
    stage: string
    percent: number | null
}
type Subscription<T> = (listener: (value: T) => void) => () => void
export type ShortcutAction =
    | 'pause'
    | 'stop'
    | 'play'
    | 'previous'
    | 'next'
    | 'seekBackward'
    | 'seekForward'
export type AppSettings = {
    storageRoot: string
    startMode: 'game-focus' | 'countdown'
    shortcuts: Record<ShortcutAction, string | null>
    shortcutWarnings?: string[]
    [key: string]: unknown
}
export type AppInfo = {
    name: string
    version: string
    author: string
    repositoryUrl: string
    license: string
}
export type TanzakuApi = {
    ready: Promise<void>
    app: {
        info(): Promise<AppInfo>
        openProjectLink(target: 'repository' | 'issues'): Promise<void>
    }
    window: {
        minimize(): Promise<void>
        toggleMaximize(): Promise<void>
        close(): Promise<void>
    }
    library: {
        list(): Promise<LibraryEntry[]>
        open(id: string, context?: PlaybackSource): Promise<PlaybackPlan>
        rename(id: string, title: string): Promise<LibraryEntry>
        remove(id: string): Promise<LibraryEntry[]>
        import(): Promise<LibraryEntry | null>
        importMany(): Promise<ImportReport | null>
        addYoutube(url: string): Promise<LibraryEntry>
        cancelYoutube(): Promise<void>
    }
    playback: {
        load(id: string, context?: PlaybackSource): Promise<PlaybackPlan>
        previous(): Promise<void>
        next(): Promise<void>
        setShuffle(enabled: boolean): Promise<void>
        setAutoAdvance(enabled: boolean): Promise<void>
        setBackgroundPlayback(enabled: boolean): Promise<void>
        play(): Promise<void>
        pause(): Promise<void>
        stop(): Promise<void>
        seek(position: number, resume?: boolean): Promise<void>
        setSpeed(speed: number): Promise<void>
        setMidiParts(trackId: string, partIds: string[]): Promise<void>
        onMidiParts: Subscription<MidiParts | null>
        toggleRepeat(): Promise<boolean>
        onState: Subscription<PlaybackState>
        onPlan: Subscription<PlaybackPlan>
        onQueue: Subscription<PlaybackQueue | null>
        onCountdown: Subscription<{ remaining: number }>
        onEvent(
            listener: (
                event: PlaybackEvent,
                index: number,
                timing: DispatchTiming,
            ) => void,
        ): () => void
    }
    playlists: {
        list(): Promise<Playlist[]>
        create(name: string): Promise<Playlist>
        rename(id: string, name: string): Promise<Playlist>
        remove(id: string): Promise<Playlist[]>
        add(playlistId: string, trackId: string): Promise<Playlist>
        addMany(playlistId: string, trackIds: string[]): Promise<Playlist>
        reorder(playlistId: string, trackIds: string[]): Promise<Playlist>
        removeTrack(playlistId: string, trackId: string): Promise<Playlist>
        play(id: string, mode: 'order' | 'shuffle'): Promise<void>
    }
    onTrack: Subscription<Track | null>
    onYoutubeProgress: Subscription<YoutubeProgress>
    settings: {
        get(): Promise<AppSettings>
        update(settings: Record<string, unknown>): Promise<AppSettings>
    }
    storage: { chooseDirectory(path?: string): Promise<string | null> }
    transcription: {
        modelInfo(): Promise<unknown>
        inferWav(path: string): Promise<unknown>
        wavToMidi(wavPath: string, midiPath: string): Promise<unknown>
    }
}
export function initialState(): PlaybackState {
    return {
        status: 'idle',
        position: 0,
        duration: 0,
        speed: 1,
        currentEventIndex: 0,
        generation: 0,
        sequence: 0,
        activeEventIndices: [],
        countdownRemaining: 0,
        repeatEnabled: false,
        autoAdvanceEnabled: false,
        backgroundPlaybackEnabled: true,
        pauseReason: null,
        error: null,
    }
}
export type TauriGlobal = {
    core: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
    }
    event: {
        listen<T>(
            event: string,
            handler: (event: { payload: T }) => void,
        ): Promise<() => void>
    }
    window: { getCurrentWindow(): TanzakuApi['window'] }
}
declare global {
    interface Window {
        __TAURI__?: TauriGlobal
        tanzaku: TanzakuApi
    }
}
