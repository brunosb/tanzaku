// Runs only in the isolated smoke WebView. No native playback is started.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

module.exports = async function navigationSmoke({
    evaluate,
    send,
    data,
    artifacts,
}) {
    const before = await evaluate(
        "window.__TAURI__.core.invoke('playback_get_snapshot')",
    )
    const file = path.join(data, 'library.json')
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'))
    entries.push(
        ...Array.from({ length: 10000 }, (_, i) => ({
            id: `grid${i}`,
            title:
                i === 0
                    ? 'Águas do Céu'
                    : `Canção ${String(i).padStart(5, '0')}`,
            file: 'b.mid',
            sourceUrl: i % 2 ? 'https://youtu.be/smoke' : null,
        })),
    )
    fs.writeFileSync(file, JSON.stringify(entries))
    const playlist = await evaluate(
        "window.tanzaku.playlists.create('Coleção de teste')",
    )
    const q = JSON.stringify(playlist.id)
    await evaluate(
        `window.tanzaku.playlists.addMany(${q},['b','grid0','grid1','grid1'])`,
    )
    assert.deepEqual(
        (
            await evaluate(
                `window.tanzaku.playlists.reorder(${q},['grid1','b','grid0'])`,
            )
        ).trackIds,
        ['grid1', 'b', 'grid0'],
    )
    assert.equal(
        await evaluate(
            `window.tanzaku.playlists.reorder(${q},['b']).then(()=>false,()=>true)`,
        ),
        true,
    )
    const listFile = path.join(data, 'playlists.json')
    const lists = JSON.parse(fs.readFileSync(listFile, 'utf8'))
    lists.find((p) => p.id === playlist.id).trackIds.push('missing')
    fs.writeFileSync(listFile, JSON.stringify(lists))
    const wait = async (expression) => {
        const until = Date.now() + 15000
        while (Date.now() < until) {
            if (await evaluate(expression)) return
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error(`Navigation smoke timed out: ${expression}`)
    }
    const frames = () =>
        evaluate(
            'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
        )
    const route = async (value) => {
        await evaluate(`location.hash=${JSON.stringify(value)}`)
        await frames()
    }
    const input = async (selector, value) => {
        await evaluate(
            `(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        )
        await frames()
    }
    const clickText = async (selector, text) => {
        const rect = await evaluate(
            `(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el)throw new Error('Missing control: '+${JSON.stringify(text)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
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
        await frames()
    }
    const screenshot = async (name) => {
        const value = await send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(
            path.join(artifacts, `${name}.png`),
            Buffer.from(value.data, 'base64'),
        )
    }
    await evaluate('window.__navigationReload=true')
    await send('Page.reload')
    await wait(
        "Boolean(window.tanzaku) && !window.__navigationReload && document.readyState==='complete'",
    )
    await evaluate('window.tanzaku.ready')
    await route('/library')
    await wait('document.querySelectorAll("tbody tr").length===20')
    const started = Date.now()
    await input('[data-page-search]', ' AGUAS ')
    await wait(
        'document.querySelectorAll("tbody tr").length===1 && document.querySelector("tbody").textContent.includes("Águas do Céu")',
    )
    const searchMs = Date.now() - started
    assert(searchMs < 1000, `10k library search took ${searchMs}ms`)
    await route('/playlists')
    await route('/library')
    assert.equal(
        await evaluate('document.querySelector("[data-page-search]").value'),
        ' AGUAS ',
    )
    await input('[data-page-search]', '')
    await wait('document.querySelectorAll("tbody tr").length===20')
    await evaluate(
        `document.querySelector('[aria-label="Selecionar página"]').click()`,
    )
    await wait(
        'document.querySelector(".selection-bar").textContent.includes("20 selecionadas")',
    )
    await evaluate(
        `document.querySelector('[aria-label="Próxima página"]').click()`,
    )
    await wait(
        'document.querySelector(".page-number").textContent.startsWith("2")',
    )
    await evaluate('document.querySelector("tbody [role=checkbox]").click()')
    await wait(
        'document.querySelector(".selection-bar").textContent.includes("21 selecionadas")',
    )
    await clickText('.selection-bar button', 'Adicionar à playlist')
    await wait('Boolean(document.querySelector("[role=dialog]"))')
    await input('[role=dialog] input[type=search]', 'colecao')
    const choice = await evaluate(
        'document.querySelector(".playlist-choice").textContent.trim()',
    )
    await clickText('.playlist-choice', choice)
    await wait('!document.querySelector("[role=dialog]")')
    const updated = (await evaluate('window.tanzaku.playlists.list()')).find(
        (p) => p.id === playlist.id,
    )
    assert(updated.trackIds.length >= 21)
    assert.equal(
        await evaluate(
            'getComputedStyle(document.querySelector("[data-sonner-toaster]")).position',
        ),
        'fixed',
    )
    await screenshot('library')
    await route('/playlists')
    await wait('document.querySelectorAll(".playlist-card").length===2')
    await screenshot('playlists')
    await route(`/playlists/${encodeURIComponent(playlist.id)}`)
    await wait('document.querySelector("h1")?.textContent==="Coleção de teste"')
    await input('[data-page-search]', 'indisponivel')
    await wait('document.querySelectorAll("tbody tr").length===1')
    assert(
        (
            await evaluate('document.querySelector("tbody").textContent')
        ).includes('referência preservada'),
    )
    await clickText('.hint button', 'Limpar busca para reorganizar')
    await wait('document.querySelectorAll("tbody tr").length===20')
    // Use actual pointer events to open Radix's menu in the WebView.
    const rect = await evaluate(
        '(()=>{const r=document.querySelector("tbody [data-slot=dropdown-menu-trigger]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
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
    await wait('Boolean(document.querySelector("[role=menu]"))')
    await clickText('[role=menuitem]', 'Mover abaixo')
    await wait('!document.querySelector("[role=menu]")')
    await wait(
        'document.querySelector("tbody .track-name")?.textContent.includes("Smoke b")',
    )
    assert.equal(
        (await evaluate('window.tanzaku.playlists.list()')).find(
            (p) => p.id === playlist.id,
        ).trackIds[0],
        'b',
    )
    await screenshot('playlist-detail')
    await route('/player')
    await wait('document.querySelectorAll(".note").length>0')
    await send('Emulation.setDeviceMetricsOverride', {
        width: 560,
        height: 780,
        deviceScaleFactor: 1,
        mobile: false,
    })
    await frames()
    assert(
        await evaluate(
            'document.querySelector(".transport-bar").getBoundingClientRect().bottom<=innerHeight+1',
        ),
    )
    await screenshot('compact-player')
    await send('Emulation.clearDeviceMetricsOverride')
    await frames()
    const after = await evaluate(
        "window.__TAURI__.core.invoke('playback_get_snapshot')",
    )
    assert.equal(after.state.generation, before.state.generation)
    assert.equal(after.track.id, before.track.id)
    assert.equal(after.state.status, before.state.status)
    return {
        tracks: entries.length,
        pageSize: 20,
        search10kMs: searchMs,
        selectedAcrossPages: 21,
        nativeBulkAndReorder: true,
        preservedPlayback: true,
    }
}
