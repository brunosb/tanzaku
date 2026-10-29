import { useEffect, useState, useSyncExternalStore } from 'react'
import {
    defaultView,
    type LibraryView,
    paginate,
} from '@/features/catalog/model/catalog-model'
import { type CatalogContext } from '@/features/catalog/model/context'
export const useCatalog = (runtime: CatalogContext) =>
    useSyncExternalStore(runtime.catalog.subscribe, runtime.catalog.get)
export function usePage<T>(
    entries: T[],
    view: LibraryView,
    update: (patch: Partial<LibraryView>) => void,
) {
    const page = paginate(entries, view.page)
    useEffect(() => {
        if (view.page !== page.page) update({ page: page.page })
    }, [view.page, page.page, update])
    return page
}
export function useView(
    runtime: CatalogContext,
    key: string,
    original = false,
) {
    const [view, setView] = useState(
        () =>
            runtime.navigation.views.get(key) ?? {
                ...defaultView(),
                sort: original ? 'original' : 'name',
            },
    )
    const update = (patch: Partial<LibraryView>, reset = false) =>
        setView((old) => {
            const next = { ...old, ...patch, ...(reset ? { page: 1 } : {}) }
            runtime.navigation.views.set(key, next)
            return next
        })
    return [view, update] as const
}
