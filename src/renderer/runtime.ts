import {
    initialState,
    type LibraryEntry,
    type PlaybackPlan,
    type TanzakuApi,
    type Track,
} from './api'
import { defaultView, type LibraryView } from './catalog-model'

function signal() {
    const listeners = new Set<() => void>()
    return {
        subscribe: (fn: () => void) => {
            listeners.add(fn)
            return () => {
                listeners.delete(fn)
            }
        },
        emit: () => {
            for (const fn of listeners) fn()
        },
    }
}
export function createRuntime(api: TanzakuApi) {
    const catalogSignal = signal()
    let catalog = {
        entries: [] as LibraryEntry[],
        playlists: [] as import('./api').Playlist[],
        loading: true,
        busy: false,
        error: '',
    }
    const publish = (patch: Partial<typeof catalog>) => {
        catalog = { ...catalog, ...patch }
        catalogSignal.emit()
    }
    let serial: Promise<unknown> = Promise.resolve()
    let epoch = 0
    const read = async () => {
        const [entries, playlists] = await Promise.all([
            api.library.list(),
            api.playlists.list(),
        ])
        return { entries, playlists }
    }
    const reload = () => {
        const task = serial.then(async () => {
            publish({ loading: true, error: '' })
            try {
                publish({ ...(await read()), loading: false })
            } catch (error) {
                publish({ loading: false, error: String(error) })
                throw error
            }
        })
        serial = task.catch(() => {})
        return task
    }
    const mutate = <T>(work: () => Promise<T>): Promise<T> => {
        const task = serial.then(async () => {
            publish({ busy: true, error: '' })
            try {
                const result = await work()
                publish(await read())
                return result
            } catch (error) {
                // Legacy single-track removals may have partially completed a
                // multi-selection. Reconcile with disk even when a later item fails.
                try {
                    publish(await read())
                } catch {}
                publish({ error: String(error) })
                throw error
            } finally {
                publish({ busy: false })
            }
        })
        serial = task.catch(() => {})
        return task
    }
    const stateSignal = signal(),
        metaSignal = signal()
    let state = initialState(),
        receivedAt = performance.now()
    let meta = {
        track: null as Track | null,
        plan: { events: [], duration: 0 } as PlaybackPlan,
        version: 0,
    }
    const unsubscribers = [
        api.onTrack((track) => {
            meta = { ...meta, track }
            metaSignal.emit()
        }),
        api.playback.onPlan((plan) => {
            meta = { ...meta, plan, version: meta.version + 1 }
            metaSignal.emit()
        }),
        api.playback.onState((next) => {
            state = next
            receivedAt = performance.now()
            stateSignal.emit()
        }),
    ]
    const views = new Map<string, LibraryView>()
    const scrolls = new Map<string, number>()
    return {
        api,
        views,
        scrolls,
        view: (key: string) => views.get(key) ?? defaultView(),
        catalog: {
            subscribe: catalogSignal.subscribe,
            get: () => catalog,
            reload,
            mutate,
        },
        playback: {
            subscribe: stateSignal.subscribe,
            get: () => state,
            receivedAt: () => receivedAt,
            subscribeMeta: metaSignal.subscribe,
            meta: () => meta,
        },
        get epoch() {
            return epoch
        },
        resetViews() {
            epoch++
            views.clear()
            scrolls.clear()
        },
        dispose() {
            for (const fn of unsubscribers) fn()
        },
    }
}
export type Runtime = ReturnType<typeof createRuntime>
