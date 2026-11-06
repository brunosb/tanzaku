import { createRuntime } from '../../src/app/runtime'
import {
    type ImportReport,
    initialState,
    type LibraryEntry,
    type MidiParts,
    type PlaybackEvent,
    type PlaybackQueue,
    type PlaybackSource,
    type Playlist,
    type Snapshot,
    type TauriGlobal,
} from '../../src/shared/api/contracts'
import { defaultShortcuts } from '../../src/shared/api/settings-defaults'
import { createBridge } from '../../src/shared/api/tauri-bridge'

export function harness(size = 65) {
    let importReport: ImportReport | null = null
    let sourceEvents: PlaybackEvent[] = []
    const midiParts: MidiParts = {
        parts: [
            {
                id: '0:0',
                trackIndex: 1,
                channel: 1,
                name: 'Piano',
                instrument: 'Acoustic Grand Piano',
                percussion: false,
                noteCount: 1,
                playableNoteCount: 1,
                startTime: 0,
            },
            {
                id: '1:1',
                trackIndex: 2,
                channel: 2,
                name: 'Flauta',
                instrument: 'Flute',
                percussion: false,
                noteCount: 1,
                playableNoteCount: 1,
                startTime: 0.005,
            },
        ],
        selectedPartIds: ['0:0', '1:1'],
    }
    let settings = {
        storageRoot: 'C:/isolated',
        startMode: 'game-focus',
        shortcuts: { ...defaultShortcuts },
        shortcutWarnings: [],
    }
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
        queue: null,
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
                    case 'library_import_many':
                        if (importReport)
                            entries.push(
                                ...structuredClone(importReport.imported),
                            )
                        return structuredClone(importReport)
                    case 'playback_set_midi_parts': {
                        if (snapshot.track?.id !== args.trackId)
                            throw new Error('A música foi alterada')
                        const selectedPartIds = args.partIds as string[]
                        const entry = entries.find(
                            (entry) => entry.id === args.trackId,
                        )!
                        entry.selectedPartIds = [...selectedPartIds]
                        snapshot.midiParts = {
                            ...midiParts,
                            selectedPartIds: [...selectedPartIds],
                        }
                        snapshot.plan = {
                            ...snapshot.plan,
                            events: sourceEvents.filter((_, index) =>
                                selectedPartIds.includes(
                                    midiParts.parts[index].id,
                                ),
                            ),
                        }
                        snapshot.state = {
                            ...snapshot.state,
                            activeEventIndices: [],
                            generation: snapshot.state.generation + 1,
                            sequence: snapshot.state.sequence + 1,
                        }
                        emit('playback-plan', structuredClone(snapshot))
                        return structuredClone(snapshot)
                    }
                    case 'playback_set_background':
                        snapshot.state.backgroundPlaybackEnabled = Boolean(
                            args.enabled,
                        )
                        snapshot.state.sequence++
                        emit('playback-state', structuredClone(snapshot.state))
                        return undefined
                    case 'library_list':
                        return structuredClone(entries)
                    case 'playlist_list':
                        return structuredClone(playlists)
                    case 'settings_get':
                        return structuredClone(settings)
                    case 'settings_update':
                        settings = {
                            ...settings,
                            ...(args.value as Partial<typeof settings>),
                        }
                        return structuredClone(settings)
                    case 'app_info':
                        return {
                            name: 'Tanzaku',
                            version: '9.8.7',
                            author: 'brunosb',
                            repositoryUrl: 'https://github.com/brunosb/tanzaku',
                            license: 'ISC',
                        }
                    case 'playback_get_snapshot':
                        return structuredClone(snapshot)
                    case 'playback_set_auto_advance':
                        snapshot.state.autoAdvanceEnabled = Boolean(
                            args.enabled,
                        )
                        snapshot.state.sequence++
                        emit('playback-state', structuredClone(snapshot.state))
                        return undefined
                    case 'playback_load': {
                        const e = entries.find((e) => e.id === id)!
                        const context = args.context as
                            | PlaybackSource
                            | undefined
                        const playlist =
                            context?.kind === 'playlist'
                                ? playlists.find(
                                      (p) => p.id === context.playlistId,
                                  )
                                : null
                        const ids =
                            playlist?.trackIds ??
                            (context?.kind === 'library'
                                ? context.trackIds
                                : entries.map((e) => e.id))
                        const index = ids.indexOf(id)
                        const track = (id: string | undefined) => {
                            const entry = entries.find(
                                (entry) => entry.id === id,
                            )
                            return entry
                                ? { id: entry.id, title: entry.title }
                                : null
                        }
                        snapshot = {
                            midiParts: {
                                ...midiParts,
                                selectedPartIds:
                                    e.selectedPartIds ??
                                    midiParts.selectedPartIds,
                            },
                            queue: {
                                source: playlist ? 'playlist' : 'library',
                                playlist: playlist
                                    ? { id: playlist.id, name: playlist.name }
                                    : null,
                                mode: 'order',
                                index,
                                total: ids.length,
                                previous: track(ids[index - 1]),
                                next: track(ids[index + 1]),
                            },
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
                        sourceEvents = snapshot.plan.events
                        snapshot.plan.events = sourceEvents.filter((_, index) =>
                            snapshot.midiParts!.selectedPartIds.includes(
                                midiParts.parts[index].id,
                            ),
                        )
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
                                queue: null,
                                plan: { duration: 0, events: [] },
                            }
                            emit('playback-plan', structuredClone(snapshot))
                        }
                        return structuredClone(entries)
                    case 'storage_choose_directory':
                        settings = { ...settings, storageRoot: 'C:/new' }
                        snapshot = {
                            state: {
                                ...initialState(),
                                generation: snapshot.state.generation + 1,
                                sequence: snapshot.state.sequence + 1,
                            },
                            track: null,
                            queue: null,
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
        queue: (queue: PlaybackQueue | null) => {
            snapshot = {
                ...snapshot,
                queue,
                state: {
                    ...snapshot.state,
                    sequence: snapshot.state.sequence + 1,
                },
            }
            emit('playback-plan', structuredClone(snapshot))
        },
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
        setImportReport: (report: ImportReport | null) => {
            importReport = report
        },
    }
}
