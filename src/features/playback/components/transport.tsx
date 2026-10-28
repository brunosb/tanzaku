import { Music2, Pause, Play, Repeat2, Square } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { statusLabel } from '@/features/playback/components/status'
import { type PlaybackContext as Runtime } from '@/features/playback/model/context'
import { positionAt } from '@/features/playback/piano-roll/roll-model'
import { formatTime } from '@/shared/lib/format-time'
import { run } from '@/shared/lib/report-error'
import { Button } from '@/shared/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/shared/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
export function Control({
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
            <button
                className="now-playing"
                onClick={() => runtime.navigate('/player')}
            >
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
