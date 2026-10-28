import { useSyncExternalStore } from 'react'
import { type PlaybackContext as Runtime } from '@/features/playback/model/context'
import { Badge } from '@/shared/ui/badge'
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
export function Status({ runtime }: { runtime: Runtime }) {
    useSyncExternalStore(runtime.playback.subscribe, runtime.playback.get)
    return (
        <Badge variant="outline" id="status" className="status-pill">
            {statusLabel(runtime)}
        </Badge>
    )
}
