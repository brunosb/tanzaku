import {
    Library,
    Music2,
    Pause,
    Play,
    Repeat2,
    Square,
    Upload,
} from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { formatTime } from '../catalog-model'
import { KEY_GROUPS, mountPiano } from '../piano-controller'
import { positionAt } from '../roll-model'
import type { Runtime } from '../runtime'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from './ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export const reportError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : String(error), {
        duration: 10000,
    })
export const run = (work: Promise<unknown>) => {
    void work.catch(reportError)
}
export function navigate(path: string) {
    window.location.hash = path
}
export function statusLabel(runtime: Runtime) {
    const s = runtime.playback.get()
    if (s.error) return s.error
    if (s.status === 'countdown') return `Começa em ${s.countdownRemaining}s`
    if (s.pauseReason === 'focus-lost' && s.status === 'paused')
        return 'Pausado: o jogo perdeu o foco'
    return (
        (
            {
                idle: 'Pronto',
                loading: 'Carregando',
                playing: 'Tocando',
                paused: 'Pausado',
                stopped: 'Parado',
                ended: 'Concluído',
            } as Record<string, string>
        )[s.status] ?? s.status
    )
}
function Status({ runtime }: { runtime: Runtime }) {
    useSyncExternalStore(runtime.playback.subscribe, runtime.playback.get)
    return (
        <Badge variant="outline" id="status" className="status-pill">
            {statusLabel(runtime)}
        </Badge>
    )
}
export function Player({
    runtime,
    importMidi,
}: {
    runtime: Runtime
    importMidi: () => void
}) {
    const meta = useSyncExternalStore(
        runtime.playback.subscribeMeta,
        runtime.playback.meta,
    )
    const root = useRef<HTMLDivElement>(null)
    useEffect(() => mountPiano(root.current!, runtime), [runtime])
    return (
        <>
            <header className="page-heading">
                <div>
                    <span className="eyebrow">AGORA TOCANDO</span>
                    <h1 id="selected">
                        {meta.track?.title ?? 'Seu próximo acorde começa aqui'}
                    </h1>
                </div>
                <Status runtime={runtime} />
            </header>
            {!meta.plan.events.length && (
                <div className="player-empty">
                    <Music2 size={30} />
                    <p>Escolha uma música para visualizar suas notas.</p>
                    <div className="actions">
                        <Button onClick={() => navigate('/library')}>
                            <Library />
                            Abrir biblioteca
                        </Button>
                        <Button variant="outline" onClick={importMidi}>
                            <Upload />
                            Importar MIDI
                        </Button>
                    </div>
                </div>
            )}
            <section
                className={`roll-card ${!meta.plan.events.length ? 'empty-roll' : ''}`}
            >
                <div className="roll-toolbar">
                    <div>
                        <strong>Piano roll</strong>
                        <small id="plan-summary">
                            {meta.plan.events.length
                                ? `${meta.plan.events.length} eventos · ${formatTime(meta.plan.duration)}`
                                : 'Selecione um MIDI para visualizar'}
                        </small>
                    </div>
                    <div className="legend">
                        <span>
                            <i className="legend-dot" />
                            Natural
                        </span>
                        <span>
                            <i className="legend-dot shift" />
                            SHIFT
                        </span>
                        <span>
                            <i className="legend-dot ctrl" />
                            CTRL
                        </span>
                    </div>
                </div>
                <div ref={root} className="piano-host">
                    <div className="roll-scroll" id="roll-scroll">
                        <div className="roll-content" id="roll-content">
                            {KEY_GROUPS.map((group) => (
                                <section
                                    className="roll-group"
                                    key={group.label}
                                >
                                    <div className="group-heading">
                                        {group.label}
                                    </div>
                                    <div className="timeline-surface">
                                        {group.keys.map((key) => (
                                            <div
                                                className="lane-row"
                                                data-lane={key}
                                                key={key}
                                            >
                                                <div className="lane-label">
                                                    {key}
                                                </div>
                                                <div
                                                    className="lane-track"
                                                    data-track={key}
                                                />
                                            </div>
                                        ))}
                                        <div className="roll-cursor" />
                                    </div>
                                </section>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
        </>
    )
}
function Control({
    label,
    children,
    ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button aria-label={label} {...props}>
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    )
}
export function Transport({ runtime }: { runtime: Runtime }) {
    const state = useSyncExternalStore(
        runtime.playback.subscribe,
        runtime.playback.get,
    )
    const meta = useSyncExternalStore(
        runtime.playback.subscribeMeta,
        runtime.playback.meta,
    )
    const seek = useRef<HTMLInputElement>(null),
        clock = useRef<HTMLSpanElement>(null)
    const gesture = useRef<{ resume: boolean } | null>(null)
    useEffect(() => {
        let frame = 0
        const draw = () => {
            const s = runtime.playback.get()
            if (!gesture.current) {
                const p = positionAt(
                    s,
                    runtime.playback.receivedAt(),
                    performance.now(),
                )
                if (seek.current) seek.current.value = String(p)
                if (clock.current) clock.current.textContent = formatTime(p)
            }
            if (s.status === 'playing' && !document.hidden)
                frame = requestAnimationFrame(draw)
        }
        const update = () => {
            cancelAnimationFrame(frame)
            draw()
        }
        const un = runtime.playback.subscribe(update)
        document.addEventListener('visibilitychange', update)
        draw()
        return () => {
            cancelAnimationFrame(frame)
            un()
            document.removeEventListener('visibilitychange', update)
        }
    }, [runtime])
    const begin = () => {
        if (gesture.current) return
        const resume = runtime.playback.get().status === 'playing'
        gesture.current = { resume }
        if (resume) run(runtime.api.playback.pause())
    }
    const commit = () => {
        const active = gesture.current
        if (!active || !seek.current) return
        gesture.current = null
        run(
            runtime.api.playback.seek(
                Number(seek.current.value),
                active.resume,
            ),
        )
    }
    const playing = state.status === 'playing'
    return (
        <footer className="transport-bar">
            <button className="now-playing" onClick={() => navigate('/player')}>
                <span className="song-icon">
                    <Music2 size={18} />
                </span>
                <span>
                    <strong>
                        {meta.track?.title ?? 'Nenhuma música carregada'}
                    </strong>
                    <small>{statusLabel(runtime)}</small>
                </span>
            </button>
            <div className="transport-actions">
                <Control
                    id="play-toggle"
                    label={playing ? 'Pausar' : 'Reproduzir'}
                    className="transport-play"
                    size="icon"
                    disabled={
                        !meta.plan.events.length ||
                        state.status === 'loading' ||
                        state.status === 'countdown'
                    }
                    onClick={() =>
                        run(
                            playing
                                ? runtime.api.playback.pause()
                                : runtime.api.playback.play(),
                        )
                    }
                >
                    {playing ? <Pause /> : <Play />}
                </Control>
                <Control
                    id="stop"
                    label="Parar"
                    size="icon"
                    variant="secondary"
                    onClick={() => run(runtime.api.playback.stop())}
                >
                    <Square size={15} />
                </Control>
                <Control
                    id="repeat-toggle"
                    label={
                        state.repeatEnabled
                            ? 'Desativar repetição'
                            : 'Repetir música'
                    }
                    size="icon"
                    variant="ghost"
                    aria-pressed={state.repeatEnabled}
                    className={state.repeatEnabled ? 'repeat-active' : ''}
                    onClick={() => run(runtime.api.playback.toggleRepeat())}
                >
                    <Repeat2 />
                </Control>
            </div>
            <div className="timeline-control">
                <span ref={clock} id="position">
                    {formatTime(state.position)}
                </span>
                <input
                    id="seek"
                    aria-label="Posição da música"
                    ref={seek}
                    type="range"
                    min={0}
                    max={state.duration}
                    step="0.01"
                    defaultValue={0}
                    disabled={
                        !state.duration ||
                        state.status === 'loading' ||
                        state.status === 'countdown'
                    }
                    onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId)
                        begin()
                    }}
                    onInput={() => {
                        begin()
                        if (clock.current)
                            clock.current.textContent = formatTime(
                                Number(seek.current?.value ?? 0),
                            )
                    }}
                    onPointerUp={commit}
                    onKeyUp={commit}
                    onBlur={commit}
                    onPointerCancel={commit}
                />
                <span id="duration">{formatTime(state.duration)}</span>
            </div>
            <div className="speed-control">
                <span>Velocidade</span>
                <Select
                    value={String(state.speed)}
                    onValueChange={(value) =>
                        run(runtime.api.playback.setSpeed(Number(value)))
                    }
                >
                    <SelectTrigger aria-label="Velocidade" id="speed">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                            <SelectItem key={speed} value={String(speed)}>
                                {speed}x
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </footer>
    )
}
