import type { PlaybackPlan, PlaybackState } from '@/shared/api/contracts'
export function positionAt(
    state: PlaybackState,
    received: number,
    now: number,
): number {
    const elapsed =
        state.status === 'playing'
            ? (Math.min(100, Math.max(0, now - received)) / 1000) * state.speed
            : 0
    return Math.min(state.duration, Math.max(0, state.position + elapsed))
}
export function activeIndices(
    state: PlaybackState,
    plan: PlaybackPlan | null,
    position: number,
): Set<number> {
    if (state.status !== 'playing' || !plan) return new Set()
    return new Set(
        state.activeEventIndices.filter((index) => {
            const event = plan.events[index]
            return (
                event &&
                position >= event.time &&
                position < event.time + event.hold
            )
        }),
    )
}
