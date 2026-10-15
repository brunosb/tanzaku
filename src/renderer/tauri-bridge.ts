type TauriGlobal = {
    core: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
    }
    window: {
        getCurrentWindow(): {
            minimize(): Promise<void>
            toggleMaximize(): Promise<void>
            close(): Promise<void>
        }
    }
    event: {
        listen<T>(
            event: string,
            handler: (event: { payload: T }) => void,
        ): Promise<() => void>
    }
}

export {}

declare global {
    interface Window {
        __TAURI__?: TauriGlobal
        tanzaku: any
    }
}

const tauri = window.__TAURI__

if (!tauri) throw new Error('API Tauri não disponível.')

const currentWindow = tauri.window.getCurrentWindow()
const storedStorageRoot = localStorage.getItem('tanzaku.storageRoot')
let storageReady: Promise<unknown> = storedStorageRoot
    ? tauri.core.invoke('storage_set_directory', { path: storedStorageRoot })
    : Promise.resolve()

const chooseStorageDirectory = async (path?: string) => {
    const directory = path
        ? await tauri.core.invoke<string>('storage_set_directory', { path })
        : await tauri.core.invoke<string | null>('storage_choose_directory')
    if (directory) {
        localStorage.setItem('tanzaku.storageRoot', directory)
        storageReady = Promise.resolve(directory)
    }
    return directory
}

const emptyUnsubscribe = () => () => undefined

type PlaybackPlan = {
    duration: number
    events: Array<{ time: number; hold: number; keys: unknown[] }>
    stats?: Record<string, number>
}

type PlaybackState = {
    status: 'idle' | 'playing' | 'paused' | 'stopped' | 'ended'
    position: number
    duration: number
    speed: number
    currentEventIndex: number
}

const playbackState: PlaybackState = {
    status: 'idle',
    position: 0,
    duration: 0,
    speed: 1,
    currentEventIndex: 0,
}
let playbackPlan: PlaybackPlan = { events: [], duration: 0 }
let playbackStartedAt = 0
let playbackGeneration = 0
let playbackEventTimer: ReturnType<typeof setTimeout> | undefined
let playbackTickTimer: ReturnType<typeof setTimeout> | undefined
const stateListeners = new Set<(state: PlaybackState) => void>()
const eventListeners = new Set<(event: unknown, index: number) => void>()
const countdownListeners = new Set<(value: { remaining: number }) => void>()
let countdownGeneration = 0
let playlistQueue: string[] = []
let playlistQueueIndex = -1
const trackListeners = new Set<(track: { id: string; title: string }) => void>()

const emitCountdown = (remaining: number) => {
    for (const listener of countdownListeners) listener({ remaining })
}

const emitPlaybackState = () => {
    const snapshot = { ...playbackState }
    for (const listener of stateListeners) listener(snapshot)
}

const clearPlaybackTimers = () => {
    if (playbackEventTimer) clearTimeout(playbackEventTimer)
    if (playbackTickTimer) clearTimeout(playbackTickTimer)
    playbackEventTimer = undefined
    playbackTickTimer = undefined
}

const playbackPosition = () => {
    if (playbackState.status !== 'playing') return playbackState.position
    const elapsed =
        ((performance.now() - playbackStartedAt) / 1000) * playbackState.speed
    return Math.max(0, Math.min(playbackState.duration, elapsed))
}

const finishPlayback = () => {
    clearPlaybackTimers()
    playbackState.position = playbackState.duration
    if (
        playlistQueueIndex >= 0 &&
        playlistQueueIndex + 1 < playlistQueue.length
    ) {
        playlistQueueIndex++
        const nextId = playlistQueue[playlistQueueIndex]
        void loadTrack(nextId)
            .then(() => startPlayback())
            .catch((error) => {
                playlistQueue = []
                playlistQueueIndex = -1
                console.error('Falha ao avançar a playlist:', error)
            })
        return
    }
    playlistQueue = []
    playlistQueueIndex = -1
    playbackState.status = 'ended'
    emitPlaybackState()
}

const schedulePlayback = (generation: number) => {
    if (generation !== playbackGeneration || playbackState.status !== 'playing')
        return
    const position = playbackPosition()
    while (
        playbackState.currentEventIndex < playbackPlan.events.length &&
        playbackPlan.events[playbackState.currentEventIndex].time <=
            position + 0.000001
    ) {
        const index = playbackState.currentEventIndex++
        const event = playbackPlan.events[index]
        void tauri.core.invoke('keyboard_event', {
            event: {
                keys: event.keys,
                hold_ms: Math.max(0, Math.round(event.hold * 1000)),
            },
        })
        for (const listener of eventListeners) listener(event, index)
    }
    const next = playbackPlan.events[playbackState.currentEventIndex]
    if (next)
        playbackEventTimer = setTimeout(
            () => schedulePlayback(generation),
            Math.max(1, ((next.time - position) / playbackState.speed) * 1000),
        )
}

