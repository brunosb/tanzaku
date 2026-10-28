import { ListMusic, Plus } from 'lucide-react'
import { useDeferredValue, useMemo } from 'react'
import {
    CatalogError,
    Choice,
    Empty,
    Pages,
    SearchField,
} from '@/features/catalog/components/catalog-controls'
import {
    collator,
    normalize,
    paginate,
} from '@/features/catalog/model/catalog-model'
import { type CatalogProps } from '@/features/catalog/model/dialog-actions'
import { useCatalog, useView } from '@/features/catalog/model/hooks'
import { type Playlist } from '@/shared/api/contracts'
import { Button } from '@/shared/ui/button'
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
                            runtime.navigate(
                                `/playlists/${encodeURIComponent(p.id)}`,
                            )
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
