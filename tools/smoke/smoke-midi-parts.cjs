// Read-only source examples; all native edits use the smoke's temporary library.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const vlq = (value) => {
    const bytes = [value & 127]
    while ((value >>= 7) > 0) bytes.unshift((value & 127) | 128)
    return bytes
}
const event = (delta, ...bytes) => [...vlq(delta), ...bytes]
const meta = (type, text) => {
    const bytes = Buffer.from(text)
    return event(0, 255, type, ...vlq(bytes.length), ...bytes)
}
function fixture() {
    const tracks = [
        [
            ...event(0, 255, 81, 3, 15, 66, 64),
            ...event(480, 255, 81, 3, 7, 161, 32),
        ],
        [
            ...meta(3, 'Piano'),
            ...event(0, 192, 0),
            ...event(480, 144, 60, 100),
            ...event(480, 128, 60, 0),
        ],
        [
            ...meta(1, 'Flute/Piccolo'),
            ...event(0, 193, 73),
            ...event(0, 145, 96, 100),
            ...event(240, 129, 96, 0),
            ...event(240, 145, 72, 100),
            ...event(1440, 129, 72, 0),
        ],
        [
            ...meta(3, 'Percussão'),
            ...event(0, 153, 36, 100),
            ...event(120, 137, 36, 0),
        ],
        meta(1, 'Synthetic fixture credits'),
    ]
    const header = Buffer.from('4d546864000000060001000501e0', 'hex')
    return Buffer.concat([
        header,
        ...tracks.map((track) => {
            const bytes = Buffer.from([...track, ...event(0, 255, 47, 0)]),
                chunk = Buffer.alloc(8)
            chunk.write('MTrk')
            chunk.writeUInt32BE(bytes.length, 4)
            return Buffer.concat([chunk, bytes])
        }),
    ])
}

