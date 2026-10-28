import {
    defaultView,
    type LibraryView,
} from '@/features/catalog/model/catalog-model'
export function navigate(path: string) {
    window.location.hash = path
}
export const subscribeRoute = (fn: () => void) => {
    window.addEventListener('hashchange', fn)
    return () => window.removeEventListener('hashchange', fn)
}
export const getRoute = () => window.location.hash.slice(1) || '/player'
export function createNavigationStore() {
    let epoch = 0
    const views = new Map<string, LibraryView>()
    const scrolls = new Map<string, number>()
    return {
        views,
        scrolls,
        view: (key: string) => views.get(key) ?? defaultView(),
        get epoch() {
            return epoch
        },
        resetViews() {
            epoch++
            views.clear()
            scrolls.clear()
        },
    }
}
