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
        list: () => Promise.resolve([]),
        open: (id: string) => unsupported(`Abrir música ${id}`),
        rename: (id: string, title: string) =>
            unsupported(`Renomear música ${id} para ${title}`),
        remove: (id: string) => unsupported(`Excluir música ${id}`),
        import: () => unsupported('Importar MIDI'),
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
        list: () => Promise.resolve([]),
        create: (name: string) => unsupported(`Criar playlist ${name}`),
        rename: (id: string, name: string) =>
            unsupported(`Renomear playlist ${id} para ${name}`),
        remove: (id: string) => unsupported(`Excluir playlist ${id}`),
        add: (playlistId: string, trackId: string) =>
            unsupported(`Adicionar ${trackId} à playlist ${playlistId}`),
        removeTrack: (playlistId: string, trackId: string) =>
            unsupported(`Remover ${trackId} da playlist ${playlistId}`),
        play: (id: string, mode: 'order' | 'shuffle') =>
            unsupported(`Reproduzir playlist ${id} em ${mode}`),
    },
    onTrack: emptyUnsubscribe,
    onYoutubeProgress: emptyUnsubscribe,
    settings: {
        get: () => Promise.resolve({ storageRoot: '' }),
        update: (settings: unknown) => Promise.resolve(settings),
    },
    overlay: {
        show: () => Promise.resolve(),
        hide: () => Promise.resolve(),
        setBounds: () => Promise.resolve(),
    },
    storage: {
        chooseDirectory: () => unsupported('Escolher diretório'),
    },
}

void tauri.core.invoke('runtime_info').then((value) => {
    console.info(value)
})
