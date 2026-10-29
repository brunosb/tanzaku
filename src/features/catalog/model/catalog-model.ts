import type { LibraryEntry, Playlist } from '../../../shared/api/contracts'

export const collator = new Intl.Collator('pt-BR', {
    sensitivity: 'base',
    numeric: true,
})
export const normalize = (text: string) =>
    text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLocaleLowerCase('pt-BR')
export type LibraryView = {
    query: string
    origin: string
    membership: string
    sort: string
    page: number
    selected: string[]
}
export const defaultView = (): LibraryView => ({
    query: '',
    origin: 'all',
    membership: 'all',
    sort: 'name',
    page: 1,
    selected: [],
})
export function membershipCounts(playlists: Playlist[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const p of playlists)
        for (const id of new Set(p.trackIds))
            counts.set(id, (counts.get(id) ?? 0) + 1)
    return counts
}
export function filterLibrary(
    entries: LibraryEntry[],
    counts: Map<string, number>,
    view: LibraryView,
): LibraryEntry[] {
    const query = normalize(view.query)
    const result = entries.filter(
        (e) =>
            normalize(e.title).includes(query) &&
            (view.origin === 'all' ||
                (view.origin === 'youtube') === Boolean(e.sourceUrl)) &&
            (view.membership === 'all' ||
                (view.membership === 'in') === Boolean(counts.get(e.id))),
    )
    if (view.sort === 'newest') return result.reverse()
    if (view.sort === 'oldest' || view.sort === 'original') return result
    return result.sort(
        (a, b) =>
            (view.sort === 'name-desc' ? -1 : 1) *
            collator.compare(a.title, b.title),
    )
}
export const PAGE_SIZE = 20
export function paginate<T>(entries: T[], page: number, size = PAGE_SIZE) {
    const pages = Math.max(1, Math.ceil(entries.length / size))
    const current = Math.min(pages, Math.max(1, page))
    return {
        items: entries.slice((current - 1) * size, current * size),
        page: current,
        pages,
    }
}
export function moveTrack(ids: string[], from: number, to: number) {
    const result = [...ids]
    const [id] = result.splice(from, 1)
    result.splice(Math.max(0, Math.min(to, result.length)), 0, id)
    return result
}
