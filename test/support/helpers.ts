import { createRuntime } from '../../src/app/runtime'
import {
    initialState,
    type LibraryEntry,
    type Playlist,
    type Snapshot,
    type TauriGlobal,
} from '../../src/shared/api/contracts'
import { createBridge } from '../../src/shared/api/tauri-bridge'

export function harness(size = 65) {
    let entries: LibraryEntry[] = Array.from({ length: size }, (_, i) => ({
        id: `t${i}`,
        title:
            i === 0 ? 'Águas do Céu' : `Música ${String(i).padStart(3, '0')}`,
        file: `${i}.mid`,
        sourceUrl: i % 2 ? 'https://youtu.be/test' : null,
    }))
    let playlists: Playlist[] = [
        {
            id: 'p',
            name: 'Minha playlist',
            trackIds: ['t0', 't1'],
            createdAt: '',
        },
    ]
    let snapshot: Snapshot = {
        state: initialState(),
        track: null,
        plan: { events: [], duration: 0 },
    }
    const handlers = new Map<string, (e: { payload: unknown }) => void>()
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    let fail = ''
    let youtubeResolve: ((entry: LibraryEntry) => void) | undefined
    const emit = (event: string, payload: unknown) =>
        handlers.get(event)?.({ payload })
    const tauri = {
        event: {
            listen: async (
                name: string,
                fn: (e: { payload: unknown }) => void,
            ) => {
                handlers.set(name, fn)
                return () => {
                    handlers.delete(name)
                }
            },
        },
        window: {
            getCurrentWindow: () => ({
                minimize: async () => {},
                toggleMaximize: async () => {},
                close: async () => {},
            }),
        },
        core: {
            invoke: async (
                command: string,
                args: Record<string, unknown> = {},
            ) => {
                calls.push({ command, args })
                if (fail === command)
                    throw new Error('Falha de gravação simulada')
                const id = String(args.id ?? args.playlistId ?? '')
                const p = playlists.find((p) => p.id === id)
                switch (command) {
                    case 'library_list':
                        return structuredClone(entries)
                    case 'playlist_list':
                        return structuredClone(playlists)
                    case 'settings_get':
                        return { storageRoot: 'C:/isolated' }
                    case 'playback_get_snapshot':
                        return structuredClone(snapshot)
                    case 'playback_load': {
                        const e = entries.find((e) => e.id === id)!
                        snapshot = {
                            state: {
                                ...initialState(),
                                generation: snapshot.state.generation + 1,
                                sequence: snapshot.state.sequence + 1,
                                duration: 2,
                            },
                            track: { id, title: e.title },
                            plan: {
                                duration: 2,
                                events: [
                                    {
                                        time: 0,
                                        hold: 1,
                                        keys: [
                                            {
                                                name: 'A',
                                                modifier: null,
                                                label: 'A',
                                            },
                                        ],
                                    },
                                    {
                                        time: 0.005,
                                        hold: 1,
                                        keys: [
                                            {
                                                name: 'S',
                                                modifier: 'shift',
                                                label: 'S',
                                            },
                                        ],
                                    },
                                ],
                            },
                        }
                        emit('playback-plan', structuredClone(snapshot))
                        return snapshot.plan
                    }
                    case 'playlist_create': {
                        const p = {
                            id: `p${playlists.length}`,
                            name: String(args.name),
                            trackIds: [],
                            createdAt: '',
                        }
                        playlists.push(p)
                        return p
                    }
                    case 'playlist_add_tracks':
                        for (const id of args.trackIds as string[])
                            if (!p!.trackIds.includes(id)) p!.trackIds.push(id)
                        return structuredClone(p)
                    case 'playlist_reorder':
                        p!.trackIds = [...(args.trackIds as string[])]
                        return structuredClone(p)
                    case 'playlist_remove_track':
                        p!.trackIds = p!.trackIds.filter(
                            (id) => id !== args.trackId,
                        )
                        return structuredClone(p)
                    case 'playlist_rename':
                        p!.name = String(args.name)
                        return structuredClone(p)
                    case 'playlist_delete':
                        playlists = playlists.filter((p) => p.id !== id)
                        return structuredClone(playlists)
                    case 'library_rename': {
                        const e = entries.find((e) => e.id === id)!
                        e.title = String(args.title)
                        return structuredClone(e)
                    }
                    case 'library_delete':
                        entries = entries.filter((e) => e.id !== id)
                        for (const p of playlists)
                            p.trackIds = p.trackIds.filter((t) => t !== id)
                        if (snapshot.track?.id === id) {
                            snapshot = {
                                state: {
                                    ...initialState(),
                                    generation: snapshot.state.generation + 1,
                                    sequence: snapshot.state.sequence + 1,
                                },
                                track: null,
                                plan: { duration: 0, events: [] },
                            }
                            emit('playback-plan', structuredClone(snapshot))
                        }
                        return structuredClone(entries)
                    case 'storage_choose_directory':
                        snapshot = {
                            state: {
                                ...initialState(),
                                generation: snapshot.state.generation + 1,
                                sequence: snapshot.state.sequence + 1,
                            },
                            track: null,
                            plan: { duration: 0, events: [] },
                        }
                        entries = []
                        playlists = []
                        emit('playback-plan', structuredClone(snapshot))
                        return 'C:/new'
                    case 'library_add_youtube':
                        return new Promise<LibraryEntry>((resolve) => {
                            youtubeResolve = resolve
                        })
                    default:
                        return undefined
                }
            },
        },
    } as unknown as TauriGlobal
    const api = createBridge(tauri),
        runtime = createRuntime(api)
    return {
        api,
        runtime,
        calls,
        emit,
        state: (patch: Partial<Snapshot['state']>) => {
            snapshot.state = {
                ...snapshot.state,
                ...patch,
                sequence: snapshot.state.sequence + 1,
            }
            emit('playback-state', structuredClone(snapshot.state))
        },
        fail: (command: string) => {
            fail = command
        },
        finishYoutube: () => {
            const e = { id: 'yt', title: 'Convertida', file: 'yt.mid' }
            entries.push(e)
            youtubeResolve?.(e)
        },
        setPlaylists: (next: Playlist[]) => {
            playlists = next
        },
    }
}
