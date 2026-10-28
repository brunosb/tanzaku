import { FolderPlus, Link2, Upload } from 'lucide-react'
import { useDeferredValue, useMemo } from 'react'
import {
    CatalogError,
    Choice,
    Empty,
    Pages,
    SearchField,
} from '@/features/catalog/components/catalog-controls'
import { Tracks } from '@/features/catalog/components/tracks'
import {
    defaultView,
    filterLibrary,
    membershipCounts,
    paginate,
} from '@/features/catalog/model/catalog-model'
import { type CatalogProps } from '@/features/catalog/model/dialog-actions'
import { useCatalog, useView } from '@/features/catalog/model/hooks'
import { Button } from '@/shared/ui/button'
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
