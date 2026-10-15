const test = require('node:test')
const assert = require('node:assert/strict')
const { mapPitch, buildPlaybackPlan } = require('../dist/planner.js')

const config = {
    lowPitch: 48,
    highPitch: 83,
    transpose: 0,
    maxPoly: 6,
    holdMs: 30,
    chordWindowMs: 20,
    rollStepMs: 5,
}

test('mapeia os 36 pitches no teclado WWM', () => {
    const expected = [
        ['Z', null],
        ['Z', 'shift'],
        ['X', null],
        ['C', 'ctrl'],
        ['C', null],
        ['V', null],
        ['V', 'shift'],
        ['B', null],
        ['B', 'shift'],
        ['N', null],
        ['M', 'ctrl'],
        ['M', null],
        ['A', null],
        ['A', 'shift'],
        ['S', null],
        ['D', 'ctrl'],
        ['D', null],
        ['F', null],
        ['F', 'shift'],
        ['G', null],
        ['G', 'shift'],
        ['H', null],
        ['J', 'ctrl'],
        ['J', null],
        ['Q', null],
        ['Q', 'shift'],
        ['W', null],
        ['E', 'ctrl'],
        ['E', null],
        ['R', null],
        ['R', 'shift'],
        ['T', null],
        ['T', 'shift'],
        ['Y', null],
        ['U', 'ctrl'],
        ['U', null],
    ]
    assert.equal(expected.length, 36)
    expected.forEach(([name, modifier], index) =>
        assert.deepEqual(
            [mapPitch(48 + index).name, mapPitch(48 + index).modifier],
            [name, modifier],
        ),
    )
    assert.equal(mapPitch(47), null)
    assert.equal(mapPitch(84), null)
})

test('preserva a altura original e descarta notas fora da janela', () => {
    const plan = buildPlaybackPlan(
        [
            { time: 0, pitch: 36, velocity: 80, duration: 0.1 },
            { time: 1, pitch: 60, velocity: 80, duration: 0.1 },
            { time: 2, pitch: 72, velocity: 80, duration: 0.1 },
        ],
        config,
    )
    assert.equal(plan.stats.shift, 0)
    assert.equal(plan.stats.dropped, 1)
    assert.equal(plan.events.at(-1).keys[0].name, 'Q')
})

test('rola acordes em passos de 5ms e limita polifonia', () => {
    const plan = buildPlaybackPlan(
        [
            { time: 0, pitch: 60, velocity: 90, duration: 0.1 },
            { time: 0.01, pitch: 64, velocity: 70, duration: 0.1 },
            { time: 0.015, pitch: 67, velocity: 80, duration: 0.1 },
            { time: 0.5, pitch: 60, velocity: 50, duration: 0.1 },
        ],
        { ...config, maxPoly: 2 },
    )
    assert.equal(plan.stats.chords, 1)
    assert.equal(plan.stats.rolled, 2)
    assert.equal(plan.stats.dropped, 1)
    assert.equal(
        Math.round((plan.events[1].time - plan.events[0].time) * 1000),
        5,
    )
    assert.equal(plan.events.length, 3)
})

test('eventos separados por mais de 20ms não viram acorde', () => {
    const plan = buildPlaybackPlan(
        [
            { time: 0, pitch: 60, velocity: 80, duration: 0.1 },
            { time: 0.021, pitch: 64, velocity: 80, duration: 0.1 },
        ],
        config,
    )
    assert.equal(plan.stats.chords, 0)
    assert.deepEqual(
        plan.events.map((event) => event.time),
        [0, 0.021],
    )
})
