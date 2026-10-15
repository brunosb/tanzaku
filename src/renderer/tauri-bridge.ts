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
const unsupported = (operation: string) =>
    Promise.reject(new Error(`${operation} ainda não foi migrado para Tauri.`))

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
        list: () => tauri.core.invoke('library_list'),
        open: (id: string) => unsupported(`Abrir música ${id}`),
        rename: (id: string, title: string) =>
            tauri.core.invoke('library_rename', { id, title }),
        remove: (id: string) => tauri.core.invoke('library_delete', { id }),
        import: () => tauri.core.invoke('library_import'),
        addYoutube: (url: string) => unsupported(`Importar YouTube ${url}`),
    },
    playback: {
        load: async (id: string) => {
            const plan = await tauri.core.invoke<PlaybackPlan>(
                'playback_load',
                { id },
            )
            loadPlaybackPlan(plan)
            return plan
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
        list: () => tauri.core.invoke('playlist_list'),
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
        play: (id: string, mode: 'order' | 'shuffle') =>
            unsupported(`Reproduzir playlist ${id} em ${mode}`),
    },
    onTrack: emptyUnsubscribe,
    onYoutubeProgress: emptyUnsubscribe,
    settings: {
        get: () => tauri.core.invoke('settings_get'),
        update: (settings: unknown) => Promise.resolve(settings),
    },
    overlay: {
        show: () => Promise.resolve(),
        hide: () => Promise.resolve(),
        setBounds: () => Promise.resolve(),
    },
    storage: {
        chooseDirectory: (path?: string) =>
            path
                ? tauri.core.invoke('storage_set_directory', { path })
                : tauri.core.invoke('storage_choose_directory'),
    },
}

void tauri.core.invoke('runtime_info').then((value) => {
    console.info(value)
})
