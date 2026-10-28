import type { PlaybackStore } from '@/features/playback/model/playback-store'
import type { TanzakuApi } from '@/shared/api/contracts'
import type { LibraryView } from './catalog-model'
import type { CatalogStore } from './catalog-store'
export type CatalogContext = {
    api: TanzakuApi
    catalog: CatalogStore
    playback: Pick<PlaybackStore, 'subscribeMeta' | 'meta'>
    navigate: (path: string) => void
    navigation: {
        views: Map<string, LibraryView>
        readonly epoch: number
        resetViews(): void
    }
}
