import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { EditorDialog } from '@/shared/ui/editor-dialog'
import { Input } from '@/shared/ui/input'
import { Progress } from '@/shared/ui/progress'
import type { CatalogContext } from '../model/context'
export function YoutubeDialog({
    runtime,
    close,
}: {
    runtime: CatalogContext
    close: () => void
}) {
    const [value, setValue] = useState(''),
        [pending, setPending] = useState(false),
        [error, setError] = useState(''),
        [progress, setProgress] = useState({ stage: 'Preparando', percent: 0 })
    const alive = useRef(true),
        canceled = useRef(false)
    const epoch = runtime.navigation.epoch
    useEffect(
        () => () => {
            alive.current = false
        },
        [],
    )
    useEffect(() => runtime.api.onYoutubeProgress(setProgress), [runtime])
    const cancel = () => {
        if (pending) {
            canceled.current = true
            void runtime.api.library
                .cancelYoutube()
                .catch((e) => toast.error(String(e)))
        }
        close()
    }
    const submit = async () => {
        if (pending) return
        setPending(true)
        setError('')
        try {
            const entry = await runtime.api.library.addYoutube(value.trim())
            if (canceled.current || runtime.navigation.epoch !== epoch) return
            await runtime.catalog.mutate(async () => entry)
            toast.success('Música adicionada à biblioteca.', {
                action: {
                    label: 'Abrir no tocador',
                    onClick: () => {
                        void runtime.api.library
                            .open(entry.id)
                            .then(() => runtime.navigate('/player'))
                            .catch((e) => toast.error(String(e)))
                    },
                },
            })
            if (alive.current && !canceled.current) close()
        } catch (e) {
            if (alive.current && !canceled.current) setError(String(e))
        } finally {
            if (alive.current) setPending(false)
        }
    }
    return (
        <EditorDialog
            title="Adicionar pelo YouTube"
            description="Cole o link do vídeo. O Tanzaku cria um MIDI e o adiciona à biblioteca."
            pending={pending}
            cancelable
            cancel={cancel}
            buttons={
                <>
                    <Button variant="outline" onClick={cancel}>
                        {pending ? 'Cancelar conversão' : 'Cancelar'}
                    </Button>
                    <Button
                        disabled={pending || !value.trim()}
                        onClick={() => void submit()}
                    >
                        {pending ? 'Processando…' : 'Criar MIDI'}
                    </Button>
                </>
            }
        >
            {error && (
                <p className="dialog-error" role="alert">
                    {error}
                </p>
            )}
            <form
                id="editor-form"
                onSubmit={(e) => {
                    e.preventDefault()
                    void submit()
                }}
            >
                <label className="field-label" htmlFor="editor-value">
                    URL do YouTube
                </label>
                <Input
                    id="editor-value"
                    type="url"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={pending}
                    required
                    autoFocus
                />
                {pending && (
                    <div className="conversion-progress" role="status">
                        <Progress value={progress.percent} />
                        <span>
                            {progress.stage} · {Math.round(progress.percent)}%
                        </span>
                    </div>
                )}
            </form>
        </EditorDialog>
    )
}
