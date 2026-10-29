// Queue and waveform checks in an isolated WebView. Playback is only simulated;
// no native Play command or keyboard input to the game is used.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

function variedMidi() {
    const events = []
    for (let step = 0; step < 360; step++) {
        if (step % 64 >= 52) continue
        const voices = 1 + (Math.floor(step / 24) % 6)
        for (let voice = 0; voice < voices; voice++) {
            const key = 48 + ((step + voice * 4) % 36)
            const start = step * 240
            events.push({ tick: start, order: 1, bytes: [0x90, key, 95] })
            events.push({
                tick: start + 120 + (step % 5) * 65,
                order: 0,
                bytes: [0x80, key, 0],
            })
        }
    }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order)
    const bytes = [0, 0xff, 0x51, 3, 7, 0xa1, 0x20]
    let previous = 0
    for (const event of events) {
        let delta = event.tick - previous
        const encoded = [delta & 127]
        while ((delta >>= 7) > 0) encoded.unshift((delta & 127) | 128)
        bytes.push(...encoded, ...event.bytes)
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

module.exports = async function playbackQueueSmoke({
    evaluate,
    send,
    data,
    artifacts,
}) {
    const file = path.join(data, 'library.json')
    const original = fs.readFileSync(file, 'utf8')
    const entries = JSON.parse(original)
    entries.push({
        id: 'waveform',
        title: 'Variações ao vento',
        file: 'waveform.mid',
        sourceUrl: null,
    })
    fs.writeFileSync(path.join(data, 'midi', 'waveform.mid'), variedMidi())
    fs.writeFileSync(file, JSON.stringify(entries))
    const frames = () =>
        evaluate(
            'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
        )
    const snapshot = () =>
        evaluate('window.__TAURI__.core.invoke("playback_get_snapshot")')
    const wait = async (expression) => {
        const until = Date.now() + 15000
        while (Date.now() < until) {
            if (await evaluate(expression)) return
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error('Queue smoke timed out: ' + expression)
    }
    const capture = async (name, width, height) => {
        await send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
        })
        await frames()
        const layout = await evaluate(
            '({width:innerWidth,scrollWidth:document.body.scrollWidth,bottom:document.querySelector(".transport-bar").getBoundingClientRect().bottom,height:innerHeight,bars:document.querySelectorAll(".waveform-base .recharts-bar-rectangle").length,chartHeight:document.querySelector(".waveform-seek").clientHeight})',
        )
        assert.equal(layout.width, layout.scrollWidth)
        assert(layout.bottom <= layout.height + 1)
        assert(layout.bars >= 48 && layout.bars <= 240)
        assert.equal(layout.chartHeight, height <= 700 ? 28 : 40)
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(
            path.join(artifacts, name + '.png'),
            Buffer.from(shot.data, 'base64'),
        )
    }
    let playlist
    try {
        await evaluate(
            'window.tanzaku.playback.load("b",{kind:"library",trackIds:["waveform","a","b"]})',
        )
        let current = await snapshot()
        assert.equal(current.queue.index, 2)
        assert.equal(current.queue.previous.id, 'a')
        assert.equal(current.queue.next, null)
        await evaluate('window.tanzaku.playback.previous()')
        assert.equal((await snapshot()).track.id, 'a')
        await evaluate('window.tanzaku.playback.next()')
        assert.equal((await snapshot()).track.id, 'b')
        await evaluate('window.tanzaku.playback.setShuffle(true)')
        const visited = new Set(['b'])
        while ((current = await snapshot()).queue.next) {
            const advertised = current.queue.next.id
            await evaluate('window.tanzaku.playback.next()')
            const loaded = await snapshot()
            assert.equal(loaded.track.id, advertised)
            assert(!visited.has(loaded.track.id))
            visited.add(loaded.track.id)
        }
        assert.equal(visited.size, 3)
        const last = (await snapshot()).track.id
        await evaluate('window.tanzaku.playback.previous()')
        await evaluate('window.tanzaku.playback.next()')
        assert.equal((await snapshot()).track.id, last)
        await evaluate('window.tanzaku.playback.setShuffle(false)')
        current = await snapshot()
        assert.equal(
            current.queue.index,
            ['waveform', 'a', 'b'].indexOf(current.track.id),
        )
        playlist = await evaluate(
            'window.tanzaku.playlists.create("Sessão do vento")',
        )
        const id = JSON.stringify(playlist.id)
        await evaluate(
            `window.tanzaku.playlists.addMany(${id},["a","b","waveform"])`,
        )
        await evaluate(
            `window.tanzaku.playback.load("b",{kind:"playlist",playlistId:${id}})`,
        )
        const generation = (await snapshot()).state.generation
        await evaluate(
            `window.tanzaku.playlists.reorder(${id},["waveform","a","b"])`,
        )
        assert.equal((await snapshot()).queue.next.id, 'waveform')
        await evaluate(
            `window.tanzaku.playlists.rename(${id},"Viagem entre acordes")`,
        )
        await evaluate(
            'window.tanzaku.library.rename("waveform","Variações ao vento")',
        )
        current = await snapshot()
        assert.equal(current.state.generation, generation)
        assert.equal(current.queue.playlist.name, 'Viagem entre acordes')
        assert.equal(current.queue.next.title, 'Variações ao vento')
        await evaluate(
            `window.tanzaku.playback.load("waveform",{kind:"playlist",playlistId:${id}})`,
        )
        current = await snapshot()
        assert.equal(current.queue.index, 0)
        assert.equal(current.queue.next.id, 'a')
        assert(current.plan.events.length > 500)
        await evaluate(
            `window.tanzaku.playback.seek(${current.plan.duration * 0.42},false)`,
        )
        await frames()
        await wait(
            'document.querySelector(".queue-source")?.textContent.includes("Viagem entre acordes")',
        )
        await capture('queue-waveform', 900, 920)
        await capture('queue-waveform-compact', 560, 780)
        await capture('queue-waveform-short', 900, 650)
        await capture('queue-waveform-narrow', 400, 700)
        await send('Emulation.setDeviceMetricsOverride', {
            width: 900,
            height: 920,
            deviceScaleFactor: 1,
            mobile: false,
        })
        await send('Emulation.setFocusEmulationEnabled', { enabled: true })
        await frames()
        const rect = await evaluate(
            '(()=>{const r=document.querySelector("#seek").getBoundingClientRect();return {x:r.x+8+(r.width-16)*0.7,y:r.y+r.height/2}})()',
        )
        await send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            button: 'left',
            clickCount: 1,
            ...rect,
        })
        await send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            button: 'left',
            clickCount: 1,
            ...rect,
        })
        await wait(
            `Math.abs(Number(document.querySelector("#seek").value)-${current.plan.duration * 0.7})<1`,
        )
        const pointerPosition = (await snapshot()).state.position
        assert(Math.abs(pointerPosition - current.plan.duration * 0.7) < 1)
        await evaluate('document.querySelector("#seek").focus()')
        await send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'ArrowRight',
            code: 'ArrowRight',
            windowsVirtualKeyCode: 39,
        })
        await send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'ArrowRight',
            code: 'ArrowRight',
            windowsVirtualKeyCode: 39,
        })
        await frames()
        assert((await snapshot()).state.position > pointerPosition)
        const presentation = await evaluate(`(async()=>{
            const snapshot=await window.__TAURI__.core.invoke('playback_get_snapshot');
            const times=[];const tasks=[];let mutations=0;
            const mutation=new MutationObserver(records=>mutations+=records.length);for(const chart of document.querySelectorAll('.waveform-art svg'))mutation.observe(chart,{subtree:true,attributes:true,childList:true});
            const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(entry=>entry.duration)));observer.observe({type:'longtask',buffered:false});
            let sequence=snapshot.state.sequence;let emitted=0;let index=snapshot.state.currentEventIndex;const start=performance.now();
            await new Promise(resolve=>{const frame=now=>{
                const position=Math.min(snapshot.plan.duration,snapshot.state.position+(now-start)/1000*snapshot.state.speed);
                while(index<snapshot.plan.events.length&&snapshot.plan.events[index].time<=position)index++;
                if(now-emitted>=33){emitted=now;void window.__TAURI__.event.emit('playback-state',{...snapshot.state,status:'playing',position,currentEventIndex:index,activeEventIndices:[],sequence:++sequence});}
                times.push(now);if(now-start<5000)requestAnimationFrame(frame);else resolve();
            };requestAnimationFrame(frame)});
            await window.__TAURI__.event.emit('playback-state',{...snapshot.state,status:'paused',sequence:++sequence});
            await new Promise(r=>requestAnimationFrame(r));mutation.disconnect();observer.disconnect();
            return {events:snapshot.plan.events.length,fps:(times.length-1)*1000/(times.at(-1)-times[0]),longTasks:tasks.length,chartMutations:mutations};
        })()`)
        assert(
            presentation.fps >= 60,
            `Waveform presentation: ${presentation.fps} FPS`,
        )
        assert.equal(presentation.chartMutations, 0)
        assert(presentation.longTasks <= 1)
        return {
            fullLibraryOrder: true,
            shuffleHistory: true,
            frozenPlaylistOrder: true,
            nextPreviewMatches: true,
            pointerAndKeyboardSeek: true,
            presentation,
        }
    } finally {
        await send('Emulation.clearDeviceMetricsOverride')
        await send('Emulation.setFocusEmulationEnabled', { enabled: false })
        fs.writeFileSync(file, original)
        await evaluate(
            'window.tanzaku.playback.load("a",{kind:"library",trackIds:["a","b"]})',
        )
        if (playlist)
            await evaluate(
                `window.tanzaku.playlists.remove(${JSON.stringify(playlist.id)})`,
            )
    }
}