const schedulePlaybackTick = (generation: number) => {
    if (generation !== playbackGeneration || playbackState.status !== 'playing')
        return
    playbackState.position = playbackPosition()
    if (playbackState.position >= playbackState.duration) {
        finishPlayback()
        return
    }
    emitPlaybackState()
    playbackTickTimer = setTimeout(() => schedulePlaybackTick(generation), 33)
}

const loadPlaybackPlan = (plan: PlaybackPlan) => {
    clearPlaybackTimers()
    countdownGeneration++
    emitCountdown(0)
    playbackGeneration++
    playbackPlan = plan
    playbackState.status = 'idle'
    playbackState.position = 0
    playbackState.duration = plan.duration
    playbackState.currentEventIndex = 0
    emitPlaybackState()
}

const loadTrack = async (id: string) => {
    const plan = await tauri.core.invoke<PlaybackPlan>('playback_load', { id })
    loadPlaybackPlan(plan)
    const entries =
        await tauri.core.invoke<Array<{ id: string; title: string }>>(
            'library_list',
        )
    const entry = entries.find((item) => item.id === id)
    if (entry) {
        for (const listener of trackListeners) listener(entry)
    }
    return plan
}

const startPlayback = async () => {
    if (!playbackPlan.events.length || playbackState.status === 'playing')
        return
    const countdown = ++countdownGeneration
    for (let remaining = 5; remaining > 0; remaining--) {
        emitCountdown(remaining)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (countdown !== countdownGeneration) return
    }
    emitCountdown(0)
    const armed = await tauri.core.invoke<boolean>('keyboard_arm')
    if (!armed) throw new Error('Não foi possível armar a janela do jogo.')
    if (
        playbackState.status === 'ended' ||
        playbackState.status === 'stopped'
    ) {
        playbackState.position = 0
        playbackState.currentEventIndex = 0
    }
    playbackState.status = 'playing'
    playbackStartedAt =
        performance.now() -
        (playbackState.position / playbackState.speed) * 1000
    const generation = ++playbackGeneration
    emitPlaybackState()
    schedulePlayback(generation)
    schedulePlaybackTick(generation)
}

const pausePlayback = () => {
    if (playbackState.status !== 'playing') return
    countdownGeneration++
    emitCountdown(0)
    playbackState.position = playbackPosition()
    playbackState.status = 'paused'
    clearPlaybackTimers()
    playbackGeneration++
    void tauri.core.invoke('keyboard_reset')
    emitPlaybackState()
}

const stopPlayback = () => {
    clearPlaybackTimers()
    countdownGeneration++
    emitCountdown(0)
    playbackGeneration++
    playbackState.status = 'stopped'
    playbackState.position = 0
    playbackState.currentEventIndex = 0
    void tauri.core.invoke('keyboard_reset')
    emitPlaybackState()
}

const seekPlayback = (position: number) => {
    clearPlaybackTimers()
    countdownGeneration++
    emitCountdown(0)
    playbackGeneration++
    void tauri.core.invoke('keyboard_reset')
    playbackState.position = Math.max(
        0,
        Math.min(playbackState.duration, Number(position) || 0),
    )
    playbackState.currentEventIndex = playbackPlan.events.findIndex(
        (event) => event.time >= playbackState.position,
    )
    if (playbackState.currentEventIndex < 0)
        playbackState.currentEventIndex = playbackPlan.events.length
    playbackState.status = 'paused'
    emitPlaybackState()
}

const setPlaybackSpeed = (speed: number) => {
    const next = Math.max(0.1, Math.min(4, Number(speed) || 1))
    if (playbackState.status === 'playing') {
        playbackState.position = playbackPosition()
        playbackStartedAt =
            performance.now() - (playbackState.position / next) * 1000
        clearPlaybackTimers()
        const generation = ++playbackGeneration
        schedulePlayback(generation)
        schedulePlaybackTick(generation)
    }
    playbackState.speed = next
    emitPlaybackState()
}

