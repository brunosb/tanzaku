import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { moveTrack, normalize, paginate } from '../catalog-model'
import type { Runtime } from '../runtime'
import type { DialogAction } from './catalog'
import { Pages, SearchField, useCatalog } from './catalog'
import { navigate } from './player'
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from './ui/alert-dialog'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Progress } from './ui/progress'

export function AppDialog({
    action,
    close,
    runtime,
}: {
    action: DialogAction
    close: () => void
    runtime: Runtime
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
        [error, setError] = useState(''),
        [progress, setProgress] = useState({ stage: 'Preparando', percent: 0 })
    const alive = useRef(true),
        canceled = useRef(false)
    const epoch = runtime.epoch
    useEffect(
        () => () => {
            alive.current = false
        },
        [],
    )
    useEffect(() => runtime.api.onYoutubeProgress(setProgress), [runtime])
    const youtube = action.kind === 'youtube'
    const confirm =
        action.kind === 'delete-track' ||
        action.kind === 'delete-playlist' ||
        action.kind === 'remove-tracks' ||
        action.kind === 'storage'
    const cancel = () => {
        if (pending && !youtube) return
        if (youtube && pending) {
            canceled.current = true
            void runtime.api.library
                .cancelYoutube()
                .catch((e) => toast.error(String(e)))
        }
        close()
    }
    const perform = async (work: () => Promise<unknown>, message?: string) => {
        if (pending) return
        setPending(true)
        setError('')
        try {
            await work()
            if (!alive.current || canceled.current) return
            if (message) toast.success(message)
            close()
        } catch (e) {
            if (alive.current && !canceled.current) setError(String(e))
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
                navigate(`/playlists/${encodeURIComponent(playlist.id)}`)
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
        if (action.kind === 'storage')
            return perform(async () => {
                const directory = await runtime.catalog.mutate(() =>
                    runtime.api.storage.chooseDirectory(),
                )
                if (directory) {
                    runtime.resetViews()
                    navigate('/player')
                }
            })
        if (action.kind === 'youtube')
            return perform(async () => {
                const entry = await runtime.api.library.addYoutube(value.trim())
                if (canceled.current || runtime.epoch !== epoch) return
                await runtime.catalog.mutate(async () => entry)
                toast.success('Música adicionada à biblioteca.', {
                    action: {
                        label: 'Abrir no tocador',
                        onClick: () => {
                            void runtime.api.library
                                .open(entry.id)
                                .then(() => navigate('/player'))
                                .catch((e) => toast.error(String(e)))
                        },
                    },
                })
            })
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
            youtube: 'Adicionar pelo YouTube',
            storage: 'Alterar pasta de armazenamento?',
        } as const
    )[action.kind]
    const description =
        action.kind === 'delete-track'
            ? `“${action.track.title}” será excluída do disco e removida de todas as playlists. Esta ação não pode ser desfeita.`
            : action.kind === 'delete-playlist'
              ? `A playlist “${action.playlist.name}” será excluída. Os arquivos MIDI permanecem na biblioteca.`
              : action.kind === 'remove-tracks'
                ? `${action.trackIds.length} música(s) serão removidas desta playlist. Os arquivos permanecem na biblioteca.`
                : action.kind === 'storage'
                  ? 'A reprodução será interrompida e a conversão em andamento será cancelada após escolher outra pasta. Seus arquivos atuais permanecem na pasta original.'
                  : action.kind === 'youtube'
                    ? 'Cole o link do vídeo. O Tanzaku cria um MIDI e o adiciona à biblioteca.'
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
            {!confirm && !names && !entries && (
                <form
                    id="editor-form"
                    onSubmit={(e) => {
                        e.preventDefault()
                        void submit()
                    }}
                >
                    <label className="field-label" htmlFor="editor-value">
                        {youtube
                            ? 'URL do YouTube'
                            : action.kind === 'move'
                              ? 'Posição'
                              : 'Nome'}
                    </label>
                    <Input
                        id="editor-value"
                        type={
                            youtube
                                ? 'url'
                                : action.kind === 'move'
                                  ? 'number'
                                  : 'text'
                        }
                        min={action.kind === 'move' ? 1 : undefined}
                        max={
                            action.kind === 'move'
                                ? action.playlist.trackIds.length
                                : undefined
                        }
                        step={action.kind === 'move' ? 1 : undefined}
                        maxLength={
                            youtube
                                ? undefined
                                : action.kind === 'move'
                                  ? undefined
                                  : 100
                        }
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        disabled={pending}
                        required
                        autoFocus
                    />
                    {youtube && pending && (
                        <div className="conversion-progress" role="status">
                            <Progress value={progress.percent} />
                            <span>
                                {progress.stage} ·{' '}
                                {Math.round(progress.percent)}%
                            </span>
                        </div>
                    )}
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
                <Button
                    variant="outline"
                    onClick={cancel}
                    disabled={pending && !youtube}
                >
                    {youtube && pending ? 'Cancelar conversão' : 'Cancelar'}
                </Button>
            )}
            {!names && (
                <Button
                    variant={
                        confirm && action.kind !== 'storage'
                            ? 'destructive'
                            : 'default'
                    }
                    disabled={disabled}
                    onClick={() => void submit()}
                >
                    {pending
                        ? 'Processando…'
                        : confirm
                          ? action.kind === 'storage'
                              ? 'Escolher pasta'
                              : 'Confirmar'
                          : entries
                            ? 'Adicionar selecionadas'
                            : youtube
                              ? 'Criar MIDI'
                              : 'Salvar'}
                </Button>
            )}
        </>
    )
    if (confirm)
        return (
            <AlertDialog
                open
                onOpenChange={(open) => {
                    if (!open) cancel()
                }}
            >
                <AlertDialogContent
                    onCloseAutoFocus={(e) => e.preventDefault()}
                >
                    <AlertDialogHeader>
                        <AlertDialogTitle>{title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {content}
                    <AlertDialogFooter>{buttons}</AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        )
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) cancel()
            }}
        >
            <DialogContent
                onCloseAutoFocus={(e) => e.preventDefault()}
                className={names || entries ? 'catalog-dialog' : ''}
                onInteractOutside={(e) => {
                    if (pending) e.preventDefault()
                }}
                onEscapeKeyDown={(e) => {
                    if (pending && !youtube) e.preventDefault()
                }}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {content}
                <DialogFooter>{buttons}</DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
