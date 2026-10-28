import { expect, test } from 'vitest'
import {
    defaultView,
    filterLibrary,
    membershipCounts,
    moveTrack,
    normalize,
    paginate,
} from '../src/features/catalog/model/catalog-model'
import { harness } from './helpers'

test('search normalizes accents and case; filters compose with stable inclusion order', () => {
    const entries = [
        { id: '1', title: 'Águas do Céu', file: 'a.mid' },
        {
            id: '2',
            title: 'aguas do ceu',
            file: 'b.mid',
            sourceUrl: 'https://youtu.be/x',
        },
        { id: '3', title: 'Outra', file: 'c.mid' },
    ]
    const counts = membershipCounts([
        { id: 'p', name: 'P', trackIds: ['1', '1'], createdAt: '' },
    ])
    expect(counts.get('1')).toBe(1)
    expect(normalize('  ÁGUAS ')).toBe('aguas')
    expect(
        filterLibrary(entries, counts, {
            ...defaultView(),
            query: ' AGUAS ',
            sort: 'newest',
        }).map((e) => e.id),
    ).toEqual(['2', '1'])
    expect(
        filterLibrary(entries, counts, {
            ...defaultView(),
            origin: 'local',
            membership: 'in',
        }).map((e) => e.id),
    ).toEqual(['1'])
    expect(
        filterLibrary(entries, counts, {
            ...defaultView(),
            query: 'não existe',
        }),
    ).toEqual([])
    expect(moveTrack(['a', 'missing', 'b'], 0, 2)).toEqual([
        'missing',
        'b',
        'a',
    ])
    expect(paginate(entries, 99, 2)).toEqual({
        items: [entries[2]],
        page: 2,
        pages: 2,
    })
})
test('ten thousand tracks are filtered and only one page is returned', () => {
    const entries = Array.from({ length: 10000 }, (_, i) => ({
        id: String(i),
        title: `Canção ${i}`,
        file: `${i}.mid`,
    }))
    const start = performance.now()
    const result = filterLibrary(entries, new Map(), {
        ...defaultView(),
        query: 'CANCAO 99',
    })
    expect(result).toHaveLength(111)
    expect(paginate(result, 1).items).toHaveLength(50)
    expect(performance.now() - start).toBeLessThan(250)
})
test('bulk playlist IPC uses exact camelCase and never sends transport commands', async () => {
    const h = harness()
    await h.api.ready
    await h.api.playlists.addMany('p', ['t2', 't3'])
    await h.api.playlists.reorder('p', ['t3', 't2', 't1', 't0'])
    expect(
        h.calls.filter(
            (c) =>
                c.command === 'playlist_add_tracks' ||
                c.command === 'playlist_reorder',
        ),
    ).toEqual([
        {
            command: 'playlist_add_tracks',
            args: { playlistId: 'p', trackIds: ['t2', 't3'] },
        },
        {
            command: 'playlist_reorder',
            args: { playlistId: 'p', trackIds: ['t3', 't2', 't1', 't0'] },
        },
    ])
    expect(
        h.calls.some(
            (c) =>
                c.command === 'playback_start' || c.command === 'playlist_play',
        ),
    ).toBe(false)
    h.runtime.dispose()
})
test('catalog serializes mutations and retains confirmed data on failure', async () => {
    const h = harness()
    await h.runtime.catalog.reload()
    const before = h.runtime.catalog.get().entries
    h.fail('playlist_add_tracks')
    await expect(
        h.runtime.catalog.mutate(() => h.api.playlists.addMany('p', ['t3'])),
    ).rejects.toThrow()
    expect(h.runtime.catalog.get().entries).toEqual(before)
    expect(h.runtime.catalog.get().error).toContain('Falha')
    h.fail('')
    const order: number[] = []
    await Promise.all([
        h.runtime.catalog.mutate(async () => {
            await Promise.resolve()
            order.push(1)
        }),
        h.runtime.catalog.mutate(async () => {
            order.push(2)
        }),
    ])
    expect(order).toEqual([1, 2])
    h.runtime.dispose()
})
