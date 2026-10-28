import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { YoutubeProgress } from '@/shared/api/contracts'
import { formatTime } from '@/shared/lib/format-time'
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
        [progress, setProgress] = useState<
            Pick<YoutubeProgress, 'stage' | 'percent'>
        >({ stage: 'Preparando', percent: null }),
        [elapsed, setElapsed] = useState({ total: 0, stage: 0 })
    const alive = useRef(true),
        canceled = useRef(false),
        clock = useRef<{
            startedAt: number
            stageStartedAt: number
            stage: string
        } | null>(null)
    const epoch = runtime.navigation.epoch
    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
            clock.current = null
        }
    }, [])
    useEffect(
        () =>
            runtime.api.onYoutubeProgress((next) => {
                const current = clock.current
                if (!current || canceled.current) return
                if (next.stage !== current.stage) {
                    const now = performance.now()
                    current.stage = next.stage
                    current.stageStartedAt = now
                    setElapsed({
                        total: (now - current.startedAt) / 1000,
                        stage: 0,
                    })
                }
                setProgress(next)
            }),
        [runtime],
    )
    useEffect(() => {
        if (!pending) return
        const interval = window.setInterval(() => {
            const current = clock.current
            if (!current) return
            const now = performance.now()
            setElapsed({
                total: (now - current.startedAt) / 1000,
                stage: (now - current.stageStartedAt) / 1000,
            })
        }, 1000)
        return () => window.clearInterval(interval)
    }, [pending])
    const cancel = () => {
        if (pending) {
            canceled.current = true
            clock.current = null
            setPending(false)
            void runtime.api.library
                .cancelYoutube()
                .catch((e) => toast.error(String(e)))
        }
        close()
    }
    const submit = async () => {
        if (pending) return
        const now = performance.now()
        canceled.current = false
        clock.current = {
            startedAt: now,
            stageStartedAt: now,
            stage: 'Preparando',
        }
        setProgress({ stage: 'Preparando', percent: null })
        setElapsed({ total: 0, stage: 0 })
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
            clock.current = null
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
                    <div className="conversion-progress">
                        <div className="conversion-progress-heading">
                            <strong role="status">
                                {progress.stage}
                                {progress.stage !== 'Concluído' && '…'}
                            </strong>
                            {progress.percent != null && (
                                <span>
                                    {Math.round(progress.percent)}% da etapa
                                </span>
                            )}
                        </div>
                        <Progress
                            value={progress.percent}
                            aria-label={`Progresso da etapa: ${progress.stage}`}
                            aria-valuetext={
                                progress.percent == null
                                    ? undefined
                                    : `${Math.round(progress.percent)}% da etapa`
                            }
                        />
                        {progress.stage === 'Decodificando notas' && (
                            <p>Essa etapa pode levar alguns minutos.</p>
                        )}
                        <p aria-live="off">
                            Tempo nesta etapa: {formatTime(elapsed.stage)} ·
                            Tempo total: {formatTime(elapsed.total)}
                        </p>
                    </div>
                )}
            </form>
        </EditorDialog>
    )
}
