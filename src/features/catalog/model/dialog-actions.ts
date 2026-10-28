import { type CatalogContext } from '@/features/catalog/model/context'
import { type LibraryEntry, type Playlist } from '@/shared/api/contracts'
export type CatalogDialogAction =
    | { kind: 'new-playlist' }
    | { kind: 'rename-track' | 'delete-track'; track: LibraryEntry }
    | {
          kind: 'rename-playlist' | 'delete-playlist' | 'add-tracks'
          playlist: Playlist
      }
    | { kind: 'add-to-playlist'; trackIds: string[] }
    | { kind: 'remove-tracks'; playlist: Playlist; trackIds: string[] }
    | { kind: 'move'; playlist: Playlist; index: number }
export type CatalogProps = {
    runtime: CatalogContext
    open: (
        action: CatalogDialogAction | { kind: 'youtube' | 'storage' },
    ) => void
    importMidi: () => void
}
