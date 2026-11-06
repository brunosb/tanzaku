import { ListMusic } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MidiParts } from '@/shared/api/contracts'
import { formatTime } from '@/shared/lib/format-time'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/shared/ui/sheet'
import type { PlaybackContext } from '../model/context'

export function MidiPartsPanel({
    runtime,
    trackId,
    title,
    parts,
    disabled,
}: {
    runtime: PlaybackContext
    trackId: string
    title: string
    parts: MidiParts
    disabled: boolean
}) {
    const [draft, setDraft] = useState(parts.selectedPartIds)
    const [error, setError] = useState('')
    const [pending, setPending] = useState(0)
    const desired = useRef(draft),
        revision = useRef(0),
        inflight = useRef(0),
        alive = useRef(true)
    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
        }
    }, [])
    useEffect(() => {
        if (inflight.current === 0) {
            desired.current = parts.selectedPartIds
            setDraft(parts.selectedPartIds)
        }
    }, [parts])
    const change = (selected: string[]) => {
        desired.current = selected
        setDraft(selected)
        setError('')
        const request = ++revision.current
        inflight.current++
        setPending(inflight.current)
        void runtime.api.playback
            .setMidiParts(trackId, selected)
            .then(() => {
                if (alive.current && request === revision.current) {
                    const confirmed =
                        runtime.playback.meta().midiParts?.selectedPartIds ?? []
                    desired.current = confirmed
                    setDraft(confirmed)
                }
            })
            .catch((error) => {
                if (alive.current && request === revision.current) {
                    const confirmed =
                        runtime.playback.meta().midiParts?.selectedPartIds ?? []
                    desired.current = confirmed
                    setDraft(confirmed)
                    setError(String(error))
                }
            })
            .finally(() => {
                inflight.current--
                if (alive.current) setPending(inflight.current)
            })
    }
    return (
        <Sheet>
            <SheetTrigger asChild>
                <Button variant="outline" disabled={disabled}>
                    <ListMusic />
                    Partes do MIDI{' '}
                    <span className="parts-count">
                        {draft.length}/{parts.parts.length}
                    </span>
                </Button>
            </SheetTrigger>
            <SheetContent className="midi-parts-panel">
                <SheetHeader>
                    <SheetTitle>Partes do MIDI</SheetTitle>
                    <SheetDescription>
                        Escolha uma ou mais partes de {title}. Todas usam o
                        instrumento ativo no jogo.
                    </SheetDescription>
                </SheetHeader>
                <div className="parts-actions">
                    <Button
                        variant="outline"
                        disabled={disabled}
                        onClick={() =>
                            change(parts.parts.map((part) => part.id))
                        }
                    >
                        Todas
                    </Button>
                    <Button
                        variant="outline"
                        disabled={disabled}
                        onClick={() => change([])}
                    >
                        Nenhuma
                    </Button>
                    <span aria-live="polite">
                        {pending
                            ? 'Salvando…'
                            : `${draft.length} de ${parts.parts.length} ativas`}
                    </span>
                </div>
                {error && (
                    <p role="alert" className="dialog-error parts-error">
                        {error}
                    </p>
                )}
                <div className="midi-parts-list" aria-busy={pending > 0}>
                    {parts.parts.map((part) => {
                        const identity = `${part.name}, pista ${part.trackIndex}, canal ${part.channel}`
                        return (
                            <div className="midi-part" key={part.id}>
                                <label>
                                    <Checkbox
                                        aria-label={`Tocar ${identity}`}
                                        checked={draft.includes(part.id)}
                                        disabled={disabled}
                                        onCheckedChange={(checked) =>
                                            change(
                                                checked === true
                                                    ? [
                                                          ...desired.current.filter(
                                                              (id) =>
                                                                  id !==
                                                                  part.id,
                                                          ),
                                                          part.id,
                                                      ]
                                                    : desired.current.filter(
                                                          (id) =>
                                                              id !== part.id,
                                                      ),
                                            )
                                        }
                                    />
                                    <strong>{part.name}</strong>
                                </label>
                                <p>
                                    {part.instrument ??
                                        'Instrumento não informado'}{' '}
                                    · Pista {part.trackIndex} · Canal{' '}
                                    {part.channel}
                                </p>
                                <p>
                                    {part.noteCount}{' '}
                                    {part.noteCount === 1 ? 'nota' : 'notas'} ·{' '}
                                    {part.playableNoteCount} no alcance ·
                                    Entrada {formatTime(part.startTime)}
                                </p>
                                <div className="midi-part-actions">
                                    {part.percussion && <span>Percussão</span>}
                                    {!part.playableNoteCount && (
                                        <span className="parts-unplayable">
                                            Fora do alcance do jogo
                                        </span>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={disabled}
                                        aria-label={`Tocar somente ${identity}`}
                                        onClick={() => change([part.id])}
                                    >
                                        Somente esta
                                    </Button>
                                </div>
                            </div>
                        )
                    })}
                </div>
                <p className="parts-footnote">
                    A seleção é salva por música. O tempo original é preservado;
                    sem partes ativas, a música continua em silêncio.
                </p>
            </SheetContent>
        </Sheet>
    )
}
