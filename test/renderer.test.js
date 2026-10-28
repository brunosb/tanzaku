import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { test } from 'vitest'

if (!globalThis.crypto) globalThis.crypto = webcrypto
const bridgeModule = import('../src/shared/api/tauri-bridge.ts')
const apiModule = import('../src/shared/api/contracts.ts')
const rollModule = import('../src/features/playback/piano-roll/roll-model.ts')
async function setup() {
    const { createBridge } = await bridgeModule
    const { initialState } = await apiModule
    const handlers = new Map()
    const calls = []
    let snapshot = {
        state: initialState(),
        track: null,
        plan: { events: [], duration: 0 },
    }
    let onInvoke
    const tauri = {
        window: {
            getCurrentWindow: () => ({
                minimize: async () => {},
                toggleMaximize: async () => {},
                close: async () => {},
            }),
        },
        event: {
            listen: async (name, fn) => {
                handlers.set(name, fn)
                return () => handlers.delete(name)
            },
        },
        core: {
            invoke: async (command, args) => {
                calls.push({ command, args })
                if (command === 'playback_get_snapshot') return snapshot
                if (onInvoke) return onInvoke(command, args)
            },
        },
    }
    const api = createBridge(tauri)
    await api.ready
    return {
        api,
        calls,
        emit: (name, payload) => handlers.get(name)({ payload }),
        setSnapshot: (value) => {
            snapshot = value
        },
        setInvoke: (fn) => {
            onInvoke = fn
        },
        initialState,
    }
}
function song(h, generation = 1, sequence = 1) {
    return {
        track: { id: 'a', title: 'A' },
        plan: {
            duration: 2,
            events: [
                {
                    time: 0,
                    hold: 1,
                    keys: [{ name: 'A', modifier: null, label: 'A' }],
                },
                {
                    time: 0.005,
                    hold: 1,
                    keys: [{ name: 'S', modifier: 'shift', label: 'S' }],
                },
            ],
        },
        state: { ...h.initialState(), generation, sequence, duration: 2 },
    }
}
test('IPC uses camelCase for playlist and WAV commands', async () => {
    const h = await setup()
    await h.api.playlists.add('p', 'a')
    await h.api.playlists.removeTrack('p', 'a')
    await h.api.transcription.wavToMidi('in.wav', 'out.mid')
    assert.deepEqual(
        h.calls.filter((c) => c.args),
        [
            {
                command: 'playlist_add',
                args: { playlistId: 'p', trackId: 'a' },
            },
            {
                command: 'playlist_remove_track',
                args: { playlistId: 'p', trackId: 'a' },
            },
            {
                command: 'transcription_wav_to_midi',
                args: { wavPath: 'in.wav', midiPath: 'out.mid' },
            },
        ],
    )
})
test('one plan notification per generation and track metadata stays coherent', async () => {
    const h = await setup()
    const plans = []
    const tracks = []
    h.api.playback.onPlan((v) => plans.push(v))
    h.api.onTrack((v) => tracks.push(v))
    const next = song(h)
    h.emit('playback-plan', next)
    h.emit('playback-plan', next)
    h.emit('playback-plan', {
        ...next,
        state: { ...next.state, sequence: 2 },
        track: { id: 'a', title: 'Renamed' },
    })
    assert.equal(plans.length, 2)
    assert.equal(tracks.at(-1).title, 'Renamed')
    h.emit('playback-plan', song(h, 0, 0))
    assert.equal(plans.length, 2)
})
test('old state and old note notices cannot change new track or seek state', async () => {
    const h = await setup()
    h.emit('playback-plan', song(h, 2, 20))
    let state
    const notes = []
    h.api.playback.onState((v) => {
        state = v
    })
    h.api.playback.onEvent((e, index) => notes.push(index))
    h.emit('playback-state', {
        ...song(h, 1, 100).state,
        currentEventIndex: 100,
    })
    h.emit('playback-state', {
        ...song(h, 2, 19).state,
        currentEventIndex: 100,
    })
    h.emit('playback-event', { generation: 1, sequence: 100, index: 0 })
    h.emit('playback-event', { generation: 2, sequence: 19, index: 0 })
    assert.equal(state.currentEventIndex, 0)
    assert.deepEqual(notes, [])
    h.emit('playback-event', { generation: 2, sequence: 21, index: 0 })
    assert.deepEqual(notes, [0])
})
test('playlist end never starts or rearms playback from WebView', async () => {
    const h = await setup()
    const next = song(h)
    h.emit('playback-plan', next)
    await h.api.playlists.play('p', 'order')
    h.emit('playback-state', { ...next.state, sequence: 2, status: 'ended' })
    await h.api.playback.stop()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(
        h.calls.filter(
            (c) =>
                c.command === 'playback_start' ||
                c.command === 'keyboard_arm' ||
                c.command === 'playback_load',
        ).length,
        0,
    )
    assert(h.calls.some((c) => c.command === 'playlist_play'))
})
test('seek resume is one atomic backend command', async () => {
    const h = await setup()
    await h.api.playback.seek(1.5, true)
    assert.deepEqual(h.calls.at(-1), {
        command: 'playback_seek',
        args: { position: 1.5, resume: true },
    })
    assert(!h.calls.some((c) => c.command === 'playback_start'))
})
test('unsubscribe removes listeners and a canceled job cannot update another modal', async () => {
    const h = await setup()
    let finish
    let id
    h.setInvoke((command, args) => {
        if (command === 'library_add_youtube') {
            id = args.jobId
            return new Promise((resolve) => {
                finish = resolve
            })
        }
    })
    const seen = []
    const dispose = h.api.onYoutubeProgress((v) => seen.push(v))
    const pending = h.api.library.addYoutube('https://youtu.be/example')
    await new Promise((resolve) => setImmediate(resolve))
    h.emit('youtube-progress', { jobId: id, stage: 'download', percent: 10 })
    await h.api.library.cancelYoutube()
    h.emit('youtube-progress', { jobId: id, stage: 'inference', percent: 20 })
    dispose()
    finish({ id: 'x', title: 'X', file: 'x.mid' })
    await pending
    assert.equal(seen.length, 1)
    assert(
        h.calls.some(
            (c) => c.command === 'youtube_cancel' && c.args.jobId === id,
        ),
    )
})
test('piano roll keeps simultaneous sustains and clears completed or paused notes', async () => {
    const h = await setup()
    const { activeIndices } = await rollModule
    const p = song(h).plan
    const s = {
        ...h.initialState(),
        status: 'playing',
        activeEventIndices: [0, 1],
    }
    assert.deepEqual([...activeIndices(s, p, 0.1)], [0, 1])
    assert.deepEqual([...activeIndices(s, p, 1.002)], [1])
    assert.equal(activeIndices({ ...s, status: 'paused' }, p, 0.1).size, 0)
    assert.equal(activeIndices(s, p, 1.1).size, 0)
})
test('visual interpolation follows speed and never extrapolates indefinitely', async () => {
    const h = await setup()
    const { positionAt } = await rollModule
    const s = {
        ...h.initialState(),
        status: 'playing',
        position: 1,
        duration: 5,
        speed: 2,
    }
    assert.equal(positionAt(s, 1000, 1050), 1.1)
    assert.equal(positionAt(s, 1000, 9000), 1.2)
    assert.equal(positionAt({ ...s, status: 'paused' }, 1000, 1050), 1)
})

