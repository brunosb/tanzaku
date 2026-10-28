import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { SearchField } from '@/features/catalog/components/catalog-controls'
import type { CatalogDialogAction } from '@/features/catalog/model/dialog-actions'
import { useCatalog } from '@/features/catalog/model/hooks'
import { AlertDialogCancel } from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { EditorDialog } from '@/shared/ui/editor-dialog'
import { Input } from '@/shared/ui/input'
import { moveTrack, normalize, paginate } from '../model/catalog-model'
import type { CatalogContext } from '../model/context'
import { SelectionPanels } from '../playlists/selection-panels'

export function CatalogDialog({
    action,
    close,
    runtime,
}: {
    action: CatalogDialogAction
    close: () => void
    runtime: CatalogContext
}) {
    const catalog = useCatalog(runtime)
    const [value, setValue] = useState(
        action.kind === 'rename-track'
            ? action.track.title
            : action.kind === 'rename-playlist'
              ? action.playlist.name
              : action.kind === 'move'
                ? String(action.index + 1)
                : '',
    )
    const [query, setQuery] = useState(''),
        [page, setPage] = useState(1),
        [selected, setSelected] = useState<string[]>([])
    const [pending, setPending] = useState(false),
        [error, setError] = useState('')
    const alive = useRef(true)
    useEffect(
        () => () => {
            alive.current = false
        },
        [],
    )
    const confirm =
        action.kind === 'delete-track' ||
        action.kind === 'delete-playlist' ||
        action.kind === 'remove-tracks'
    const cancel = () => {
        if (!pending) close()
    }
    const perform = async (work: () => Promise<unknown>, message?: string) => {
        if (pending) return
        setPending(true)
        setError('')
        try {
            await work()
            if (!alive.current) return
            if (message) toast.success(message)
            close()
        } catch (e) {
            if (alive.current) setError(String(e))
        } finally {
            if (alive.current) setPending(false)
        }
    }
    const updatePlaylist = (work: () => Promise<unknown>) =>
        perform(
            () => runtime.catalog.mutate(work),
            'Playlist atualizada. A nova organização será usada na próxima execução.',
        )
    const submit = () => {
        if (action.kind === 'new-playlist')
            return perform(async () => {
                const playlist = await runtime.catalog.mutate(() =>
                    runtime.api.playlists.create(value.trim()),
                )
                runtime.navigate(
                    `/playlists/${encodeURIComponent(playlist.id)}`,
                )
            }, 'Playlist criada.')
        if (action.kind === 'rename-track')
            return perform(
                () =>
                    runtime.catalog.mutate(() =>
                        runtime.api.library.rename(
                            action.track.id,
                            value.trim(),
                        ),
                    ),
                'Música renomeada.',
            )
        if (action.kind === 'rename-playlist')
            return updatePlaylist(() =>
                runtime.api.playlists.rename(action.playlist.id, value.trim()),
            )
        if (action.kind === 'delete-track')
            return perform(
                () =>
                    runtime.catalog.mutate(() =>
                        runtime.api.library.remove(action.track.id),
                    ),
                'Música excluída da biblioteca.',
            )
        if (action.kind === 'delete-playlist')
            return perform(
                () =>
                    runtime.catalog.mutate(() =>
                        runtime.api.playlists.remove(action.playlist.id),
                    ),
                'Playlist excluída. Suas músicas foram preservadas.',
            )
        if (action.kind === 'remove-tracks')
            return updatePlaylist(async () => {
                for (const id of action.trackIds)
                    await runtime.api.playlists.removeTrack(
                        action.playlist.id,
                        id,
                    )
            })
        if (action.kind === 'move')
            return updatePlaylist(async () => {
                const current = runtime.catalog
                    .get()
                    .playlists.find((p) => p.id === action.playlist.id)
                if (
                    !current ||
                    current.trackIds.join('\0') !==
                        action.playlist.trackIds.join('\0')
                )
                    throw new Error(
                        'A playlist mudou. Feche o diálogo e tente novamente.',
                    )
                const position = Number(value)
                if (
                    !Number.isInteger(position) ||
                    position < 1 ||
                    position > current.trackIds.length
                )
                    throw new Error('Posição inválida.')
                return runtime.api.playlists.reorder(
                    current.id,
                    moveTrack(current.trackIds, action.index, position - 1),
                )
            })
        if (action.kind === 'add-tracks')
            return updatePlaylist(() =>
                runtime.api.playlists.addMany(action.playlist.id, selected),
            )
    }
    const title = (
        {
            'new-playlist': 'Criar playlist',
            'rename-track': 'Renomear música',
            'rename-playlist': 'Renomear playlist',
            'delete-track': 'Excluir música da biblioteca?',
            'delete-playlist': 'Excluir playlist?',
            'remove-tracks': 'Remover músicas da playlist?',
            'add-to-playlist': 'Adicionar à playlist',
            'add-tracks': 'Adicionar músicas',
            move: 'Mover para posição',
        } as const
    )[action.kind]
    const description =
        action.kind === 'delete-track'
            ? `“${action.track.title}” será excluída do disco e removida de todas as playlists. Esta ação não pode ser desfeita.`
            : action.kind === 'delete-playlist'
              ? `A playlist “${action.playlist.name}” será excluída. Os arquivos MIDI permanecem na biblioteca.`
              : action.kind === 'remove-tracks'
                ? `${action.trackIds.length} música(s) serão removidas desta playlist. Os arquivos permanecem na biblioteca.`
                : action.kind === 'add-to-playlist'
                  ? `${action.trackIds.length} música(s) selecionadas. Escolha uma playlist ou crie outra.`
                  : action.kind === 'add-tracks'
                    ? `Selecione músicas para “${action.playlist.name}”. As que já estão nela serão indicadas.`
                    : action.kind === 'move'
                      ? `Informe a posição na playlist completa, de 1 a ${action.playlist.trackIds.length}.`
                      : 'Escolha um nome de até 100 caracteres.'
    const names =
        action.kind === 'add-to-playlist'
            ? paginate(
                  catalog.playlists.filter((p) =>
                      normalize(p.name).includes(normalize(query)),
                  ),
                  page,
                  24,
              )
            : null
    const existing = new Set(
        action.kind === 'add-tracks'
            ? catalog.playlists.find((p) => p.id === action.playlist.id)
                  ?.trackIds
            : [],
    )
    const entries =
        action.kind === 'add-tracks'
            ? paginate(
                  catalog.entries.filter((e) =>
                      normalize(e.title).includes(normalize(query)),
                  ),
                  page,
              )
            : null
    const content = (
        <>
            {error && (
                <p className="dialog-error" role="alert">
                    {error}
                </p>
            )}
            {(names || entries) && (
                <SearchField
                    value={query}
                    onChange={(query) => {
                        setQuery(query)
                        setPage(1)
                    }}
                    placeholder={
                        names ? 'Buscar playlists…' : 'Buscar músicas…'
                    }
                />
            )}
            <SelectionPanels
                {...{
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
                }}
            />
            {!confirm && !names && !entries && (
                <form
                    id="editor-form"
                    onSubmit={(e) => {
                        e.preventDefault()
                        void submit()
                    }}
                >
                    <label className="field-label" htmlFor="editor-value">
                        {action.kind === 'move' ? 'Posição' : 'Nome'}
                    </label>
                    <Input
                        id="editor-value"
                        type={action.kind === 'move' ? 'number' : 'text'}
                        min={action.kind === 'move' ? 1 : undefined}
                        max={
                            action.kind === 'move'
                                ? action.playlist.trackIds.length
                                : undefined
                        }
                        step={action.kind === 'move' ? 1 : undefined}
                        maxLength={action.kind === 'move' ? undefined : 100}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        disabled={pending}
                        required
                        autoFocus
                    />
                </form>
            )}
        </>
    )
    const disabled =
        pending ||
        (!confirm && !names && (entries ? !selected.length : !value.trim()))
    const buttons = (
        <>
            {confirm ? (
                <AlertDialogCancel disabled={pending}>
                    Cancelar
                </AlertDialogCancel>
            ) : (
                <Button variant="outline" onClick={cancel} disabled={pending}>
                    Cancelar
                </Button>
            )}
            {!names && (
                <Button
                    variant={confirm ? 'destructive' : 'default'}
                    disabled={disabled}
                    onClick={() => void submit()}
                >
                    {pending
                        ? 'Processando…'
                        : confirm
                          ? 'Confirmar'
                          : entries
                            ? 'Adicionar selecionadas'
                            : 'Salvar'}
                </Button>
            )}
        </>
    )
    return (
        <EditorDialog
            title={title}
            description={description}
            confirm={confirm}
            pending={pending}
            cancel={cancel}
            wide={!!(names || entries)}
            buttons={buttons}
        >
            {content}
        </EditorDialog>
    )
}
