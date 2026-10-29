import type { PlaybackQueue } from '@/shared/api/contracts'

export function queueLabel(queue: PlaybackQueue) {
    return queue.playlist ? `Playlist: ${queue.playlist.name}` : 'Biblioteca'
}

export function QueueSummary({ queue }: { queue: PlaybackQueue | null }) {
    if (!queue) return null
    return (
        <div className="queue-summary">
            <p>
                <span className="queue-source">{queueLabel(queue)}</span>
                <span>
                    {' '}
                    · {queue.index + 1} de {queue.total} ·{' '}
                    {queue.mode === 'shuffle' ? 'Aleatório' : 'Sequencial'}
                </span>
            </p>
            <p className="queue-next" title={queue.next?.title}>
                {queue.next ? (
                    <>
                        Próxima: <strong>{queue.next.title}</strong>
                    </>
                ) : (
                    'Fim da fila'
                )}
            </p>
        </div>
    )
}
