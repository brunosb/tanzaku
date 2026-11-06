// Real IPC, native shortcut registration and persistence, without sending keys.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

async function withOccupiedShortcut(check) {
    const modernShell = path.join(
        process.env.ProgramFiles ?? 'C:/Program Files',
        'PowerShell',
        '7',
        'pwsh.exe',
    )
    const helper = spawn(
        fs.existsSync(modernShell)
            ? modernShell
            : path.join(
                  process.env.SystemRoot,
                  'System32',
                  'WindowsPowerShell',
                  'v1.0',
                  'powershell.exe',
              ),
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(__dirname, 'hold-shortcut.ps1'),
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    helper.stdin.on('error', () => {})
    try {
        const key = await new Promise((resolve, reject) => {
            let output = ''
            const timer = setTimeout(
                () => reject(new Error(`Shortcut helper timed out: ${output}`)),
                20000,
            )
            helper.stdout.on('data', (chunk) => {
                output += chunk
                const ready = output.match(/READY:(F\d+)/)
                if (ready) {
                    clearTimeout(timer)
                    resolve(ready[1])
                }
            })
            helper.stderr.on('data', (chunk) => {
                output += chunk
            })
            helper.once('error', (error) => {
                clearTimeout(timer)
                reject(error)
            })
            helper.once('exit', (code) => {
                clearTimeout(timer)
                reject(new Error(`Shortcut helper exited (${code}): ${output}`))
            })
        })
        await check(`Control+Alt+Shift+${key}`)
    } finally {
        if (helper.exitCode === null) {
            helper.stdin.end('\n')
            await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    helper.kill()
                    resolve()
                }, 5000)
                helper.once('exit', () => {
                    clearTimeout(timer)
                    resolve()
                })
            })
        }
    }
}

module.exports = async function settingsSmoke({
    evaluate,
    send,
    data,
    artifacts,
}) {
    const initial = await evaluate('window.tanzaku.settings.get()')
    const settingsFile = path.join(data, 'settings.json')
    const bindings = { ...initial.shortcuts, pause: 'Control+Alt+Shift+F21' }
    const save = (value) =>
        evaluate(`window.tanzaku.settings.update(${JSON.stringify(value)})`)
    const next = await save({ startMode: 'countdown', shortcuts: bindings })
    assert.equal(next.startMode, 'countdown')
    assert.deepEqual(next.shortcutWarnings, [])
    const before = fs.readFileSync(settingsFile)
    await withOccupiedShortcut(async (occupied) => {
        assert.equal(
            await evaluate(
                `window.tanzaku.settings.update(${JSON.stringify({ shortcuts: { ...bindings, pause: occupied } })}).then(()=>false,()=>true)`,
            ),
            true,
        )
        assert.deepEqual(fs.readFileSync(settingsFile), before)
        assert.deepEqual(
            (await evaluate('window.tanzaku.settings.get()')).shortcuts,
            bindings,
        )
    })
    for (const invalid of [
        { shortcuts: { ...bindings, play: bindings.pause } },
        { shortcuts: { ...bindings, play: 'Control+KeyA' } },
        { startMode: 'invalid' },
    ]) {
        assert.equal(
            await evaluate(
                `window.tanzaku.settings.update(${JSON.stringify(invalid)}).then(()=>false,()=>true)`,
            ),
            true,
        )
        assert.deepEqual(fs.readFileSync(settingsFile), before)
    }
    // Windows read-only destination rejects the atomic replacement after registration.
    fs.chmodSync(settingsFile, 0o444)
    try {
        assert.equal(
            await evaluate(
                `window.tanzaku.settings.update(${JSON.stringify({ shortcuts: { ...bindings, pause: 'Control+Alt+Shift+F22' } })}).then(()=>false,()=>true)`,
            ),
            true,
        )
    } finally {
        fs.chmodSync(settingsFile, 0o666)
    }
    assert.deepEqual(fs.readFileSync(settingsFile), before)
    assert.deepEqual(
        (await evaluate('window.tanzaku.settings.get()')).shortcuts,
        bindings,
    )
    const other = path.join(data, 'settings-library')
    fs.mkdirSync(other)
    fs.writeFileSync(
        path.join(other, 'settings.json'),
        JSON.stringify({
            startMode: 'game-focus',
            shortcuts: initial.shortcuts,
        }),
    )
    await evaluate(
        `window.tanzaku.storage.chooseDirectory(${JSON.stringify(other)})`,
    )
    assert.equal(
        (await evaluate('window.tanzaku.settings.get()')).startMode,
        'game-focus',
    )
    await evaluate(
        `window.tanzaku.storage.chooseDirectory(${JSON.stringify(data)})`,
    )
    assert.equal(
        (await evaluate('window.tanzaku.settings.get()')).startMode,
        'countdown',
    )
    await save({ startMode: initial.startMode, shortcuts: initial.shortcuts })

    const waitFor = async (expression) => {
        const until = Date.now() + 15000
        while (Date.now() < until) {
            if (await evaluate(expression)) return
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error(`Settings smoke timed out: ${expression}`)
    }
    await evaluate(
        "document.querySelectorAll('[data-close-button]').forEach(button => button.click())",
    )
    await waitFor("!document.querySelector('[data-sonner-toast]')")
    await evaluate("window.tanzaku.playback.load('b')")
    for (const page of ['settings', 'about']) {
        await evaluate(`location.hash='/${page}'`)
        await waitFor(
            page === 'settings'
                ? "Boolean(document.querySelector('.shortcut-row'))"
                : "Boolean(document.querySelector('.about-card dd'))",
        )
        const screenshot = await send('Page.captureScreenshot', {
            format: 'png',
        })
        fs.writeFileSync(
            path.join(artifacts, `${page}.png`),
            Buffer.from(screenshot.data, 'base64'),
        )
    }
    const info = await evaluate('window.tanzaku.app.info()')
    assert.equal(info.author, 'brunosb')
    assert.equal(info.version, require('../../package.json').version)
    assert.equal(
        await evaluate(
            `document.querySelector('.about-card').textContent.includes(${JSON.stringify(info.version)})`,
        ),
        true,
    )
    assert.equal(
        await evaluate(
            "window.__TAURI__.core.invoke('app_open_project_link',{target:'invalid'}).then(()=>false,()=>true)",
        ),
        true,
    )
    await evaluate("location.hash='/player'")
    return {
        nativeRegistration: true,
        nativeConflictRollback: true,
        rejectedUpdatesPreserveFile: true,
        failedWriteRestoresPreferences: true,
        storageRestoresPreferences: true,
        nativeVersion: info.version,
    }
}
