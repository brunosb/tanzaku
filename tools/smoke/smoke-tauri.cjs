// Optional desktop integration check; Node 22+ provides the CDP WebSocket client.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tanzaku-smoke-'))
const artifacts = path.join(root, 'src-tauri', 'target', 'smoke')
fs.mkdirSync(path.join(data, 'midi'))
fs.mkdirSync(artifacts, { recursive: true })
function fixtureMidi() {
    const events = []
    for (const [start, keys] of [
        [0, [60, 64, 67]],
        [480, [61, 63, 66]],
    ])
        for (const key of keys) {
            events.push({ tick: start, order: 1, bytes: [0x90, key, 100] })
            events.push({ tick: start + 480, order: 0, bytes: [0x80, key, 0] })
        }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order)
    const bytes = [0, 0xff, 0x51, 3, 7, 0xa1, 0x20]
    let previous = 0
    for (const event of events) {
        let value = event.tick - previous
        const delta = [value & 127]
        while ((value >>= 7) > 0) delta.unshift((value & 127) | 128)
        bytes.push(...delta, ...event.bytes)
        previous = event.tick
    }
    bytes.push(0, 0xff, 0x2f, 0)
    const size = Buffer.alloc(4)
    size.writeUInt32BE(bytes.length)
    return Buffer.concat([
        Buffer.from('4d546864000000060000000101e04d54726b', 'hex'),
        size,
        Buffer.from(bytes),
    ])
}
const midi = process.argv[2]
    ? fs.readFileSync(path.resolve(process.argv[2]))
    : fixtureMidi()
for (const id of ['a', 'b'])
    fs.writeFileSync(path.join(data, 'midi', `${id}.mid`), midi)
