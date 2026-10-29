// Real application screenshots using only the smoke test's temporary library.
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function capturePresentation({ evaluate, send, data }) {
    const output = path.resolve(__dirname, '../../docs/images')
    fs.mkdirSync(output, { recursive: true })
    const sourceMidi = fs
        .readdirSync(path.join(data, 'midi'))
        .find((file) => file !== 'b.mid' && file.endsWith('.mid'))
    if (!sourceMidi) throw new Error('Generated presentation MIDI is missing')
    const titles = [
        'Variações ao vento',
        'Águas do céu',
        'Brisa da montanha',
        'Caminho das flores',
        'Luzes da vila',
        'Noite de primavera',
    ]
    const entries = titles.map((title, index) => ({
        id: `demo-${index}`,
        title,
        file: sourceMidi,
        sourceUrl: index % 2 ? 'https://www.youtube.com/watch?v=demo' : null,
    }))
    fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify(entries))
    fs.writeFileSync(
        path.join(data, 'playlists.json'),
        JSON.stringify([
            {
                id: 'demo',
                name: 'Viagem entre acordes',
                trackIds: ['demo-0', 'demo-2', 'demo-4', 'demo-1'],
                createdAt: '2026-10-29T12:00:00Z',
            },
            {
                id: 'relax',
                name: 'Para ouvir o vento',
                trackIds: ['demo-3', 'demo-5'],
                createdAt: '2026-10-29T12:00:00Z',
            },
        ]),
    )
    await send('Page.reload')
    const wait = async (expression) => {
        const until = Date.now() + 15000
        while (Date.now() < until) {
            if (await evaluate(expression)) return
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error(`Presentation screenshot timed out: ${expression}`)
    }
    await wait('Boolean(window.tanzaku) && document.readyState === "complete"')
    await evaluate('window.tanzaku.ready')
    await evaluate('window.tanzaku.playback.setAutoAdvance(false)')
    await evaluate('window.tanzaku.playback.setSpeed(1)')
    if (
        (
            await evaluate(
                'window.__TAURI__.core.invoke("playback_get_snapshot")',
            )
        ).state.repeatEnabled
    )
        await evaluate('window.tanzaku.playback.toggleRepeat()')
    await evaluate(
        'window.tanzaku.playback.load("demo-0",{kind:"playlist",playlistId:"demo"})',
    )
    await evaluate('window.tanzaku.playback.seek(36.7)')
    await send('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 920,
        deviceScaleFactor: 1,
        mobile: false,
    })
    for (const [name, route, condition] of [
        [
            'player',
            '/player',
            'document.querySelectorAll(".note").length > 500',
        ],
        [
            'library',
            '/library',
            'document.querySelectorAll("tbody tr").length === 6',
        ],
        [
            'playlist',
            '/playlists/demo',
            'document.querySelector("h1")?.textContent === "Viagem entre acordes"',
        ],
    ]) {
        await evaluate(`location.hash=${JSON.stringify(route)}`)
        await wait(condition)
        await evaluate(
            'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
        )
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(
            path.join(output, `${name}.png`),
            Buffer.from(shot.data, 'base64'),
        )
    }
    console.log('Saved application presentation screenshots in docs/images')
}