test('actual dispatch metadata is preserved for latency diagnostics', async () => {
    const h = await setup()
    h.emit('playback-plan', song(h))
    let received
    h.api.playback.onEvent((event, index, timing) => {
        received = { index, timing }
    })
    const timing = {
        generation: 1,
        sequence: 2,
        index: 0,
        lateByMs: 2.5,
        sendMs: 0.4,
    }
    h.emit('playback-event', timing)
    assert.equal(received.index, 0)
    assert.equal(received.timing.lateByMs, 2.5)
    assert.equal(received.timing.sendMs, 0.4)
})
test('controls wait for every native listener and initial snapshot', async () => {
    const { createBridge } = await bridgeModule
    const { initialState } = await apiModule
    const gates = []
    const calls = []
    const api = createBridge({
        window: { getCurrentWindow: () => ({}) },
        event: { listen: () => new Promise((resolve) => gates.push(resolve)) },
        core: {
            invoke: async (command) => {
                calls.push(command)
                if (command === 'playback_get_snapshot')
                    return {
                        state: initialState(),
                        track: null,
                        plan: { events: [], duration: 0 },
                    }
            },
        },
    })
    const stopped = api.playback.stop()
    await Promise.resolve()
    assert.deepEqual(calls, [])
    for (const resolve of gates) resolve(() => {})
    await stopped
    assert.deepEqual(calls, ['playback_get_snapshot', 'playback_stop'])
})
