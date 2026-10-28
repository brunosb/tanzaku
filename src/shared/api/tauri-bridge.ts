import {
    type DispatchTiming,
    initialState,
    type LibraryEntry,
    type PlaybackEvent,
    type PlaybackPlan,
    type PlaybackState,
    type Snapshot,
    type TanzakuApi,
    type TauriGlobal,
    type Track,
    type YoutubeProgress,
} from './contracts'

// Injectable boundary also used by the bridge regression tests; no playback timers.
export function createBridge(tauri: TauriGlobal): TanzakuApi {
    let state = initialState()
    let plan: PlaybackPlan = { events: [], duration: 0 }
    let track: Track | null = null
    let planGeneration = -1
    let refreshing: Promise<void> | undefined
    let youtube: { id: string; canceled: boolean } | undefined
    const states = new Set<(v: PlaybackState) => void>()
    const plans = new Set<(v: PlaybackPlan) => void>()
    const tracks = new Set<(v: Track | null) => void>()
    const countdowns = new Set<(v: { remaining: number }) => void>()
    const events = new Set<
        (v: PlaybackEvent, i: number, timing: DispatchTiming) => void
    >()
    const progress = new Set<(v: YoutubeProgress) => void>()
    const emitState = () => {
        for (const fn of states)
            fn({ ...state, activeEventIndices: [...state.activeEventIndices] })
        for (const fn of countdowns) fn({ remaining: state.countdownRemaining })
    }
    const acceptState = (next: PlaybackState) => {
        if (next.sequence < state.sequence || next.generation < planGeneration)
            return
        if (next.generation > planGeneration) {
            void refresh().catch(console.error)
            return
        }
        state = next
        emitState()
    }
    const acceptSnapshot = (next: Snapshot) => {
        if (next.state.generation < planGeneration) return
        const changed = next.state.generation !== planGeneration
        if (!changed && next.state.sequence < state.sequence) return
        planGeneration = next.state.generation
        plan = next.plan
        const trackChanged =
            track?.id !== next.track?.id || track?.title !== next.track?.title
        track = next.track
        state = next.state
        if (trackChanged || changed) for (const fn of tracks) fn(track)
        if (changed) for (const fn of plans) fn(plan)
        emitState()
    }
    const refresh = (): Promise<void> => {
        if (!refreshing)
            refreshing = tauri.core
                .invoke<Snapshot>('playback_get_snapshot')
                .then(acceptSnapshot)
                .finally(() => {
                    refreshing = undefined
                })
        return refreshing
    }
    const ready = Promise.all([
        tauri.event.listen<PlaybackState>('playback-state', (e) =>
            acceptState(e.payload),
        ),
        tauri.event.listen<Snapshot>('playback-plan', (e) =>
            acceptSnapshot(e.payload),
        ),
        tauri.event.listen<{
            generation: number
            sequence: number
            index: number
            lateByMs: number
            sendMs: number
        }>('playback-event', ({ payload: v }) => {
            if (v.generation !== planGeneration || v.sequence < state.sequence)
                return
            const event = plan.events[v.index]
            if (event) for (const fn of events) fn(event, v.index, v)
        }),
        tauri.event.listen<YoutubeProgress>(
            'youtube-progress',
            ({ payload: v }) => {
                if (youtube?.id === v.jobId && !youtube.canceled)
                    for (const fn of progress) fn(v)
            },
        ),
    ]).then(async () => {
        // Rust persists the selected root. Browser storage is no longer a second authority.
        await refresh()
    })
    const invoke = async <T>(
        command: string,
        args?: Record<string, unknown>,
    ): Promise<T> => {
        await ready
        return tauri.core.invoke<T>(command, args)
    }
    const load = async (id: string) => {
        const result = await invoke<PlaybackPlan>('playback_load', { id })
        await refresh()
        return result
    }
    const subscription =
        <T>(set: Set<(value: T) => void>, current?: () => T) =>
        (fn: (value: T) => void) => {
            set.add(fn)
            if (current) fn(current())
            return () => {
                set.delete(fn)
            }
        }
    const api: TanzakuApi = {
        ready,
        window: tauri.window.getCurrentWindow(),
        library: {
            list: () => invoke('library_list'),
            open: load,
            rename: async (id, title) => {
                const e = await invoke<LibraryEntry>('library_rename', {
                    id,
                    title,
                })
                await refresh()
                return e
            },
            remove: async (id) => {
                const result = await invoke<LibraryEntry[]>('library_delete', {
                    id,
                })
                await refresh()
                return result
            },
            import: () => invoke('library_import'),
            addYoutube: async (url) => {
                if (youtube)
                    throw new Error('Já existe uma conversão em andamento.')
                const job = { id: crypto.randomUUID(), canceled: false }
                youtube = job
                try {
                    await ready
                    if (job.canceled) throw new Error('Conversão cancelada.')
                    return await tauri.core.invoke<LibraryEntry>(
                        'library_add_youtube',
                        { url, jobId: job.id },
                    )
                } finally {
                    if (youtube === job) youtube = undefined
                }
            },
            cancelYoutube: async () => {
                if (youtube) {
                    youtube.canceled = true
                    await invoke('youtube_cancel', { jobId: youtube.id })
                }
            },
        },
        playback: {
            load,
            play: () => invoke('playback_start'),
            pause: () => invoke('playback_pause'),
            stop: () => invoke('playback_stop'),
            seek: (position, resume = false) =>
                invoke('playback_seek', { position, resume }),
            setSpeed: (speed) => invoke('playback_set_speed', { speed }),
            toggleRepeat: () => invoke('playback_toggle_repeat'),
            onState: subscription(states, () => ({ ...state })),
            onPlan: subscription(plans, () => plan),
            onCountdown: subscription(countdowns, () => ({
                remaining: state.countdownRemaining,
            })),
            onEvent: (fn) => {
                events.add(fn)
                return () => {
                    events.delete(fn)
                }
            },
        },
        playlists: {
            list: () => invoke('playlist_list'),
            create: (name) => invoke('playlist_create', { name }),
            rename: (id, name) => invoke('playlist_rename', { id, name }),
            remove: (id) => invoke('playlist_delete', { id }),
            add: (playlistId, trackId) =>
                invoke('playlist_add', { playlistId, trackId }),
            addMany: (playlistId, trackIds) =>
                invoke('playlist_add_tracks', { playlistId, trackIds }),
            reorder: (playlistId, trackIds) =>
                invoke('playlist_reorder', { playlistId, trackIds }),
            removeTrack: (playlistId, trackId) =>
                invoke('playlist_remove_track', { playlistId, trackId }),
            play: (id, mode) => invoke('playlist_play', { id, mode }),
        },
        onTrack: subscription(tracks, () => track),
        onYoutubeProgress: subscription(progress),
        settings: {
            get: () => invoke('settings_get'),
            update: (value) => invoke('settings_update', { value }),
        },
        storage: {
            chooseDirectory: async (path) => {
                const result = await invoke<string | null>(
                    path ? 'storage_set_directory' : 'storage_choose_directory',
                    path ? { path } : undefined,
                )
                if (result) await refresh()
                return result
            },
        },
        transcription: {
            modelInfo: () => invoke('transcription_model_info'),
            inferWav: (path) => invoke('transcription_infer_wav', { path }),
            wavToMidi: (wavPath, midiPath) =>
                invoke('transcription_wav_to_midi', { wavPath, midiPath }),
        },
    }
    return api
}
if (typeof window !== 'undefined' && window.__TAURI__) {
    window.tanzaku = createBridge(window.__TAURI__)
    void window.tanzaku.ready
        .then(() => window.tanzaku.transcription.modelInfo())
        .then((value) => console.info('Basic Pitch ONNX carregado:', value))
        .catch((error) => console.error('Inicialização:', error))
}
