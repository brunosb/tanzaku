import {
    ChevronLeft,
    Ellipsis,
    ListMusic,
    Pencil,
    Play,
    Plus,
    Shuffle,
    Trash2,
} from 'lucide-react'
import { useDeferredValue, useMemo } from 'react'
import {
    CatalogError,
    Choice,
    Empty,
    Pages,
    SearchField,
} from '@/features/catalog/components/catalog-controls'
import { Tracks } from '@/features/catalog/components/tracks'
import { collator, normalize } from '@/features/catalog/model/catalog-model'
import { type CatalogProps } from '@/features/catalog/model/dialog-actions'
import { useCatalog, usePage, useView } from '@/features/catalog/model/hooks'
import { type Playlist } from '@/shared/api/contracts'
import { run } from '@/shared/lib/report-error'
import { Button } from '@/shared/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
export function PlaylistPage({
    runtime,
    open,
    playlist,
}: CatalogProps & { playlist: Playlist }) {
    const catalog = useCatalog(runtime),
        [view, update] = useView(runtime, `playlist:${playlist.id}`, true)
    const query = useDeferredValue(view.query)
    const entries = useMemo(
        () => new Map(catalog.entries.map((e) => [e.id, e])),
        [catalog.entries],
    )
    let rows = playlist.trackIds
        .map((id, position) => ({
            id,
            position,
            entry: entries.get(id),
            title: entries.get(id)?.title ?? `Música indisponível (${id})`,
        }))
        .filter((row) => normalize(row.title).includes(normalize(query)))
    if (view.sort !== 'original')
        rows = rows.sort(
            (a, b) =>
                collator.compare(a.title, b.title) *
                (view.sort === 'name-desc' ? -1 : 1),
        )
    const page = usePage(rows, view, update)
    const selected = view.selected.filter((id) =>
        playlist.trackIds.includes(id),
    )
    const canReorder = view.sort === 'original' && !normalize(view.query)
    const play = (mode: 'order' | 'shuffle') =>
        run(
            runtime.api.playlists
                .play(playlist.id, mode)
                .then(() => runtime.navigate('/player')),
        )
    return (
        <>
            <Button
                className="back-link"
                variant="ghost"
                onClick={() => runtime.navigate('/playlists')}
            >
                <ChevronLeft />
                Playlists
            </Button>
            <header className="playlist-hero">
                <span className="playlist-cover">
                    <ListMusic size={58} />
                </span>
                <div>
                    <span className="eyebrow">PLAYLIST</span>
                    <h1>{playlist.name}</h1>
                    <p>
                        {
                            playlist.trackIds.filter((id) => entries.has(id))
                                .length
                        }{' '}
                        músicas disponíveis · {playlist.trackIds.length}{' '}
                        referências
                    </p>
                </div>
            </header>
            <div className="playlist-toolbar">
                <div className="actions">
                    <Button
                        onClick={() => play('order')}
                        disabled={
                            !playlist.trackIds.some((id) => entries.has(id)) ||
                            catalog.busy
                        }
                    >
                        <Play />
                        Reproduzir
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => play('shuffle')}
                        disabled={
                            !playlist.trackIds.some((id) => entries.has(id)) ||
                            catalog.busy
                        }
                    >
                        <Shuffle />
                        Aleatório
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => open({ kind: 'add-tracks', playlist })}
                        disabled={catalog.busy}
                    >
                        <Plus />
                        Adicionar músicas
                    </Button>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Opções da playlist"
                            disabled={catalog.busy}
                        >
                            <Ellipsis />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem
                            onSelect={() =>
                                open({ kind: 'rename-playlist', playlist })
                            }
                        >
                            <Pencil />
                            Renomear playlist
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                                open({ kind: 'delete-playlist', playlist })
                            }
                        >
                            <Trash2 />
                            Excluir playlist
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <CatalogError runtime={runtime} />
            <div className="filters">
                <SearchField
                    value={view.query}
                    onChange={(query) => update({ query }, true)}
                    placeholder="Buscar nesta playlist…"
                />
                <Choice
                    label="Ordenar faixas"
                    value={view.sort}
                    onChange={(sort) => update({ sort }, true)}
                    options={[
                        ['original', 'Ordem da playlist'],
                        ['name', 'Nome A–Z'],
                        ['name-desc', 'Nome Z–A'],
                    ]}
                />
            </div>
            {!canReorder && (
                <div className="hint">
                    Para reorganizar, use a ordem da playlist e limpe a busca.
                    <Button
                        size="sm"
                        variant="link"
                        onClick={() =>
                            update({ sort: 'original', query: '' }, true)
                        }
                    >
                        Limpar busca para reorganizar
                    </Button>
                </div>
            )}
            {!!selected.length && (
                <div className="selection-bar">
                    <span>{selected.length} selecionadas</span>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={catalog.busy}
                        onClick={() =>
                            open({
                                kind: 'remove-tracks',
                                playlist,
                                trackIds: selected,
                            })
                        }
                    >
                        <Trash2 />
                        Remover da playlist
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => update({ selected: [] })}
                    >
                        Limpar seleção
                    </Button>
                </div>
            )}
            {rows.length ? (
                <>
                    <Tracks
                        runtime={runtime}
                        rows={page.items}
                        playlist={playlist}
                        selected={selected}
                        onSelection={(selected) => update({ selected })}
                        open={open}
                        canReorder={canReorder}
                    />
                    <Pages
                        total={rows.length}
                        {...page}
                        onPage={(page) => update({ page })}
                    />
                </>
            ) : (
                <Empty
                    title={
                        playlist.trackIds.length
                            ? 'Nenhuma música encontrada'
                            : 'Esta playlist está vazia'
                    }
                >
                    <Button
                        variant="outline"
                        onClick={() =>
                            playlist.trackIds.length
                                ? update({ query: '' }, true)
                                : open({ kind: 'add-tracks', playlist })
                        }
                    >
                        {playlist.trackIds.length
                            ? 'Limpar filtros'
                            : 'Adicionar músicas'}
                    </Button>
                </Empty>
            )}
        </>
    )
}
