import {
    ListEnd,
    Music2,
    Pause,
    Play,
    Repeat2,
    Shuffle,
    SkipBack,
    SkipForward,
    Square,
} from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { statusLabel } from '@/features/playback/components/status'
import { type PlaybackContext } from '@/features/playback/model/context'
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
import { queueLabel } from './queue-summary'
import { Waveform } from './waveform'
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
export function Transport({ runtime }: { runtime: PlaybackContext }) {
    const state = useSyncExternalStore(
        runtime.playback.subscribe,
        runtime.playback.get,
    )
    const meta = useSyncExternalStore(
        runtime.playback.subscribeMeta,
        runtime.playback.meta,
    )
    const seek = useRef<HTMLInputElement>(null),
        clock = useRef<HTMLSpanElement>(null),
        waveform = useRef<HTMLDivElement>(null),
        preview = useRef<HTMLSpanElement>(null),
        fill = useRef<HTMLElement | null>(null),
        marker = useRef<HTMLSpanElement>(null)
    const gesture = useRef<{ resume: boolean } | null>(null)
    const showPosition = (position: number) => {
        const duration = runtime.playback.get().duration
        if (clock.current) clock.current.textContent = formatTime(position)
        if (seek.current)
            seek.current.setAttribute(
                'aria-valuetext',
                `${formatTime(position)} de ${formatTime(duration)}`,
            )
        const percent =
            duration > 0
                ? Math.max(0, Math.min(100, (position / duration) * 100))
                : 0
        fill.current ??=
            waveform.current?.querySelector<HTMLElement>('.waveform-played') ??
            null
        if (fill.current)
            fill.current.style.clipPath = `inset(0 ${100 - percent}% 0 0)`
        if (marker.current) marker.current.style.left = `${percent}%`
    }
    useEffect(() => {
        let frame = 0
        const draw = () => {
            const s = runtime.playback.get()
            if (
                s.status === 'stopped' ||
                s.status === 'loading' ||
                s.status === 'countdown'
            )
                gesture.current = null
            if (!gesture.current) {
                const p = positionAt(
                    s,
                    runtime.playback.receivedAt(),
                    performance.now(),
                )
                if (seek.current) seek.current.value = String(p)
                showPosition(p)
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
        const state = runtime.playback.get()
        const resume =
            state.status === 'playing' ||
            (state.status === 'paused' && state.pauseReason === 'focus-lost')
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
    const busy = state.status === 'loading' || state.status === 'countdown'
    const queue = meta.queue
    return (
        <footer className="transport-bar">
            <div className="transport-top">
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
                        {queue && (
                            <small
                                className="transport-source"
                                title={queueLabel(queue)}
                            >
                                {queueLabel(queue)} · {queue.index + 1}/
                                {queue.total}
                            </small>
                        )}
                    </span>
                </button>
                <div className="transport-actions">
                    <Control
                        label="Aleatório"
                        size="icon"
                        variant="ghost"
                        aria-pressed={queue?.mode === 'shuffle'}
                        className={
                            queue?.mode === 'shuffle' ? 'repeat-active' : ''
                        }
                        disabled={!queue || busy}
                        onClick={() =>
                            run(
                                runtime.api.playback.setShuffle(
                                    queue?.mode !== 'shuffle',
                                ),
                            )
                        }
                    >
                        <Shuffle />
                    </Control>
                    <Control
                        label="Música anterior"
                        size="icon"
                        variant="ghost"
                        disabled={!queue?.previous || busy}
                        onClick={() => run(runtime.api.playback.previous())}
                    >
                        <SkipBack />
                    </Control>
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
                        label="Próxima música"
                        size="icon"
                        variant="ghost"
                        disabled={!queue?.next || busy}
                        onClick={() => run(runtime.api.playback.next())}
                    >
                        <SkipForward />
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
                        id="auto-advance-toggle"
                        label="Avanço automático"
                        size="icon"
                        variant="ghost"
                        aria-pressed={state.autoAdvanceEnabled}
                        className={
                            state.autoAdvanceEnabled ? 'repeat-active' : ''
                        }
                        onClick={() =>
                            run(
                                runtime.api.playback.setAutoAdvance(
                                    !state.autoAdvanceEnabled,
                                ),
                            )
                        }
                    >
                        <ListEnd />
                    </Control>
                    <Control
                        id="repeat-toggle"
                        label={
                            state.repeatEnabled
                                ? 'Desativar repetição'
                                : state.autoAdvanceEnabled
                                  ? 'Repetir fila'
                                  : 'Repetir música'
                        }
                        size="icon"
                        variant="ghost"
                        aria-pressed={state.repeatEnabled}
                        disabled={!meta.plan.events.length}
                        className={state.repeatEnabled ? 'repeat-active' : ''}
                        onClick={() => run(runtime.api.playback.toggleRepeat())}
                    >
                        <Repeat2 />
                    </Control>
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
            </div>
            <div className="timeline-control">
                <span ref={clock} id="position">
                    {formatTime(state.position)}
                </span>
                <div
                    className="waveform-seek"
                    ref={waveform}
                    data-disabled={!state.duration || busy}
                    onPointerMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const fraction = Math.max(
                            0,
                            Math.min(
                                1,
                                (e.clientX - rect.left - 8) /
                                    Math.max(1, rect.width - 16),
                            ),
                        )
                        if (preview.current) {
                            preview.current.style.left = `clamp(22px, ${fraction * 100}%, calc(100% - 22px))`
                            preview.current.textContent = formatTime(
                                fraction * state.duration,
                            )
                        }
                    }}
                >
                    <Waveform plan={meta.plan} />
                    <div className="waveform-guides" aria-hidden="true">
                        <span className="waveform-marker" ref={marker} />
                        <span className="waveform-preview" ref={preview}>
                            00:00
                        </span>
                    </div>
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
                            showPosition(Number(seek.current?.value ?? 0))
                        }}
                        onPointerUp={commit}
                        onKeyUp={commit}
                        onBlur={commit}
                        onPointerCancel={commit}
                    />
                </div>
                <span id="duration">{formatTime(state.duration)}</span>
            </div>
        </footer>
    )
}
