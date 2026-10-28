import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Ellipsis,
    FolderPlus,
    Music2,
    Pencil,
    Play,
    Trash2,
} from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { selectPage } from '@/features/catalog/components/catalog-controls'
import { type CatalogContext as Runtime } from '@/features/catalog/model/context'
import { type CatalogProps } from '@/features/catalog/model/dialog-actions'
import { useCatalog } from '@/features/catalog/model/hooks'
import { type LibraryEntry, type Playlist } from '@/shared/api/contracts'
import { run } from '@/shared/lib/report-error'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/shared/ui/table'
export type Row = {
    id: string
    title: string
    entry?: LibraryEntry
    position?: number
}
export function Tracks({
    runtime,
    rows,
    selected,
    onSelection,
    open,
    counts,
    playlist,
    canReorder = false,
}: {
    runtime: Runtime
    rows: Row[]
    selected: string[]
    onSelection: (ids: string[]) => void
    open: CatalogProps['open']
    counts?: Map<string, number>
    playlist?: Playlist
    canReorder?: boolean
}) {
    const catalog = useCatalog(runtime)
    const meta = useSyncExternalStore(
        runtime.playback.subscribeMeta,
        runtime.playback.meta,
    )
    const all = rows.length > 0 && rows.every((r) => selected.includes(r.id))
    const some = rows.some((r) => selected.includes(r.id))
    const load = async (id: string) => {
        await runtime.api.library.open(id)
        runtime.navigate('/player')
    }
    const reorder = (from: number, to: number) => {
        if (!playlist) return
        const ids = [...playlist.trackIds],
            [id] = ids.splice(from, 1)
        ids.splice(to, 0, id)
        run(
            runtime.catalog
                .mutate(() => runtime.api.playlists.reorder(playlist.id, ids))
                .then(() => {
                    playlistNotice()
                }),
        )
    }
    return (
        <div className="track-table">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="check-column">
                            <Checkbox
                                aria-label="Selecionar página"
                                checked={
                                    all ? true : some ? 'indeterminate' : false
                                }
                                onCheckedChange={(checked) =>
                                    onSelection(
                                        selectPage(
                                            selected,
                                            rows.map((r) => r.id),
                                            checked === true,
                                        ),
                                    )
                                }
                            />
                        </TableHead>
                        {playlist && (
                            <TableHead className="number-column">#</TableHead>
                        )}
                        <TableHead>Nome</TableHead>
                        <TableHead className="origin-column">Origem</TableHead>
                        {!playlist && (
                            <TableHead className="membership-column">
                                Playlists
                            </TableHead>
                        )}
                        <TableHead className="actions-column">
                            <span className="sr-only">Ações</span>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row, i) => (
                        <TableRow
                            key={`${row.id}-${row.position ?? i}`}
                            data-state={
                                selected.includes(row.id)
                                    ? 'selected'
                                    : undefined
                            }
                            className={
                                meta.track?.id === row.id ? 'loaded-track' : ''
                            }
                        >
                            <TableCell>
                                <Checkbox
                                    aria-label={`Selecionar ${row.title}`}
                                    checked={selected.includes(row.id)}
                                    onCheckedChange={(checked) =>
                                        onSelection(
                                            selectPage(
                                                selected,
                                                [row.id],
                                                checked === true,
                                            ),
                                        )
                                    }
                                />
                            </TableCell>
                            {playlist && (
                                <TableCell className="track-number">
                                    {(row.position ?? 0) + 1}
                                </TableCell>
                            )}
                            <TableCell>
                                <button
                                    className="track-name"
                                    disabled={!row.entry}
                                    onClick={() => run(load(row.id))}
                                >
                                    <span className="song-icon">
                                        <Music2 size={17} />
                                    </span>
                                    <span>
                                        <strong>{row.title}</strong>
                                        {!row.entry && (
                                            <small>
                                                Indisponível · referência
                                                preservada
                                            </small>
                                        )}
                                    </span>
                                </button>
                            </TableCell>
                            <TableCell className="origin-column">
                                <Badge variant="secondary">
                                    {!row.entry
                                        ? 'Indisponível'
                                        : row.entry.sourceUrl
                                          ? 'YouTube'
                                          : 'MIDI local'}
                                </Badge>
                            </TableCell>
                            {!playlist && (
                                <TableCell className="membership-column">
                                    {counts?.get(row.id) ?? 0}
                                </TableCell>
                            )}
                            <TableCell>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Opções de ${row.title}`}
                                            disabled={catalog.busy}
                                        >
                                            <Ellipsis />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        {row.entry && (
                                            <>
                                                <DropdownMenuItem
                                                    onSelect={() =>
                                                        run(load(row.id))
                                                    }
                                                >
                                                    <Play />
                                                    Abrir no tocador
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onSelect={() =>
                                                        open({
                                                            kind: 'add-to-playlist',
                                                            trackIds: [row.id],
                                                        })
                                                    }
                                                >
                                                    <FolderPlus />
                                                    Adicionar à playlist
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onSelect={() =>
                                                        open({
                                                            kind: 'rename-track',
                                                            track: row.entry!,
                                                        })
                                                    }
                                                >
                                                    <Pencil />
                                                    Renomear música
                                                </DropdownMenuItem>
                                            </>
                                        )}
                                        {playlist && (
                                            <>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    disabled={
                                                        !canReorder ||
                                                        row.position === 0
                                                    }
                                                    onSelect={() =>
                                                        reorder(
                                                            row.position!,
                                                            row.position! - 1,
                                                        )
                                                    }
                                                >
                                                    <ArrowUp />
                                                    Mover acima
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    disabled={
                                                        !canReorder ||
                                                        row.position ===
                                                            playlist.trackIds
                                                                .length -
                                                                1
                                                    }
                                                    onSelect={() =>
                                                        reorder(
                                                            row.position!,
                                                            row.position! + 1,
                                                        )
                                                    }
                                                >
                                                    <ArrowDown />
                                                    Mover abaixo
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    disabled={!canReorder}
                                                    onSelect={() =>
                                                        open({
                                                            kind: 'move',
                                                            playlist,
                                                            index: row.position!,
                                                        })
                                                    }
                                                >
                                                    <ArrowUpDown />
                                                    Mover para posição…
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    onSelect={() =>
                                                        open({
                                                            kind: 'remove-tracks',
                                                            playlist,
                                                            trackIds: [row.id],
                                                        })
                                                    }
                                                >
                                                    <Trash2 />
                                                    Remover da playlist
                                                </DropdownMenuItem>
                                            </>
                                        )}
                                        {!playlist && row.entry && (
                                            <>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    variant="destructive"
                                                    onSelect={() =>
                                                        open({
                                                            kind: 'delete-track',
                                                            track: row.entry!,
                                                        })
                                                    }
                                                >
                                                    <Trash2 />
                                                    Excluir da biblioteca
                                                </DropdownMenuItem>
                                            </>
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
export function playlistNotice() {
    toast.success(
        'Playlist atualizada. A nova organização será usada na próxima execução.',
    )
}
