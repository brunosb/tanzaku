import { createCatalogStore } from '@/features/catalog/model/catalog-store'
import { createPlaybackStore } from '@/features/playback/model/playback-store'
import type { TanzakuApi } from '@/shared/api/contracts'
import { createNavigationStore, navigate } from './navigation/navigation-store'
export function createRuntime(api: TanzakuApi) {
    const catalog = createCatalogStore(api),
        playback = createPlaybackStore(api),
        navigation = createNavigationStore()
    return {
        api,
        catalog,
        playback,
        navigation,
        navigate,
        dispose() {
            playback.dispose()
        },
    }
}
export type Runtime = ReturnType<typeof createRuntime>
