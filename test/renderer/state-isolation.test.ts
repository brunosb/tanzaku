import { expect, test } from 'vitest'
import { harness } from '../support/helpers'

test('native progress only notifies playback and disposed stores stop observing events', async () => {
    const h = harness()
    await h.api.ready
    await h.runtime.catalog.reload()
    await h.api.library.open('t0')
    const catalog = h.runtime.catalog.get(),
        meta = h.runtime.playback.meta()
    let catalogNotices = 0,
        playbackNotices = 0,
        metaNotices = 0
    const unsubscribe = [
        h.runtime.catalog.subscribe(() => catalogNotices++),
        h.runtime.playback.subscribe(() => playbackNotices++),
        h.runtime.playback.subscribeMeta(() => metaNotices++),
    ]
    try {
        for (let i = 0; i < 20; i++)
            h.state({ status: 'playing', position: i / 10 })
        expect(playbackNotices).toBe(20)
        expect(catalogNotices).toBe(0)
        expect(metaNotices).toBe(0)
        expect(h.runtime.catalog.get()).toBe(catalog)
        expect(h.runtime.playback.meta()).toBe(meta)
        const state = h.runtime.playback.get()
        h.runtime.dispose()
        h.state({ position: 99 })
        await h.api.library.open('t1')
        expect(h.runtime.playback.get()).toBe(state)
        expect(h.runtime.playback.meta()).toBe(meta)
    } finally {
        unsubscribe.forEach((fn) => fn())
        h.runtime.dispose()
    }
})
