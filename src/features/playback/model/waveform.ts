import type { PlaybackPlan } from '@/shared/api/contracts'

export function buildWaveform(plan: PlaybackPlan, count: number) {
    const bins = Math.max(1, Math.floor(count))
    const levels = new Float64Array(bins)
    const changes = new Float64Array(bins + 1)
    const span = plan.duration / bins
    if (span > 0 && Number.isFinite(span)) {
        for (const event of plan.events) {
            const start = Math.max(0, event.time)
            const end = Math.min(plan.duration, event.time + event.hold)
            if (!(end > start) || !event.keys.length) continue
            const first = Math.min(bins - 1, Math.floor(start / span))
            const last = Math.min(bins - 1, Math.ceil(end / span) - 1)
            const weight = event.keys.length
            if (first === last) {
                levels[first] += (weight * (end - start)) / span
            } else {
                levels[first] += (weight * ((first + 1) * span - start)) / span
                levels[last] += (weight * (end - last * span)) / span
                changes[first + 1] += weight
                changes[last] -= weight
            }
        }
    }
    let active = 0
    let peak = 0
    for (let index = 0; index < bins; index++) {
        active += changes[index]
        levels[index] = Math.max(0, levels[index] + active)
        peak = Math.max(peak, levels[index])
    }
    return Array.from(levels, (level, index) => {
        const amplitude = peak > 0 ? Math.sqrt(level / peak) : 0
        return { index, range: [-amplitude, amplitude] as [number, number] }
    })
}
