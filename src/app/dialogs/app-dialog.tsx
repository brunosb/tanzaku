import { CatalogDialog } from '@/features/catalog/components/catalog-dialog'
import { YoutubeDialog } from '@/features/catalog/import/youtube-dialog'
import type { CatalogDialogAction } from '@/features/catalog/model/dialog-actions'
import { StorageDialog } from '@/features/settings/storage-dialog'
import type { Runtime } from '../runtime'
export type DialogAction =
    | CatalogDialogAction
    | { kind: 'youtube' }
    | { kind: 'storage' }
export function AppDialog({
    action,
    close,
    runtime,
}: {
    action: DialogAction
    close: () => void
    runtime: Runtime
}) {
    if (action.kind === 'youtube')
        return <YoutubeDialog runtime={runtime} close={close} />
    if (action.kind === 'storage')
        return <StorageDialog runtime={runtime} close={close} />
    return <CatalogDialog runtime={runtime} action={action} close={close} />
}
