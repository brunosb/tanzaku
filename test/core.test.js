const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createPlaybackEngine } = require('../dist/core/playback-engine.js')
const { LibraryService } = require('../dist/core/library.js')
const { PlaylistService } = require('../dist/core/playlists.js')
const {
    createStorageLayout,
    ensureStorage,
    resolveInside,
    safeFileName,
} = require('../dist/core/storage.js')

test('storage cria layout e rejeita caminho fora da biblioteca', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tanzaku-'))
    const layout = createStorageLayout(root)
    ensureStorage(layout)
    assert.ok(fs.existsSync(layout.midi))
    assert.equal(safeFileName('Naruto: OP 16'), 'Naruto_ OP 16')
    assert.throws(() =>
        resolveInside(layout.midi, path.join(layout.root, '..', 'outside.mid')),
    )
})

test('motor de reprodução pausa, libera, reposiciona e para de forma idempotente', async () => {
    let released = 0
    const events = []
    const engine = createPlaybackEngine({
        dispatch: (event, index) => events.push({ event, index }),
        release: () => released++,
    })
    engine.load({
        events: [{ time: 0, keys: [], hold: 0.01 }],
        duration: 0.01,
        stats: {},
    })
    engine.play()
    engine.pause()
    engine.seek(0)
    engine.stop()
    engine.stop()
    assert.equal(events.length, 1)
    assert.equal(engine.getState().status, 'stopped')
    assert.ok(released >= 2)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(events.length, 1)
})

test('relógio em 1x não acelera e velocidade 2x dobra o avanço', async () => {
    const engine = createPlaybackEngine({
        tickMs: 20,
        dispatch: () => undefined,
    })
    engine.load({
        events: [{ time: 0, keys: [], hold: 1 }],
        duration: 1,
        stats: {},
    })
    engine.play()
    await new Promise((resolve) => setTimeout(resolve, 100))
    engine.pause()
    const positionAtOneX = engine.getState().position
    assert.ok(positionAtOneX >= 0.06 && positionAtOneX <= 0.2)

    engine.setSpeed(2)
    engine.play()
    await new Promise((resolve) => setTimeout(resolve, 100))
    engine.pause()
    const advancedAtTwoX = engine.getState().position - positionAtOneX
    assert.ok(advancedAtTwoX >= 0.12 && advancedAtTwoX <= 0.3)
    engine.stop()
})

test('fim permite iniciar novamente do começo e Espaço não é atalho global', async () => {
    const events = []
    const engine = createPlaybackEngine({
        tickMs: 16,
        dispatch: (_event, index) => events.push(index),
    })
    engine.load({
        events: [{ time: 0, keys: [], hold: 0.04 }],
        duration: 0.04,
        stats: {},
    })
    engine.play()
    await new Promise((resolve) => setTimeout(resolve, 90))
    assert.equal(engine.getState().status, 'ended')
    engine.play()
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(events.length, 2)
    engine.stop()

    const mainSource = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'electron', 'main.ts'),
        'utf8',
    )
    assert.equal(mainSource.includes("globalShortcut.register('Space'"), false)
})

test('renderer representa os três blocos WWM e usa tempo absoluto em pixels', () => {
    const rendererSource = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'renderer', 'app.ts'),
        'utf8',
    )
    assert.match(rendererSource, /Tom baixo/)
    assert.match(rendererSource, /Tom médio/)
    assert.match(rendererSource, /Tom alto/)
    assert.match(rendererSource, /event\.time \* PX_PER_SECOND/)
    assert.match(rendererSource, /event\.hold \* PX_PER_SECOND/)
    assert.match(rendererSource, /id="play-toggle"/)
    assert.equal(rendererSource.includes('id="pause"'), false)
    assert.match(rendererSource, /Começa em/)
    assert.match(rendererSource, /id="youtube-import"/)
    assert.match(rendererSource, /id="playlist-create"/)
    assert.match(rendererSource, /input-modal/)
    assert.match(rendererSource, /song-options/)
    assert.match(rendererSource, /playlist-details/)
    assert.match(rendererSource, /removeTrackFromPlaylist/)
    assert.match(rendererSource, /rename-midi/)
})

test('biblioteca renomeia e exclui o MIDI junto com o registro', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tanzaku-library-'))
    const layout = createStorageLayout(root)
    ensureStorage(layout)
    fs.writeFileSync(
        path.join(layout.midi, 'original.mid'),
        Buffer.from('midi'),
    )
    const service = new LibraryService(layout)
    service.add({
        id: 'original.mid',
        title: 'Original',
        file: 'original.mid',
    })
    service.rename('original.mid', 'Renomeada')
    assert.ok(fs.existsSync(path.join(layout.midi, 'Renomeada.mid')))
    assert.equal(service.list()[0].title, 'Renomeada')
    service.remove('original.mid')
    assert.equal(service.list().length, 0)
    assert.equal(fs.existsSync(path.join(layout.midi, 'Renomeada.mid')), false)
})

test('playlist persiste, evita músicas duplicadas e permite remover', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tanzaku-playlist-'))
    const layout = createStorageLayout(root)
    ensureStorage(layout)
    const service = new PlaylistService(layout)
    const playlist = service.create('Treino')
    service.addTrack(playlist.id, 'one.mid')
    service.addTrack(playlist.id, 'one.mid')
    service.addTrack(playlist.id, 'two.mid')
    assert.deepEqual(service.list()[0].trackIds, ['one.mid', 'two.mid'])
    service.removeTrack(playlist.id, 'one.mid')
    assert.deepEqual(service.list()[0].trackIds, ['two.mid'])
    service.addTrack(playlist.id, 'one.mid')
    service.removeTrackFromAll('one.mid')
    assert.deepEqual(service.list()[0].trackIds, ['two.mid'])
    service.rename(playlist.id, 'Treino novo')
    assert.equal(service.list()[0].name, 'Treino novo')
    service.remove(playlist.id)
    assert.deepEqual(service.list(), [])
})