fs.writeFileSync(
    path.join(data, 'library.json'),
    JSON.stringify(
        ['a', 'b'].map((id) => ({
            id,
            title: `Smoke ${id}`,
            file: `${id}.mid`,
            sourceUrl: null,
            duration: null,
            addedAt: null,
        })),
    ),
)
function wav() {
    const samples = 44100
    const b = Buffer.alloc(44 + samples * 2)
    b.write('RIFF')
    b.writeUInt32LE(b.length - 8, 4)
    b.write('WAVEfmt ', 8)
    b.writeUInt32LE(16, 16)
    b.writeUInt16LE(1, 20)
    b.writeUInt16LE(1, 22)
    b.writeUInt32LE(22050, 24)
    b.writeUInt32LE(44100, 28)
    b.writeUInt16LE(2, 32)
    b.writeUInt16LE(16, 34)
    b.write('data', 36)
    b.writeUInt32LE(samples * 2, 40)
    for (let i = 0; i < samples; i++) {
        const t = i / 22050
        const envelope =
            Math.max(0, Math.min(1, (t - 0.1) * 100)) *
            Math.max(0, Math.min(1, (1.85 - t) * 100))
        b.writeInt16LE(
            Math.round(
                Math.sin(2 * Math.PI * 440 * t) * envelope * 0.7 * 32767,
            ),
            44 + i * 2,
        )
    }
    return b
}
const wavPath = path.join(data, 'tone.wav')
const midiPath = path.join(data, 'tone.mid')
fs.writeFileSync(wavPath, wav())
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function port() {
    const server = net.createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const value = server.address().port
    await new Promise((resolve) => server.close(resolve))
    return value
}
async function main() {
    if (typeof WebSocket === 'undefined')
        throw new Error('This optional smoke check requires Node 22+')
    const debugPort = await port()
    const executable = process.argv[3]
        ? path.resolve(process.argv[3])
        : process.execPath
    const args = process.argv[3]
        ? []
        : [
              path.join(root, 'tools', 'build', 'run-cargo.cjs'),
              'run',
              '--manifest-path',
              path.join(root, 'src-tauri', 'Cargo.toml'),
          ]
    const env = {
        ...process.env,
        TANZAKU_DATA_DIR: data,
        WEBVIEW2_USER_DATA_FOLDER: path.join(data, 'webview'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    }
    if (process.argv[3]) {
        env.PATH = [
            path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32'),
            process.env.SystemRoot ?? 'C:/Windows',
        ].join(path.delimiter)
        env.TANZAKU_BASIC_PITCH_MODEL = ''
        env.TANZAKU_FFMPEG = ''
        env.TANZAKU_YTDLP = ''
    }
    const child = spawn(executable, args, {
        cwd: process.argv[3] ? path.dirname(executable) : root,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    child.stdout.on('data', (b) => {
        log += b
        process.stdout.write(b)
    })
    child.stderr.on('data', (b) => {
        log += b
        process.stderr.write(b)
    })
    let socket
    let evaluate
    let failed
    try {
        const until = Date.now() + 180000
        let target
        while (Date.now() < until) {
            if (child.exitCode !== null)
                throw new Error(`App exited: ${child.exitCode}`)
            try {
                const targets = await (
                    await fetch(`http://127.0.0.1:${debugPort}/json/list`)
                ).json()
                target = targets.find(
                    (t) => t.type === 'page' && t.webSocketDebuggerUrl,
                )
                if (target) break
            } catch {}
            await sleep(200)
        }
        if (!target) throw new Error('No WebView2 debug target')
        socket = new WebSocket(target.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true })
            socket.addEventListener('error', reject, { once: true })
        })
        let id = 0
        const pending = new Map()
        const errors = []
        socket.addEventListener('message', ({ data }) => {
            const value = JSON.parse(data)
            if (value.id) {
                const p = pending.get(value.id)
                pending.delete(value.id)
                if (value.error)
                    p.reject(new Error(JSON.stringify(value.error)))
                else p.resolve(value.result)
            } else if (value.method === 'Runtime.exceptionThrown')
                errors.push(value.params.exceptionDetails.text)
        })
        socket.addEventListener('close', () => {
            for (const request of pending.values())
                request.reject(new Error('WebView closed'))
            pending.clear()
        })
        const send = (method, params = {}, timeout = 60000) =>
            new Promise((resolve, reject) => {
                const key = ++id
                const timer = setTimeout(() => {
                    pending.delete(key)
                    reject(new Error(`CDP timeout: ${method}`))
                }, timeout)
                pending.set(key, {
                    resolve: (value) => {
                        clearTimeout(timer)
                        resolve(value)
                    },
                    reject: (error) => {
                        clearTimeout(timer)
                        reject(error)
                    },
                })
                socket.send(JSON.stringify({ id: key, method, params }))
            })
        evaluate = async (expression, timeout = 60000) => {
            const value = await send(
                'Runtime.evaluate',
                {
                    expression,
                    awaitPromise: true,
                    returnByValue: true,
                },
                timeout,
            )
            if (value.exceptionDetails)
                throw new Error(JSON.stringify(value.exceptionDetails))
            return value.result?.value
        }
        await send('Runtime.enable')
        await send('Page.enable')
        const readyUntil = Date.now() + 30000
        while (
            !(await evaluate('Boolean(window.tanzaku)')) &&
            Date.now() < readyUntil
        )
            await sleep(100)
        await evaluate('window.tanzaku.ready')
        const info = await evaluate('window.tanzaku.transcription.modelInfo()')
        assert.equal(info.inputs.length, 1)
        assert.equal(info.outputs.length, 3)
        assert.equal(
            (await evaluate('window.tanzaku.library.list()')).length,
            2,
        )
        const playlist = await evaluate(
            "window.tanzaku.playlists.create('Smoke')",
        )
        const q = JSON.stringify(playlist.id)
        await evaluate(`window.tanzaku.playlists.add(${q},'a')`)
        await evaluate(`window.tanzaku.playlists.add(${q},'b')`)
        assert.deepEqual(
            (await evaluate(`window.tanzaku.playlists.removeTrack(${q},'b')`))
                .trackIds,
            ['a'],
        )
        assert.equal(
            (
                await evaluate(
                    "window.tanzaku.library.rename('a','Native Renamed')",
                )
            ).id,
            'a',
        )
        const plan = await evaluate("window.tanzaku.playback.load('a')")
        await evaluate(
            'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
        )
        const view = await evaluate(
            '({title:document.querySelector("#selected").textContent,notes:document.querySelectorAll(".note").length,width:document.querySelector(".note").style.width,index:Number(document.querySelector(".note").dataset.index)})',
        )
        assert.equal(view.title, 'Native Renamed')
        assert.equal(
            view.notes,
            plan.events.reduce((n, e) => n + e.keys.length, 0),
        )
        assert(
            Math.abs(
                parseFloat(view.width) - plan.events[view.index].hold * 120,
            ) < 0.001,
        )
        assert.equal(
            await evaluate('window.tanzaku.playback.toggleRepeat()'),
            true,
        )
        await evaluate('window.tanzaku.playback.seek(0.3)')
        await evaluate('window.tanzaku.playback.setSpeed(2)')
        const summary = await evaluate(
            `window.tanzaku.transcription.wavToMidi(${JSON.stringify(wavPath)},${JSON.stringify(midiPath)})`,
        )
        assert(summary.notes > 0)
        assert(fs.existsSync(midiPath))
        await evaluate("window.tanzaku.library.remove('a')")
        await evaluate(
            'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
        )
        assert.equal(
            await evaluate('document.querySelectorAll(".note").length'),
            0,
        )
        assert.deepEqual(
            (await evaluate('window.tanzaku.playlists.list()'))[0].trackIds,
            [],
        )
        let youtubeResult = null
        if (process.env.TANZAKU_SMOKE_YOUTUBE_URL) {
            const entry = await evaluate(
                `window.tanzaku.library.addYoutube(${JSON.stringify(process.env.TANZAKU_SMOKE_YOUTUBE_URL)})`,
                180000,
            )
            const generated = await evaluate(
                `window.tanzaku.playback.load(${JSON.stringify(entry.id)})`,
            )
            assert(generated.events.length > 0)
            assert(fs.existsSync(path.join(data, 'midi', entry.file)))
            youtubeResult = {
                title: entry.title,
                events: generated.events.length,
                duration: generated.duration,
            }
            await evaluate(
                `window.tanzaku.library.remove(${JSON.stringify(entry.id)})`,
            )
        }
        await evaluate("window.tanzaku.playback.load('b')")
        const navigation = await require('./smoke-navigation.cjs')({
            evaluate,
            send,
            data,
            artifacts,
        })
        await evaluate(
            'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
        )
        await evaluate('window.__smokeBeforeReload = true')
        await send('Page.reload')
        const reloadUntil = Date.now() + 30000
        while (
            !(await evaluate(
                'Boolean(window.tanzaku) && !window.__smokeBeforeReload && document.readyState === "complete"',
            )) &&
            Date.now() < reloadUntil
        )
            await sleep(100)
        await evaluate('window.tanzaku.ready')
        await evaluate(
            'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
        )
        const screenshot = await send('Page.captureScreenshot', {
            format: 'png',
        })
        fs.writeFileSync(
            path.join(artifacts, 'piano-roll.png'),
            Buffer.from(screenshot.data, 'base64'),
        )
        // Exercise presentation in an isolated window without starting the native
        // transport or sending input. This measures WebView rendering, not the game.
        const presentation = await evaluate(`(async()=>{
            const snapshot=await window.__TAURI__.core.invoke('playback_get_snapshot');
            const plan=snapshot.plan;const initial=snapshot.state;
            let sequence=initial.sequence;let index=0;let lastEmit=0;const active=new Set();const times=[];const tasks=[];
            const observer=typeof PerformanceObserver==='function'?new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push(entry.duration)}):null;
            try{observer?.observe({type:'longtask',buffered:false})}catch{}
            const start=performance.now();
            await new Promise(resolve=>{const frame=now=>{
                const position=Math.min(plan.duration,(now-start)/1000);
                while(index<plan.events.length&&plan.events[index].time<=position){active.add(index++);}
                for(const i of active)if(plan.events[i].time+plan.events[i].hold<=position)active.delete(i);
                if(now-lastEmit>=33){lastEmit=now;void window.__TAURI__.event.emit('playback-state',{...initial,status:'playing',speed:1,position,currentEventIndex:index,activeEventIndices:[...active],sequence:++sequence});}
                times.push(now);
                if(now-start<10000)requestAnimationFrame(frame);else resolve();
            };requestAnimationFrame(frame)});
            await window.__TAURI__.event.emit('playback-state',{...initial,status:'paused',activeEventIndices:[],sequence:++sequence});
            observer?.disconnect();
            return {kind:'simulated transport in actual WebView2',visibility:document.visibilityState,frames:times.length,fps:(times.length-1)*1000/(times.at(-1)-times[0]),longTasks:tasks.length,longestTaskMs:Math.max(0,...tasks)};
        })()`)
        assert(
            presentation.fps >= 60,
            `Presentation fell below 60 FPS: ${presentation.fps}`,
        )
        assert(
            presentation.longTasks <= 1,
            `Recurring long tasks: ${presentation.longTasks}`,
        )
        assert.deepEqual(errors, [])
        const result = {
            checks: 'real WebView2 + Tauri IPC + ONNX passed',
            presentation,
            navigation,
            youtube: youtubeResult,
            events: plan.events.length,
            transcribedNotes: summary.notes,
            screenshot: path.join(artifacts, 'piano-roll.png'),
            isolatedData: data,
        }
        fs.writeFileSync(
            path.join(artifacts, 'result.json'),
            JSON.stringify(result, null, 2),
        )
        console.log(JSON.stringify(result, null, 2))
    } catch (error) {
        failed = error
        console.error(error)
    } finally {
        if (evaluate) {
            try {
                await evaluate(
                    'void window.__TAURI__.window.getCurrentWindow().close()',
                )
            } catch {}
        }
        socket?.close()
        const until = Date.now() + 5000
        while (child.exitCode === null && Date.now() < until) await sleep(100)
        fs.writeFileSync(path.join(artifacts, 'process.log'), log)
        if (child.exitCode === null) {
            console.error(`Smoke app still running (PID ${child.pid})`)
            failed ??= new Error('App did not close normally')
        }
    }
    if (failed) throw failed
}
main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
