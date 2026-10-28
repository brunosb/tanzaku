import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    ChevronLeft,
    ChevronRight,
    Ellipsis,
    FolderPlus,
    Link2,
    ListMusic,
    Music2,
    Pencil,
    Play,
    Plus,
    Search,
    Shuffle,
    Trash2,
    Upload,
} from 'lucide-react'
import {
    useDeferredValue,
    useMemo,
    useState,
    useSyncExternalStore,
} from 'react'
import type { LibraryEntry, Playlist } from '../api'
import {
    collator,
    defaultView,
    filterLibrary,
    type LibraryView,
    membershipCounts,
    normalize,
    paginate,
} from '../catalog-model'
import type { Runtime } from '../runtime'
import { navigate, run } from './player'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Pagination, PaginationContent, PaginationItem } from './ui/pagination'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from './ui/select'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from './ui/table'

export type DialogAction =
    | { kind: 'new-playlist' | 'youtube' | 'storage' }
    | { kind: 'rename-track' | 'delete-track'; track: LibraryEntry }
    | {
          kind: 'rename-playlist' | 'delete-playlist' | 'add-tracks'
          playlist: Playlist
      }
    | { kind: 'add-to-playlist'; trackIds: string[] }
    | { kind: 'remove-tracks'; playlist: Playlist; trackIds: string[] }
    | { kind: 'move'; playlist: Playlist; index: number }
export type CatalogProps = {
    runtime: Runtime
    open: (action: DialogAction) => void
    importMidi: () => void
}
export const useCatalog = (runtime: Runtime) =>
    useSyncExternalStore(runtime.catalog.subscribe, runtime.catalog.get)
