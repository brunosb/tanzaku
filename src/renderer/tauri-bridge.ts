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
        load: (id: string) => unsupported(`Carregar música ${id}`),
        play: () => unsupported('Reproduzir'),
        pause: () => unsupported('Pausar'),
        stop: () => unsupported('Parar'),
        seek: (position: number) => unsupported(`Navegar para ${position}`),
        setSpeed: (speed: number) =>
            unsupported(`Alterar velocidade para ${speed}`),
        toggleRepeat: () => Promise.resolve(false),
        onState: emptyUnsubscribe,
        onEvent: emptyUnsubscribe,
        onPlan: emptyUnsubscribe,
        onCountdown: emptyUnsubscribe,
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
        chooseDirectory: () => tauri.core.invoke('storage_choose_directory'),
    },
}

void tauri.core.invoke('runtime_info').then((value) => {
    console.info(value)
})
