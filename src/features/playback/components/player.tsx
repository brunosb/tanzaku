import { Library, Music2, Upload } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Status } from '@/features/playback/components/status'
import { type PlaybackContext as Runtime } from '@/features/playback/model/context'
import {
    KEY_GROUPS,
    mountPiano,
} from '@/features/playback/piano-roll/piano-controller'
import { formatTime } from '@/shared/lib/format-time'
import { Button } from '@/shared/ui/button'
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
                        <Button onClick={() => runtime.navigate('/library')}>
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