module.exports = async function midiPartsSmoke({
    evaluate,
    send,
    data,
    artifacts,
}) {
    const libraryFile = path.join(data, 'library.json')
    const entries = JSON.parse(fs.readFileSync(libraryFile, 'utf8'))
    const synthetic = {
        id: 'parts-synthetic',
        title: 'Partes de exemplo',
        file: 'parts-synthetic.mid',
    }
    fs.writeFileSync(path.join(data, 'midi', synthetic.file), fixture())
    entries.push(synthetic)
    const originals = []
    const examples = []
    const sourceRoot = process.env.TANZAKU_SMOKE_MIDI_LIBRARY
    if (sourceRoot) {
        for (const file of [
            'library.json',
            'playlists.json',
            'settings.json',
        ]) {
            const filename = path.join(sourceRoot, file)
            if (fs.existsSync(filename))
                originals.push({
                    filename,
                    hash: hash(fs.readFileSync(filename)),
                })
        }
        const library = JSON.parse(
            fs.readFileSync(path.join(sourceRoot, 'library.json'), 'utf8'),
        )
        const playlists = JSON.parse(
            fs.readFileSync(path.join(sourceRoot, 'playlists.json'), 'utf8'),
        )
        const playlist = playlists.find(
            (p) => p.name.trim().toLocaleLowerCase('pt-BR') === 'filmes',
        )
        assert(playlist, 'The optional source library must contain Filmes')
        for (const [index, id] of playlist.trackIds.entries()) {
            const source = library.find((entry) => entry.id === id)
            assert(source, `Missing source ${id}`)
            const filename = path.join(
                sourceRoot,
                'midi',
                path.basename(source.file),
            )
            const bytes = fs.readFileSync(filename)
            originals.push({ filename, hash: hash(bytes) })
            const entry = {
                id: `parts-example-${index}`,
                title: source.title,
                file: `parts-example-${index}.mid`,
            }
            fs.writeFileSync(path.join(data, 'midi', entry.file), bytes)
            examples.push(entry)
            entries.push(entry)
        }
    }
    fs.writeFileSync(libraryFile, JSON.stringify(entries))
    const snapshot = () =>
        evaluate("window.__TAURI__.core.invoke('playback_get_snapshot')")
    const load = (id) =>
        evaluate(`window.tanzaku.playback.load(${JSON.stringify(id)})`)
    const select = (id, ids) =>
        evaluate(
            `window.tanzaku.playback.setMidiParts(${JSON.stringify(id)},${JSON.stringify(ids)})`,
        )
    await load(synthetic.id)
    let current = await snapshot()
    assert.equal(current.midiParts.parts.length, 3)
    assert.equal(current.midiParts.parts[1].name, 'Flute/Piccolo')
    assert.equal(current.midiParts.parts[1].playableNoteCount, 1)
    assert.equal(current.midiParts.parts[2].percussion, true)
    const ids = current.midiParts.parts.map((part) => part.id),
        duration = current.state.duration
    await evaluate('window.tanzaku.playback.seek(0.8)')
    await evaluate('window.tanzaku.playback.setSpeed(1.25)')
    await select(synthetic.id, [])
    current = await snapshot()
    assert.equal(current.plan.events.length, 0)
    assert.equal(current.state.duration, duration)
    assert.equal(current.state.position, 0.8)
    assert.equal(current.state.speed, 1.25)
    assert.equal(current.state.status, 'paused')
    assert.deepEqual(current.midiParts.selectedPartIds, [])
    assert.deepEqual(
        JSON.parse(fs.readFileSync(libraryFile, 'utf8')).find(
            (e) => e.id === synthetic.id,
        ).selectedPartIds,
        [],
    )
    const before = fs.readFileSync(libraryFile)
    assert.equal(
        await evaluate(
            `window.tanzaku.playback.setMidiParts('${synthetic.id}',['invalid']).then(()=>false,()=>true)`,
        ),
        true,
    )
    assert.deepEqual(fs.readFileSync(libraryFile), before)
    fs.chmodSync(libraryFile, 0o444)
    try {
        assert.equal(
            await evaluate(
                `window.tanzaku.playback.setMidiParts('${synthetic.id}',${JSON.stringify(ids)}).then(()=>false,()=>true)`,
            ),
            true,
        )
    } finally {
        fs.chmodSync(libraryFile, 0o666)
    }
    assert.deepEqual(fs.readFileSync(libraryFile), before)
    assert.deepEqual((await snapshot()).midiParts.selectedPartIds, [])
    await evaluate(
        `window.tanzaku.library.rename('${synthetic.id}','Partes persistidas')`,
    )
    const playlist = await evaluate(
        "window.tanzaku.playlists.create('Partes MIDI')",
    )
    await evaluate(
        `window.tanzaku.playlists.add(${JSON.stringify(playlist.id)},'${synthetic.id}')`,
    )
    await evaluate(
        `window.tanzaku.library.open('${synthetic.id}',{kind:'playlist',playlistId:${JSON.stringify(playlist.id)}})`,
    )
    assert.deepEqual((await snapshot()).midiParts.selectedPartIds, [])
    const otherRoot = path.join(data, 'parts-library')
    fs.mkdirSync(otherRoot)
    fs.writeFileSync(
        path.join(otherRoot, 'settings.json'),
        JSON.stringify({
            shortcuts: Object.fromEntries(
                [
                    'pause',
                    'stop',
                    'play',
                    'previous',
                    'next',
                    'seekBackward',
                    'seekForward',
                ].map((action) => [action, null]),
            ),
        }),
    )
    await evaluate(
        `window.tanzaku.storage.chooseDirectory(${JSON.stringify(otherRoot)})`,
    )
    assert.equal((await snapshot()).midiParts, null)
    await evaluate(
        `window.tanzaku.storage.chooseDirectory(${JSON.stringify(data)})`,
    )
    await load(synthetic.id)
    assert.deepEqual((await snapshot()).midiParts.selectedPartIds, [])
    await select(synthetic.id, ids.slice(0, 2))
    current = await snapshot()
    assert.equal(current.midiParts.selectedPartIds.length, 2)
    assert.equal(current.plan.stats.notes, 3)
    assert.equal(current.state.duration, duration)
    await select(synthetic.id, [ids[0]])

    const waitFor = async (expression) => {
        const until = Date.now() + 15000
        while (Date.now() < until) {
            if (await evaluate(expression)) return
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error(`MIDI parts smoke timed out: ${expression}`)
    }
    await evaluate("location.hash='/player'")
    await waitFor(
        "Boolean([...document.querySelectorAll('button')].find(button=>button.textContent.includes('Partes do MIDI')))",
    )
    await evaluate(
        "[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Partes do MIDI')).click()",
    )
    await waitFor("document.querySelectorAll('.midi-part').length===3")
    await waitFor(
        'document.querySelector(\'[data-slot="sheet-content"]\').getBoundingClientRect().right <= innerWidth + 1',
    )
    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(
        path.join(artifacts, 'midi-parts.png'),
        Buffer.from(screenshot.data, 'base64'),
    )
    assert(
        await evaluate(
            'Boolean(document.querySelector(\'[aria-label="Tocar Piano, pista 2, canal 1"]\'))',
        ),
    )
    await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
    })
    await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
    })
    await waitFor('!document.querySelector(\'[data-slot="sheet-content"]\')')

    const sampleResults = []
    for (const entry of examples) {
        await load(entry.id)
        const all = await snapshot(),
            parts = all.midiParts.parts
        assert(parts.length > 0)
        assert.equal(all.midiParts.selectedPartIds.length, parts.length)
        const known = [
            ['Jurassic_Park', 10],
            ['Movie_Themes_-_1941', 16],
            ['Movie_Themes_-_Superman', 17],
            ["He's_A_Pirate", 9],
        ].find(([name]) => entry.title.includes(name))
        if (known) assert.equal(parts.length, known[1], entry.title)
        await select(entry.id, [parts[0].id])
        const one = await snapshot()
        assert.equal(one.plan.stats.notes, parts[0].noteCount)
        assert.equal(one.state.duration, all.state.duration)
        await select(entry.id, [])
        const silent = await snapshot()
        assert.equal(silent.plan.events.length, 0)
        assert.equal(silent.state.duration, all.state.duration)
        sampleResults.push({
            title: entry.title,
            parts: parts.length,
            notes: parts.reduce((sum, part) => sum + part.noteCount, 0),
            playableNotes: parts.reduce(
                (sum, part) => sum + part.playableNoteCount,
                0,
            ),
        })
    }
    for (const original of originals)
        assert.equal(
            hash(fs.readFileSync(original.filename)),
            original.hash,
            `Source changed: ${original.filename}`,
        )
    await load('b')
    await evaluate('window.tanzaku.playback.setSpeed(1)')
    return {
        syntheticParts: 3,
        silentTimeline: true,
        persistsThroughRenamePlaylistAndStorage: true,
        failedWritePreservesSelection: true,
        sourceFilesUnchanged: true,
        examples: sampleResults,
    }
}