window.tanzaku = {
    window: {
        minimize: () => currentWindow.minimize(),
        toggleMaximize: () => currentWindow.toggleMaximize(),
        close: () => currentWindow.close(),
    },
    library: {
        list: () => storageReady.then(() => tauri.core.invoke('library_list')),
        open: (id: string) => loadTrack(id),
        rename: (id: string, title: string) =>
            tauri.core.invoke('library_rename', { id, title }),
        remove: (id: string) => tauri.core.invoke('library_delete', { id }),
        import: () => tauri.core.invoke('library_import'),
        addYoutube: (url: string) =>
            tauri.core.invoke('library_add_youtube', { url }),
    },
    playback: {
        load: async (id: string) => {
            playlistQueue = []
            playlistQueueIndex = -1
            return loadTrack(id)
        },
        play: async () => startPlayback(),
        pause: async () => pausePlayback(),
        stop: async () => stopPlayback(),
        seek: async (position: number) => seekPlayback(position),
        setSpeed: async (speed: number) => setPlaybackSpeed(speed),
        toggleRepeat: () => Promise.resolve(false),
        onState: (listener: (state: PlaybackState) => void) => {
            stateListeners.add(listener)
            listener({ ...playbackState })
            return () => stateListeners.delete(listener)
        },
        onEvent: (listener: (event: unknown, index: number) => void) => {
            eventListeners.add(listener)
            return () => eventListeners.delete(listener)
        },
        onPlan: emptyUnsubscribe,
        onCountdown: (listener: (value: { remaining: number }) => void) => {
            countdownListeners.add(listener)
            return () => countdownListeners.delete(listener)
        },
    },
    playlists: {
        list: () => storageReady.then(() => tauri.core.invoke('playlist_list')),
        create: (name: string) =>
            tauri.core.invoke('playlist_create', { name }),
        rename: (id: string, name: string) =>
            tauri.core.invoke('playlist_rename', { id, name }),
        remove: (id: string) => tauri.core.invoke('playlist_delete', { id }),
        add: (playlistId: string, trackId: string) =>
            tauri.core.invoke('playlist_add', {
                playlist_id: playlistId,
                track_id: trackId,
            }),
        removeTrack: (playlistId: string, trackId: string) =>
            tauri.core.invoke('playlist_remove_track', {
                playlist_id: playlistId,
                track_id: trackId,
            }),
        play: async (id: string, mode: 'order' | 'shuffle') => {
            const [playlistList, entries] = await Promise.all([
                tauri.core.invoke<Array<{ id: string; trackIds: string[] }>>(
                    'playlist_list',
                ),
                tauri.core.invoke<Array<{ id: string }>>('library_list'),
            ])
            const playlist = playlistList.find((item) => item.id === id)
            if (!playlist) throw new Error('Playlist não encontrada.')
            const validIds = playlist.trackIds.filter((trackId) =>
                entries.some((entry) => entry.id === trackId),
            )
            if (!validIds.length)
                throw new Error('A playlist não possui músicas válidas.')
            playlistQueue = [...validIds]
            if (mode === 'shuffle') {
                for (let index = playlistQueue.length - 1; index > 0; index--) {
                    const target = Math.floor(Math.random() * (index + 1))
                    ;[playlistQueue[index], playlistQueue[target]] = [
                        playlistQueue[target],
                        playlistQueue[index],
                    ]
                }
            }
            playlistQueueIndex = 0
            await loadTrack(playlistQueue[0])
            await startPlayback()
        },
    },
    onTrack: (listener: (track: { id: string; title: string }) => void) => {
        trackListeners.add(listener)
        return () => trackListeners.delete(listener)
    },
    onYoutubeProgress: (
        listener: (value: { stage?: string; percent?: number }) => void,
    ) => {
        let unlisten: (() => void) | undefined
        void tauri.event
            .listen<{ stage?: string; percent?: number }>(
                'youtube-progress',
                (event) => listener(event.payload),
            )
            .then((cleanup) => {
                unlisten = cleanup
            })
        return () => unlisten?.()
    },
    settings: {
        get: () => storageReady.then(() => tauri.core.invoke('settings_get')),
        update: (settings: unknown) =>
            storageReady.then(() =>
                tauri.core.invoke('settings_update', { value: settings }),
            ),
    },
    storage: {
        chooseDirectory: chooseStorageDirectory,
    },
    transcription: {
        modelInfo: () => tauri.core.invoke('transcription_model_info'),
        inferWav: (path: string) =>
            tauri.core.invoke('transcription_infer_wav', { path }),
        wavToMidi: (wavPath: string, midiPath: string) =>
            tauri.core.invoke('transcription_wav_to_midi', {
                wav_path: wavPath,
                midi_path: midiPath,
            }),
    },
}

void tauri.core.invoke('runtime_info').then((value) => {
    console.info(value)
})

void tauri.core
    .invoke('transcription_model_info')
    .then((value) => console.info('Basic Pitch ONNX carregado:', value))
    .catch((error) => console.warn('Basic Pitch ONNX indisponível:', error))
