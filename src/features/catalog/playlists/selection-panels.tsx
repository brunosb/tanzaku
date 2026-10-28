import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import { Pages } from '../components/catalog-controls'
import { normalize, paginate } from '../model/catalog-model'
import type { CatalogContext } from '../model/context'
import type { CatalogDialogAction } from '../model/dialog-actions'
export type SelectionProps = {
    runtime: CatalogContext
    action: CatalogDialogAction
    catalog: ReturnType<CatalogContext['catalog']['get']>
    names: ReturnType<
        typeof paginate<import('@/shared/api/contracts').Playlist>
    > | null
    entries: ReturnType<
        typeof paginate<import('@/shared/api/contracts').LibraryEntry>
    > | null
    query: string
    pending: boolean
    existing: Set<string>
    selected: string[]
    setSelected: import('react').Dispatch<
        import('react').SetStateAction<string[]>
    >
    setPage: (page: number) => void
    value: string
    setValue: (value: string) => void
    updatePlaylist: (work: () => Promise<unknown>) => Promise<void>
    perform: (work: () => Promise<unknown>, message?: string) => Promise<void>
}
export function SelectionPanels({
    runtime,
    action,
    catalog,
    names,
    entries,
    query,
    pending,
    existing,
    selected,
    setSelected,
    setPage,
    value,
    setValue,
    updatePlaylist,
    perform,
}: SelectionProps) {
    return (
        <>
            {' '}
            {names && (
                <>
                    <div className="dialog-list">
                        {names.items.map((p) => (
                            <Button
                                key={p.id}
                                variant="ghost"
                                className="playlist-choice"
                                disabled={pending}
                                onClick={() =>
                                    updatePlaylist(() =>
                                        runtime.api.playlists.addMany(
                                            p.id,
                                            action.kind === 'add-to-playlist'
                                                ? action.trackIds
                                                : [],
                                        ),
                                    )
                                }
                            >
                                {p.name}
                                <span>{p.trackIds.length} músicas</span>
                            </Button>
                        ))}
                        {!names.items.length && (
                            <p>Nenhuma playlist encontrada.</p>
                        )}
                    </div>
                    <Pages
                        total={
                            catalog.playlists.filter((p) =>
                                normalize(p.name).includes(normalize(query)),
                            ).length
                        }
                        {...names}
                        unit="playlists"
                        onPage={setPage}
                    />
                    <form
                        className="inline-create"
                        onSubmit={(e) => {
                            e.preventDefault()
                            void perform(
                                () =>
                                    runtime.catalog.mutate(async () => {
                                        const p =
                                            await runtime.api.playlists.create(
                                                value.trim(),
                                            )
                                        if (action.kind === 'add-to-playlist')
                                            await runtime.api.playlists.addMany(
                                                p.id,
                                                action.trackIds,
                                            )
                                    }),
                                'Playlist criada e músicas adicionadas.',
                            )
                        }}
                    >
                        <Input
                            aria-label="Nome da nova playlist"
                            placeholder="Nome da nova playlist"
                            maxLength={100}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            disabled={pending}
                        />
                        <Button
                            type="submit"
                            disabled={pending || !value.trim()}
                        >
                            Criar e adicionar
                        </Button>
                    </form>
                </>
            )}
            {entries && (
                <>
                    <div className="dialog-selection">
                        <span>{selected.length} selecionadas</span>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => setSelected([])}
                        >
                            Limpar seleção
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                                setSelected([
                                    ...new Set([
                                        ...selected,
                                        ...entries.items
                                            .filter((e) => !existing.has(e.id))
                                            .map((e) => e.id),
                                    ]),
                                ])
                            }
                        >
                            Selecionar página
                        </Button>
                    </div>
                    <div className="dialog-list">
                        {entries.items.map((e) => (
                            <label className="dialog-track" key={e.id}>
                                <Checkbox
                                    disabled={pending || existing.has(e.id)}
                                    checked={
                                        existing.has(e.id) ||
                                        selected.includes(e.id)
                                    }
                                    onCheckedChange={(checked) =>
                                        setSelected((old) =>
                                            checked
                                                ? [...old, e.id]
                                                : old.filter(
                                                      (id) => id !== e.id,
                                                  ),
                                        )
                                    }
                                />
                                <span>{e.title}</span>
                                {existing.has(e.id) && (
                                    <small>Já adicionada</small>
                                )}
                            </label>
                        ))}
                        {!entries.items.length && (
                            <p>Nenhuma música encontrada.</p>
                        )}
                    </div>
                    <Pages
                        total={
                            catalog.entries.filter((e) =>
                                normalize(e.title).includes(normalize(query)),
                            ).length
                        }
                        {...entries}
                        onPage={setPage}
                    />
                </>
            )}
        </>
    )
}