export function useView(runtime: Runtime, key: string, original = false) {
    const [view, setView] = useState(
        () =>
            runtime.views.get(key) ?? {
                ...defaultView(),
                sort: original ? 'original' : 'name',
            },
    )
    const update = (patch: Partial<LibraryView>, reset = false) =>
        setView((old) => {
            const next = { ...old, ...patch, ...(reset ? { page: 1 } : {}) }
            runtime.views.set(key, next)
            return next
        })
    return [view, update] as const
}
export function SearchField({
    value,
    onChange,
    placeholder = 'Buscar por nome…',
    autoFocus = false,
}: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    autoFocus?: boolean
}) {
    return (
        <div className="search-field">
            <Search size={17} />
            <Input
                type="search"
                data-page-search
                aria-label={placeholder}
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoFocus={autoFocus}
            />
        </div>
    )
}
export function Choice({
    label,
    value,
    onChange,
    options,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    options: [string, string][]
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger aria-label={label}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                        {label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
export function Pages({
    total,
    page,
    pages,
    onPage,
    unit = 'músicas',
}: {
    total: number
    page: number
    pages: number
    onPage: (page: number) => void
    unit?: string
}) {
    return (
        <div className="page-pagination">
            <span>
                {total} {unit} encontradas
            </span>
            <Pagination aria-label="Paginação">
                <PaginationContent>
                    <PaginationItem>
                        <Button
                            variant="outline"
                            size="sm"
                            aria-label="Página anterior"
                            disabled={page <= 1}
                            onClick={() => onPage(page - 1)}
                        >
                            <ChevronLeft />
                        </Button>
                    </PaginationItem>
                    <PaginationItem>
                        <span className="page-number">
                            {page} / {pages}
                        </span>
                    </PaginationItem>
                    <PaginationItem>
                        <Button
                            variant="outline"
                            size="sm"
                            aria-label="Próxima página"
                            disabled={page >= pages}
                            onClick={() => onPage(page + 1)}
                        >
                            <ChevronRight />
                        </Button>
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
        </div>
    )
}
export function Empty({
    title,
    children,
}: {
    title: string
    children?: React.ReactNode
}) {
    return (
        <div className="empty-state">
            <Music2 size={30} />
            <strong>{title}</strong>
            {children}
        </div>
    )
}
export function CatalogError({ runtime }: { runtime: Runtime }) {
    const catalog = useCatalog(runtime)
    return catalog.error ? (
        <div className="error-banner" role="alert">
            <span>{catalog.error}</span>
            <Button
                variant="outline"
                size="sm"
                onClick={() => run(runtime.catalog.reload())}
            >
                Tentar novamente
            </Button>
        </div>
    ) : catalog.loading ? (
        <div className="loading-state" role="status">
            Carregando biblioteca…
        </div>
    ) : null
}
export function selectPage(
    selected: string[],
    ids: string[],
    checked: boolean,
) {
    const next = new Set(selected)
    for (const id of ids) {
        if (checked) next.add(id)
        else next.delete(id)
    }
    return [...next]
}
type Row = {
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
        navigate('/player')
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

import { toast } from 'sonner'
export function playlistNotice() {
    toast.success(
        'Playlist atualizada. A nova organização será usada na próxima execução.',
    )
}

export function LibraryPage({ runtime, open, importMidi }: CatalogProps) {
    const catalog = useCatalog(runtime)
    const [view, update] = useView(runtime, 'library')
    const query = useDeferredValue(view.query)
    const counts = useMemo(
        () => membershipCounts(catalog.playlists),
        [catalog.playlists],
    )
    const result = useMemo(
        () => filterLibrary(catalog.entries, counts, { ...view, query }),
        [
            catalog.entries,
            counts,
            query,
            view.origin,
            view.membership,
            view.sort,
        ],
    )
    const page = paginate(result, view.page)
    const validIds = useMemo(
        () => new Set(catalog.entries.map((e) => e.id)),
        [catalog.entries],
    )
    const selected = view.selected.filter((id) => validIds.has(id))
    return (
        <>
            <header className="page-heading">
                <div>
                    <span className="eyebrow">SUA COLEÇÃO</span>
                    <h1>Biblioteca</h1>
                    <p>
                        {catalog.entries.length} músicas prontas para organizar
                    </p>
                </div>
                <div className="actions">
                    <Button
                        variant="outline"
                        onClick={() => open({ kind: 'youtube' })}
                    >
                        <Link2 />
                        YouTube
                    </Button>
                    <Button disabled={catalog.busy} onClick={importMidi}>
                        <Upload />
                        Importar MIDI
                    </Button>
                </div>
            </header>
            <CatalogError runtime={runtime} />
            <div className="filters">
                <SearchField
                    value={view.query}
                    onChange={(query) => update({ query }, true)}
                />
                <Choice
                    label="Origem"
                    value={view.origin}
                    onChange={(origin) => update({ origin }, true)}
                    options={[
                        ['all', 'Todas as origens'],
                        ['local', 'MIDI local'],
                        ['youtube', 'YouTube'],
                    ]}
                />
                <Choice
                    label="Participação em playlists"
                    value={view.membership}
                    onChange={(membership) => update({ membership }, true)}
                    options={[
                        ['all', 'Todas as músicas'],
                        ['in', 'Em playlists'],
                        ['out', 'Sem playlist'],
                    ]}
                />
                <Choice
                    label="Ordenar músicas"
                    value={view.sort}
                    onChange={(sort) => update({ sort }, true)}
                    options={[
                        ['name', 'Nome A–Z'],
                        ['name-desc', 'Nome Z–A'],
                        ['newest', 'Inclusão: mais novas'],
                        ['oldest', 'Inclusão: mais antigas'],
                    ]}
                />
            </div>
            {!!selected.length && (
                <div className="selection-bar">
                    <span>{selected.length} selecionadas</span>
                    <Button
                        size="sm"
                        disabled={catalog.busy}
                        onClick={() =>
                            open({
                                kind: 'add-to-playlist',
                                trackIds: selected,
                            })
                        }
                    >
                        <FolderPlus />
                        Adicionar à playlist
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => update({ selected: [] })}
                    >
                        Limpar seleção
                    </Button>
                </div>
            )}
            {result.length ? (
                <>
                    <Tracks
                        runtime={runtime}
                        rows={page.items.map((entry) => ({
                            id: entry.id,
                            title: entry.title,
                            entry,
                        }))}
                        selected={selected}
                        onSelection={(selected) => update({ selected })}
                        open={open}
                        counts={counts}
                    />
                    <Pages
                        total={result.length}
                        {...page}
                        onPage={(page) => update({ page })}
                    />
                </>
            ) : (
                !catalog.loading && (
                    <Empty
                        title={
                            catalog.entries.length
                                ? 'Nenhuma música encontrada'
                                : 'Sua biblioteca está vazia'
                        }
                    >
                        <Button
                            variant="outline"
                            onClick={() =>
                                catalog.entries.length
                                    ? update({ ...defaultView() }, true)
                                    : importMidi()
                            }
                        >
                            {catalog.entries.length
                                ? 'Limpar filtros'
                                : 'Importar MIDI'}
                        </Button>
                    </Empty>
                )
            )}
        </>
    )
}

export function PlaylistsPage({ runtime, open }: CatalogProps) {
    const catalog = useCatalog(runtime),
        [view, update] = useView(runtime, 'playlists')
    const query = useDeferredValue(view.query)
    const valid = useMemo(
        () => new Set(catalog.entries.map((e) => e.id)),
        [catalog.entries],
    )
    const count = (p: Playlist) =>
        p.trackIds.filter((id) => valid.has(id)).length
    const result = catalog.playlists
        .filter((p) => normalize(p.name).includes(normalize(query)))
        .sort((a, b) =>
            view.sort === 'count'
                ? count(b) - count(a) || collator.compare(a.name, b.name)
                : collator.compare(a.name, b.name) *
                  (view.sort === 'name-desc' ? -1 : 1),
        )
    const page = paginate(result, view.page, 24)
    return (
        <>
            <header className="page-heading">
                <div>
                    <span className="eyebrow">DO SEU JEITO</span>
                    <h1>Playlists</h1>
                    <p>Organize suas músicas em coleções.</p>
                </div>
                <Button
                    onClick={() => open({ kind: 'new-playlist' })}
                    disabled={catalog.busy}
                >
                    <Plus />
                    Criar playlist
                </Button>
            </header>
            <CatalogError runtime={runtime} />
            <div className="filters">
                <SearchField
                    value={view.query}
                    onChange={(query) => update({ query }, true)}
                    placeholder="Buscar playlists…"
                />
                <Choice
                    label="Ordenar playlists"
                    value={view.sort}
                    onChange={(sort) => update({ sort }, true)}
                    options={[
                        ['name', 'Nome A–Z'],
                        ['name-desc', 'Nome Z–A'],
                        ['count', 'Mais músicas'],
                    ]}
                />
            </div>
            <div className="playlist-grid">
                {page.items.map((p) => (
                    <button
                        className="playlist-card"
                        key={p.id}
                        onClick={() =>
                            navigate(`/playlists/${encodeURIComponent(p.id)}`)
                        }
                    >
                        <span className="playlist-cover">
                            <ListMusic size={44} />
                        </span>
                        <strong>{p.name}</strong>
                        <small>
                            {count(p)} músicas disponíveis
                            {p.trackIds.length !== count(p)
                                ? ` · ${p.trackIds.length - count(p)} indisponíveis`
                                : ''}
                        </small>
                    </button>
                ))}
            </div>
            {result.length ? (
                <Pages
                    total={result.length}
                    {...page}
                    unit="playlists"
                    onPage={(page) => update({ page })}
                />
            ) : (
                !catalog.loading && (
                    <Empty
                        title={
                            catalog.playlists.length
                                ? 'Nenhuma playlist encontrada'
                                : 'Crie sua primeira playlist'
                        }
                    >
                        <Button
                            variant="outline"
                            onClick={() =>
                                catalog.playlists.length
                                    ? update({ query: '' }, true)
                                    : open({ kind: 'new-playlist' })
                            }
                        >
                            {catalog.playlists.length
                                ? 'Limpar filtros'
                                : 'Criar playlist'}
                        </Button>
                    </Empty>
                )
            )}
        </>
    )
}

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
    const page = paginate(rows, view.page)
    const selected = view.selected.filter((id) =>
        playlist.trackIds.includes(id),
    )
    const canReorder = view.sort === 'original' && !normalize(view.query)
    const play = (mode: 'order' | 'shuffle') =>
        run(
            runtime.api.playlists
                .play(playlist.id, mode)
                .then(() => navigate('/player')),
        )
    return (
        <>
            <Button
                className="back-link"
                variant="ghost"
                onClick={() => navigate('/playlists')}
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
