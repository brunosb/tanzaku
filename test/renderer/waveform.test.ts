import { expect, test } from 'vitest'
import { buildWaveform } from '../../src/features/playback/model/waveform'
import type { PlaybackPlan } from '../../src/shared/api/contracts'

const key = { name: 'A', modifier: null, label: 'A' }
test('waveform preserves silence and reflects sustained notes and overlapping chords', () => {
    const plan: PlaybackPlan = {
        duration: 8,
        events: [
            { time: 0, hold: 2, keys: [key] },
            { time: 4, hold: 2, keys: [key, key, key, key] },
            { time: 5, hold: 1, keys: [key, key, key, key] },
        ],
    }
    const data = buildWaveform(plan, 8)
    expect(data).toHaveLength(8)
    expect(data[0].range).toEqual(data[1].range)
    expect(data[2].range).toEqual([-0, 0])
    expect(data[3].range).toEqual([-0, 0])
    expect(data[5].range).toEqual([-1, 1])
    expect(data[4].range[1]).toBeGreaterThan(data[0].range[1])
    expect(data[6].range).toEqual([-0, 0])
    for (const point of data) expect(point.range[0]).toBe(-point.range[1])
})

test('waveform handles empty plans, fractional windows, boundaries and a long sustain', () => {
    expect(
        buildWaveform({ events: [], duration: 0 }, 48).every(
            (point) => point.range[1] === 0,
        ),
    ).toBe(true)
    const sustain: PlaybackPlan = {
        duration: 3600,
        events: [{ time: 0, hold: 3600, keys: [key] }],
    }
    expect(
        buildWaveform(sustain, 240).every((point) => point.range[1] === 1),
    ).toBe(true)
    const fractional = buildWaveform(
        {
            duration: 4,
            events: [
                { time: 0.5, hold: 1, keys: [key] },
                { time: 4, hold: 1, keys: [key] },
            ],
        },
        4,
    )
    expect(fractional.map((point) => point.range[1])).toEqual([1, 1, 0, 0])
})
