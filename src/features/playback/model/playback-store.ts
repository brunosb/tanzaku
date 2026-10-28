import {
    initialState,
    type PlaybackPlan,
    type TanzakuApi,
    type Track,
} from '@/shared/api/contracts'
import { signal } from '@/shared/lib/signal'
export function createPlaybackStore(api: TanzakuApi) {
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

    return {
        subscribe: stateSignal.subscribe,
        get: () => state,
        receivedAt: () => receivedAt,
        subscribeMeta: metaSignal.subscribe,
        meta: () => meta,
        dispose() {
            for (const fn of unsubscribers) fn()
        },
    }
}
export type PlaybackStore = ReturnType<typeof createPlaybackStore>
