import { useState, useSyncExternalStore } from 'react'
import {
    defaultView,
    type LibraryView,
} from '@/features/catalog/model/catalog-model'
import { type CatalogContext as Runtime } from '@/features/catalog/model/context'
export const useCatalog = (runtime: Runtime) =>
    useSyncExternalStore(runtime.catalog.subscribe, runtime.catalog.get)
export function useView(runtime: Runtime, key: string, original = false) {
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
