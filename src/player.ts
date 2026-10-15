#!/usr/bin/env node
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import readline from 'node:readline'
import { Midi } from '@tonejs/midi'
import {
    createStorageLayout,
    defaultStorageRoot,
    ensureStorage,
    migrateLegacy,
    readSettings,
} from './core/storage'
import { KeyboardState, KeyboardStroke } from './keyboard-state'
import {
    buildPlaybackPlan,
    Key,
    MidiNote,
    mapPitch,
    PlaybackPlan,
} from './planner'
import { isYoutubeUrl } from './url'

export type { Key, MidiNote, PlaybackPlan } from './planner'
export { buildPlaybackPlan, mapPitch } from './planner'
export { isYoutubeUrl } from './url'

type InputMode = 'scan' | 'vk' | 'unicode' | 'message'
type Plan = PlaybackPlan
type LibraryEntry = {
    id: string
    title: string
    file: string
    source?: string
    addedAt: string
}
type Acquired = {
    buf: Buffer
    title: string
    source?: string
    generated?: boolean
}

const args = process.argv.slice(2),
    flags: Record<string, string | boolean> = {},
    rest: string[] = []
for (const arg of args) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/)
    if (m) flags[m[1]] = m[2] ?? true
    else rest.push(arg)
}

const ROOT = path.resolve(__dirname, '..')
const LEGACY_CACHE = path.join(ROOT, 'midi-cache')
const DEFAULT_DATA_LAYOUT = createStorageLayout(defaultStorageRoot())
const DATA_LAYOUT = createStorageLayout(
    readSettings(DEFAULT_DATA_LAYOUT).storageRoot || DEFAULT_DATA_LAYOUT.root,
)
ensureStorage(DATA_LAYOUT)
if (
    DATA_LAYOUT.root === DEFAULT_DATA_LAYOUT.root &&
    !readSettings(DATA_LAYOUT).legacyMigrationDone
) {
    migrateLegacy(LEGACY_CACHE, DATA_LAYOUT)
    saveJson(DATA_LAYOUT.settings, {
        ...readSettings(DATA_LAYOUT),
        legacyMigrationDone: true,
    })
}
const CACHE = DATA_LAYOUT.midi
const INDEX = DATA_LAYOUT.library
const SETTINGS = DATA_LAYOUT.settings
const YOUTUBE_TRANSCRIBER = path.join(ROOT, 'tools', 'youtube_to_midi.py')
const VENV_PYTHON = path.join(ROOT, '.venv', 'Scripts', 'python.exe')
const TRANSCRIPTION_INSTALL =
    'uv venv --python 3.11 .venv; uv pip install --python .venv\\Scripts\\python.exe yt-dlp basic-pitch "setuptools<81"'
const modifierGapMs = 12
const defaults = {
    startDelay: 5,
    speed: 1,
    transpose: 0,
    maxPoly: 6,
    holdMs: 30,
    inputMode: 'wwm',
    chordWindowMs: 20,
    rollStepMs: 5,
    panicVk: 0x7a,
    inputModeNative: 'scan' as InputMode,
}
const stored = readJson<Partial<typeof defaults>>(SETTINGS, {})
const CFG = {
    ...defaults,
    ...stored,
    startDelay: Number(flags.delay ?? stored.startDelay ?? defaults.startDelay),
    speed: Number(flags.speed ?? stored.speed ?? defaults.speed),
    transpose: Number(
        flags.transpose ?? stored.transpose ?? defaults.transpose,
    ),
    maxPoly: Number(flags.maxpoly ?? stored.maxPoly ?? defaults.maxPoly),
    holdMs: Number(flags.hold ?? stored.holdMs ?? defaults.holdMs),
    chordWindowMs: Number(
        flags.chordwindow ?? stored.chordWindowMs ?? defaults.chordWindowMs,
    ),
    rollStepMs: Number(
        flags.rollstep ?? stored.rollStepMs ?? defaults.rollStepMs,
    ),
    lowC: 48,
    highC: 83,
    stopVk: 0x23,
    pauseVk: 0x24,
    panicVk: Number(flags.panicvk ?? stored.panicVk ?? defaults.panicVk),
    inputMode: String(
        flags.input ??
            stored.inputModeNative ??
            (stored as Partial<typeof defaults> & { inputMode?: string })
                .inputMode ??
            defaults.inputModeNative,
    ) as InputMode,
}

const SCAN: Record<string, number> = {
    Q: 0x10,
    W: 0x11,
    E: 0x12,
    R: 0x13,
    T: 0x14,
    Y: 0x15,
    U: 0x16,
    A: 0x1e,
    S: 0x1f,
    D: 0x20,
    F: 0x21,
    G: 0x22,
    H: 0x23,
    J: 0x24,
    Z: 0x2c,
    X: 0x2d,
    C: 0x2e,
    V: 0x2f,
    B: 0x30,
    N: 0x31,
    M: 0x32,
}
const VK: Record<string, number> = Object.fromEntries(
    Object.keys(SCAN).map((name) => [name, name.charCodeAt(0)]),
)
const MODS = { shift: 0x2a, ctrl: 0x1d },
    MOD_VK = { shift: 0xa0, ctrl: 0xa2 }
const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms))
let activePromptClose: (() => void) | null = null
let activeTerminalCleanup: (() => void) | null = null
let shuttingDown = false
let youtubePlaybackConsent: boolean | null = null

function restoreTerminal() {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode?.(false)
        process.stdin.resume()
    }
}

function cleanupTerminal() {
    activePromptClose?.()
    activePromptClose = null
    activeTerminalCleanup?.()
    activeTerminalCleanup = null
    restoreTerminal()
}

function handleSignal(signal: NodeJS.Signals) {
    if (shuttingDown) return
    shuttingDown = true
    cleanupTerminal()
    process.stdout.write(`\n\n⏹ Programa encerrado (${signal}).\n`)
    process.exitCode = signal === 'SIGINT' ? 130 : 143
    setImmediate(() => process.exit(process.exitCode))
}

process.once('SIGINT', () => handleSignal('SIGINT'))
process.once('SIGTERM', () => handleSignal('SIGTERM'))
// Alguns terminais integrados entregam Ctrl+C como byte de entrada em vez de
// emitir SIGINT. Esta proteção cobre esse caso sem interferir nas linhas normais.
process.stdin.on('data', (chunk: Buffer | string) => {
    if (String(chunk).includes('\u0003')) handleSignal('SIGINT')
})

const ask = (question: string) =>
    new Promise<string>((resolve) => {
        // A reprodução usa stdin em modo raw para atalhos. Sempre devolva o terminal
        // ao modo de linha antes de abrir um novo prompt do menu.
        if (process.stdin.isTTY) {
            process.stdin.setRawMode?.(false)
            process.stdin.resume()
        }
        // No PowerShell, o modo terminal do readline pode interceptar a linha antes
        // que ela chegue ao callback. Em modo não-terminal lemos somente a linha,
        // deixando o próprio console cuidar da edição e do eco dos caracteres.
        process.stdout.write(question)
        const rl = readline.createInterface({
            input: process.stdin,
            terminal: false,
        })
        activePromptClose = () => {
            rl.close()
            activePromptClose = null
        }
        rl.once('SIGINT', () => handleSignal('SIGINT'))
        rl.once('line', (answer) => {
            activePromptClose = null
            rl.close()
            resolve(answer.trim())
        })
    })
const fmt = (s: number) =>
    `${Math.floor(Math.max(0, s) / 60)
        .toString()
        .padStart(2, '0')}:${Math.floor(Math.max(0, s) % 60)
        .toString()
        .padStart(2, '0')}`
const line = (s: string) => process.stdout.write(`\r\x1b[2K${s}`)
function readJson<T>(file: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T
    } catch {
        return fallback
    }
}
function saveJson(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}
function safeName(title: string) {
    const clean =
        title
            .replace(/<[^>]+>/g, '')
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
            .replace(/[. ]+$/, '')
            .trim() || 'sem-titulo'
    return clean.slice(0, 150)
}
function midiToKey(m: number): Key | null {
    return mapPitch(m, CFG.lowC, CFG.highC)
}
const keyLabel = (k: Key) => k.label

type InputEvent = {
    sc: number
    vk?: number
    unicode?: number
    up?: boolean
    extended?: boolean
}
type Keyboard = {
    dry: boolean
    send: (events: InputEvent[], force?: boolean) => boolean
    isDown: (vk: number) => boolean
    diagnose: () => Promise<void>
}
function makeKeyboard(): Keyboard {
    if (process.platform !== 'win32' || flags.dry) {
        if (process.platform !== 'win32' && !flags.dry)
            console.log('⚠ Windows não detectado: modo --dry.')
        return {
            dry: true,
            send: () => true,
            isDown: () => false,
            diagnose: async () => undefined,
        }
    }
    if (process.arch !== 'x64')
        throw new Error('Este programa requer Node x64 no Windows.')
    const inputMode = (
        ['scan', 'vk', 'unicode', 'message'] as InputMode[]
    ).includes(CFG.inputMode)
        ? CFG.inputMode
        : 'scan'
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const SendInput = user32.func(
        'uint32 __stdcall SendInput(uint32, void *, int)',
    )
    const GetAsyncKeyState = user32.func(
        'int16 __stdcall GetAsyncKeyState(int)',
    )
    const GetLastError = kernel32.func('uint32 __stdcall GetLastError()')
    const GetForegroundWindow = user32.func(
        'void * __stdcall GetForegroundWindow()',
    )
    const GetWindowThreadProcessId = user32.func(
        'uint32 __stdcall GetWindowThreadProcessId(void *, uint32 *)',
    )
    const GetWindowTextA = user32.func(
        'int __stdcall GetWindowTextA(void *, char *, int)',
    )
    const IsUserAnAdmin = koffi
        .load('shell32.dll')
        .func('int __stdcall IsUserAnAdmin()')
    const PostMessageA = user32.func(
        'int __stdcall PostMessageA(void *, uint32, uintptr_t, intptr_t)',
    )
    const INPUT_SIZE = 40,
        WM_KEYDOWN = 0x0100,
        WM_KEYUP = 0x0101,
        WM_CHAR = 0x0102
    let targetPid: number | null = null,
        targetWindow: any = null,
        warnedFocus = false
    const foreground = () => {
        const hwnd = GetForegroundWindow()
        if (!hwnd) return { hwnd: null, pid: 0, title: '(nenhuma janela)' }
        const pidBuffer = Buffer.alloc(4)
        GetWindowThreadProcessId(hwnd, pidBuffer)
        const titleBuffer = Buffer.alloc(512)
        const length = Number(
            GetWindowTextA(hwnd, titleBuffer, titleBuffer.length),
        )
        return {
            hwnd,
            pid: pidBuffer.readUInt32LE(0),
            title:
                titleBuffer.toString('latin1', 0, Math.max(0, length)) ||
                '(sem título)',
        }
    }
    const describeTarget = () => {
        const info = foreground()
        const playerElevated = Boolean(IsUserAnAdmin())
        console.log(`\nDiagnóstico de entrada (${inputMode}):`)
        console.log(`  Janela em primeiro plano: ${info.title}`)
        console.log(`  PID alvo: ${info.pid || 'desconhecido'}`)
        console.log(`  Player elevado: ${playerElevated ? 'sim' : 'não'}`)
        console.log(
            '  Privilégio exato do alvo: consulte o Gerenciador de Tarefas; se o jogo estiver elevado, execute o player como administrador.',
        )
        return info
    }
    const lockTarget = (force = false) => {
        const info = foreground()
        if (targetPid === null && info.pid) {
            targetPid = info.pid
            targetWindow = info.hwnd
            console.log(`\n🎯 Alvo travado: ${info.title} (PID ${info.pid})`)
        }
        if (force && targetWindow) return true
        if (targetPid !== null && info.pid !== targetPid) {
            if (!warnedFocus) {
                warnedFocus = true
                console.warn(
                    `\n⚠ Foco mudou para "${info.title}" (PID ${info.pid}); eventos bloqueados para não digitar em outra janela.`,
                )
            }
            return false
        }
        return Boolean(info.pid)
    }
    const sendMessage = (events: InputEvent[], force = false) => {
        if (!lockTarget(force) || !targetWindow) return false
        for (const event of events) {
            const vk = event.vk ?? VK.A
            const scan = event.sc & 0xff
            const lParam =
                1 |
                (scan << 16) |
                (event.extended ? 0x01000000 : 0) |
                (event.up ? 0xc0000000 : 0) |
                0
            const message =
                event.unicode && !event.up
                    ? WM_CHAR
                    : event.up
                      ? WM_KEYUP
                      : WM_KEYDOWN
            PostMessageA(
                targetWindow,
                message,
                event.unicode && !event.up ? event.unicode : vk,
                lParam,
            )
        }
        return true
    }
    const sendInput = (events: InputEvent[], force = false) => {
        if (!events.length || !lockTarget(force)) return false
        const buf = Buffer.alloc(INPUT_SIZE * events.length)
        events.forEach((event, i) => {
            const o = i * INPUT_SIZE
            buf.writeUInt32LE(1, o)
            let vk = 0,
                scan = event.sc,
                inputFlags = 0
            if (inputMode === 'vk') {
                vk = event.vk ?? 0
                scan = 0
            } else if (inputMode === 'unicode') {
                scan = event.unicode ?? event.vk ?? 0
                inputFlags |= 0x0004
            } else inputFlags |= 0x0008
            if (event.extended) inputFlags |= 0x0001
            if (event.up) inputFlags |= 0x0002
            buf.writeUInt16LE(vk, o + 8)
            buf.writeUInt16LE(scan, o + 10)
            buf.writeUInt32LE(inputFlags, o + 12)
        })
        const sent = Number(SendInput(events.length, buf, INPUT_SIZE))
        if (sent !== events.length)
            console.warn(
                `\n⚠ SendInput enviou ${sent}/${events.length} eventos (erro ${Number(GetLastError())}). Verifique permissões/UIPI, foco e proteção do jogo.`,
            )
        return sent === events.length
    }
    const send = (events: InputEvent[], force = false) =>
        inputMode === 'message'
            ? sendMessage(events, force)
            : sendInput(events, force)
    const diagnose = async () => {
        console.log(
            `\nDiagnóstico (${inputMode}). Abra o Bloco de Notas ou o jogo e foque essa janela.`,
        )
        for (let seconds = 5; seconds > 0; seconds--) {
            line(`⏳ Capturando a janela em ${seconds}s...`)
            await sleep(1000)
        }
        const info = describeTarget()
        targetPid = null
        targetWindow = null
        warnedFocus = false
        if (!info.pid) {
            console.log('Nenhuma janela em primeiro plano foi encontrada.')
            return
        }
        console.log('Enviando a escala de teste; observe a janela em foco.')
        for (let midi = CFG.lowC; midi <= CFG.lowC + 35; midi++) {
            const key = midiToKey(midi)
            if (!key) continue
            const event = {
                sc: SCAN[key.name],
                vk: VK[key.name],
                unicode: key.name.charCodeAt(0),
            }
            send([event])
            await sleep(45)
            send([{ ...event, up: true }])
            await sleep(20)
        }
        console.log(
            'Diagnóstico concluído. Se o Bloco de Notas recebeu as letras e o jogo não, o jogo está rejeitando entrada sintetizada ou lendo uma camada diferente.',
        )
    }
    return {
        dry: false,
        send,
        isDown: (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0,
        diagnose,
    }
}

function loadLibrary(persist = false): LibraryEntry[] {
    fs.mkdirSync(CACHE, { recursive: true })
    const indexExists = fs.existsSync(INDEX)
    const stored = readJson<unknown>(INDEX, null)
    const entries = Array.isArray(stored)
        ? stored.filter((entry): entry is LibraryEntry => {
              if (!entry || typeof entry !== 'object') return false
              const candidate = entry as Partial<LibraryEntry>
              return (
                  typeof candidate.file === 'string' &&
                  typeof candidate.title === 'string' &&
                  fs.existsSync(path.join(CACHE, candidate.file))
              )
          })
        : []
    const byFile = new Map(entries.map((entry) => [entry.file, entry]))
    for (const file of fs
        .readdirSync(CACHE)
        .filter((file) => /\.mid$/i.test(file))) {
        if (!byFile.has(file))
            byFile.set(file, {
                id: file,
                title: path.basename(file, path.extname(file)),
                file,
                addedAt: new Date().toISOString(),
            })
    }
    const result = [...byFile.values()]
    const storedJson = Array.isArray(stored) ? JSON.stringify(stored) : null
    const resultJson = JSON.stringify(result)
    const changed = !indexExists || storedJson !== resultJson
    if (persist && changed) saveJson(INDEX, result)
    return result
}
function addLibrary(title: string, buf: Buffer, source?: string): LibraryEntry {
    const entries = loadLibrary(false)
    const base = safeName(title).replace(/\.mid$/i, '')
    let file = `${base}.mid`,
        n = 2
    while (fs.existsSync(path.join(CACHE, file))) file = `${base} (${n++}).mid`
    fs.writeFileSync(path.join(CACHE, file), buf)
    const entry = {
        id: file,
        title: base,
        file,
        source,
        addedAt: new Date().toISOString(),
    }
    saveJson(INDEX, [...entries, entry])
    return entry
}
function replaceLibrary(entries: LibraryEntry[]) {
    saveJson(INDEX, entries)
    return entries
}
function deleteLibraryEntry(entry: LibraryEntry) {
    const target = path.resolve(CACHE, entry.file)
    if (path.dirname(target) !== path.resolve(CACHE))
        throw new Error('Arquivo da biblioteca inválido.')
    if (fs.existsSync(target)) fs.unlinkSync(target)
    replaceLibrary(
        loadLibrary(false).filter((item) => item.file !== entry.file),
    )
}
function renameLibraryEntry(entry: LibraryEntry, title: string) {
    const base = safeName(title).replace(/\.mid$/i, '')
    if (!base) throw new Error('Nome inválido.')
    const nextFile = `${base}.mid`
    const oldPath = path.resolve(CACHE, entry.file),
        nextPath = path.resolve(CACHE, nextFile)
    if (nextFile !== entry.file && fs.existsSync(nextPath))
        throw new Error(`Já existe uma música chamada "${base}".`)
    fs.renameSync(oldPath, nextPath)
    const entries = loadLibrary(false).map((item) =>
        item.file === entry.file
            ? { ...item, id: nextFile, title: base, file: nextFile }
            : item,
    )
    replaceLibrary(entries)
    return entries.find((item) => item.file === nextFile)!
}

async function searchBitmidi(query: string) {
    const res = await fetch(
        `https://bitmidi.com/search?q=${encodeURIComponent(query)}`,
        { headers: { 'user-agent': 'Mozilla/5.0 (Tanzaku)' } },
    )
    if (!res.ok) throw new Error(`BitMidi respondeu ${res.status}`)
    const html = await res.text(),
        out: { title: string; page: string }[] = [],
        seen = new Set<string>(),
        re = /<a[^>]+href="(\/[^"]+?-mid)"[^>]*>([\s\S]*?)<\/a>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
        if (seen.has(m[1])) continue
        seen.add(m[1])
        out.push({
            title:
                m[2].replace(/<[^>]+>/g, '').trim() ||
                m[1].slice(1, -4).replace(/-/g, ' '),
            page: `https://bitmidi.com${m[1]}`,
        })
    }
    return out.slice(0, 10)
}
async function downloadUrl(url: string) {
    const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Tanzaku)' },
    })
    if (!res.ok) throw new Error(`Download falhou: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
}
async function downloadBitmidi(page: string) {
    const html = await (
        await fetch(page, {
            headers: { 'user-agent': 'Mozilla/5.0 (Tanzaku)' },
        })
    ).text()
    const m =
        html.match(
            /(?:https?:\/\/bitmidi\.com)?(\/uploads\/[^"'\s<>]+\.mid)/i,
        ) || html.match(/href="([^"]+\.mid)"/i)
    if (!m) throw new Error('Não encontrei o link do MIDI no BitMidi.')
    return downloadUrl(
        m[1].startsWith('http') ? m[1] : `https://bitmidi.com${m[1]}`,
    )
}

function youtubeUrlHasPlaylist(input: string) {
    try {
        const url = new URL(input)
        return /\/playlist$/i.test(url.pathname) || url.searchParams.has('list')
    } catch {
        return false
    }
}
type CommandResult = { stdout: string; stderr: string }
function runCommand(
    command: string,
    args: string[],
    cwd?: string,
    onOutput?: (chunk: string) => void,
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, windowsHide: true })
        let stdout = '',
            stderr = ''
        child.stdout.on('data', (chunk) => {
            const text = chunk.toString()
            stdout += text
            onOutput?.(text)
        })
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString()
            stderr += text
            onOutput?.(text)
        })
        child.once('error', (error) =>
            reject(
                Object.assign(new Error(`${command}: ${error.message}`), {
                    code: (error as NodeJS.ErrnoException).code,
                }),
            ),
        )
        child.once('close', (code) =>
            code === 0
                ? resolve({ stdout, stderr })
                : reject(
                      new Error(
                          `${command} terminou com código ${code}. ${stderr.trim() || stdout.trim()}`,
                      ),
                  ),
        )
    })
}
async function pythonCommand(
    args: string[],
    cwd?: string,
    onOutput?: (chunk: string) => void,
) {
    const candidates = [VENV_PYTHON, 'python', 'python3'].filter(
        (command, index) => (index === 0 ? fs.existsSync(command) : true),
    )
    let lastError: unknown
    for (const command of candidates) {
        try {
            return await runCommand(command, args, cwd, onOutput)
        } catch (error) {
            lastError = error
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error('Python não encontrado.')
}
function downloadProgress(chunk: string) {
    const match = chunk.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
    if (!match) return
    const percent = Math.min(100, Math.max(0, Number(match[1])))
    const width = 28,
        filled = Math.round((width * percent) / 100)
    line(
        `⬇ Baixando áudio [${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${percent.toFixed(1)}%`,
    )
}
async function withSpinner<T>(label: string, action: () => Promise<T>) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    let index = 0
    const timer = setInterval(
        () => line(`${frames[index++ % frames.length]} ${label}`),
        120,
    )
    try {
        return await action()
    } finally {
        clearInterval(timer)
        line(`✔ ${label}`)
        process.stdout.write('\n')
    }
}
async function findFirstFile(directory: string, extensions: string[]) {
    const files = (await fs.promises.readdir(directory)).filter((file) =>
        extensions.some((extension) => file.toLowerCase().endsWith(extension)),
    )
    return files.length ? path.join(directory, files[0]) : null
}
async function transcribeYoutube(
    url: string,
): Promise<{ buf: Buffer; title: string }> {
    if (youtubeUrlHasPlaylist(url))
        throw new Error(
            'URLs de playlist não são suportadas; informe a URL de um vídeo individual.',
        )
    if (!fs.existsSync(YOUTUBE_TRANSCRIBER))
        throw new Error(
            `Script de transcrição não encontrado: ${YOUTUBE_TRANSCRIBER}`,
        )
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'tanzaku-'))
    try {
        let title = 'musica do YouTube'
        try {
            const metadata = await pythonCommand([
                '-m',
                'yt_dlp',
                '--no-playlist',
                '--print',
                '%(title)s',
                '--skip-download',
                url,
            ])
            title =
                metadata.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ||
                title
        } catch (error) {
            const message = String(
                error instanceof Error ? error.message : error,
            )
            if (/No module named ['"]?yt_dlp|not found|ENOENT/i.test(message))
                throw new Error(
                    `yt-dlp não está instalado. Execute: ${TRANSCRIPTION_INSTALL}`,
                )
            throw new Error(
                `Não foi possível obter os dados do vídeo: ${message}`,
            )
        }
        try {
            await pythonCommand(
                [
                    '-m',
                    'yt_dlp',
                    '--no-playlist',
                    '--no-warnings',
                    '--newline',
                    '-f',
                    'bestaudio/best',
                    '-o',
                    path.join(temporary, 'audio.%(ext)s'),
                    url,
                ],
                undefined,
                downloadProgress,
            )
            process.stdout.write('\n')
        } catch (error) {
            const message = String(
                error instanceof Error ? error.message : error,
            )
            if (/No module named ['"]?yt_dlp|not found|ENOENT/i.test(message))
                throw new Error(
                    `yt-dlp não está instalado. Execute: ${TRANSCRIPTION_INSTALL}`,
                )
            throw new Error(`Falha ao baixar o áudio do YouTube: ${message}`)
        }
        const sourceAudio = await findFirstFile(temporary, [
            '.webm',
            '.m4a',
            '.mp4',
            '.opus',
            '.wav',
        ])
        if (!sourceAudio)
            throw new Error(
                'O vídeo não forneceu uma faixa de áudio compatível.',
            )
        const wav = path.join(temporary, 'audio.wav')
        try {
            await withSpinner('Convertendo áudio para WAV...', () =>
                runCommand('ffmpeg', [
                    '-y',
                    '-i',
                    sourceAudio,
                    '-vn',
                    '-ac',
                    '1',
                    '-ar',
                    '22050',
                    wav,
                ]),
            )
        } catch (error) {
            const message = String(
                error instanceof Error ? error.message : error,
            )
            if (/ENOENT|not found/i.test(message))
                throw new Error(
                    'FFmpeg não está instalado ou não está no PATH.',
                )
            throw new Error(`Falha ao converter o áudio para WAV: ${message}`)
        }
        const midi = path.join(temporary, 'transcribed.mid')
        try {
            await withSpinner('Transcrevendo áudio para MIDI...', () =>
                pythonCommand([YOUTUBE_TRANSCRIBER, wav, midi]),
            )
        } catch (error) {
            const message = String(
                error instanceof Error ? error.message : error,
            )
            if (
                /No module named ['"]?basic_pitch|Basic Pitch não está instalado/i.test(
                    message,
                )
            )
                throw new Error(
                    `Basic Pitch não está instalado. Execute: ${TRANSCRIPTION_INSTALL}`,
                )
            throw new Error(`Falha na transcrição para MIDI: ${message}`)
        }
        if (!fs.existsSync(midi) || fs.statSync(midi).size === 0)
            throw new Error('A transcrição não produziu um arquivo MIDI.')
        const buf = fs.readFileSync(midi)
        const parsed = new Midi(buf)
        if (!parsed.tracks.some((track) => track.notes.length))
            throw new Error(
                'A transcrição não encontrou notas musicais no áudio.',
            )
        youtubePlaybackConsent =
            Boolean(flags.yes) ||
            (await ask('Tocar agora? [S/n]: ')).toLowerCase() !== 'n'
        return { buf, title: safeName(title) }
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
}
async function checkTranscriptionDependencies() {
    console.log('\nDiagnóstico da transcrição YouTube:')
    const check = async (label: string, action: () => Promise<unknown>) => {
        try {
            await action()
            console.log(`  ✔ ${label}`)
            return true
        } catch (error) {
            console.log(
                `  ✖ ${label}: ${error instanceof Error ? error.message : error}`,
            )
            return false
        }
    }
    const python = await check('Python 3', () => pythonCommand(['--version']))
    const yt = python
        ? await check('yt-dlp', () => pythonCommand(['-c', 'import yt_dlp']))
        : false
    const basicPitch = python
        ? await check('Basic Pitch', () =>
              pythonCommand([
                  '-c',
                  'from basic_pitch.inference import predict',
              ]),
          )
        : false
    const ffmpeg = await check('FFmpeg', () =>
        runCommand('ffmpeg', ['-version']),
    )
    if (!(python && yt && basicPitch && ffmpeg))
        console.log(`  Instalação recomendada: ${TRANSCRIPTION_INSTALL}`)
    else console.log('✔ Todas as dependências estão prontas.')
}
async function acquire(input: string): Promise<Acquired> {
    if (fs.existsSync(input))
        return {
            buf: fs.readFileSync(input),
            title: path.basename(input, path.extname(input)),
            source: input,
        }
    if (isYoutubeUrl(input)) {
        console.log('⬇ Baixando e transcrevendo o áudio do YouTube...')
        const result = await transcribeYoutube(input)
        const saved = addLibrary(result.title, result.buf, input)
        console.log(`✔ MIDI salvo na biblioteca como ${saved.file}`)
        return { ...result, source: input, generated: true }
    }
    if (/^https?:\/\//i.test(input))
        return {
            buf: await downloadUrl(input),
            title: path.basename(new URL(input).pathname) || 'musica',
            source: input,
        }
    console.log(`🔎 Buscando "${input}"...`)
    const results = await searchBitmidi(input)
    if (!results.length) throw new Error('Nenhum resultado encontrado.')
    results.forEach((r, i) => console.log(`  ${i + 1}) ${r.title}`))
    const n = flags.yes ? 1 : Number(await ask('Escolha [1]: ')) || 1,
        pick = results[Math.max(0, Math.min(n - 1, results.length - 1))]
    return {
        buf: await downloadBitmidi(pick.page),
        title: pick.title,
        source: pick.page,
    }
}

function midiNotes(midi: Midi, tracks: number[]): MidiNote[] {
    return tracks.flatMap((index) =>
        midi.tracks[index].notes.map((note) => ({
            time: note.time,
            pitch: note.midi,
            velocity: note.velocity,
            duration: note.duration,
        })),
    )
}

function planCachePath(buf: Buffer, tracks: number[]): string {
    const key = crypto
        .createHash('sha256')
        .update(buf)
        .update(
            JSON.stringify({
                tracks,
                lowC: CFG.lowC,
                highC: CFG.highC,
                transpose: CFG.transpose,
                maxPoly: CFG.maxPoly,
                holdMs: CFG.holdMs,
                chordWindowMs: CFG.chordWindowMs,
                rollStepMs: CFG.rollStepMs,
                map: 'wwm-v3-no-transpose',
            }),
        )
        .digest('hex')
    const directory = DATA_LAYOUT.plans
    fs.mkdirSync(directory, { recursive: true })
    return path.join(directory, `${key}.json`)
}

function buildPlan(midi: Midi, tracks: number[], buf?: Buffer): Plan {
    const cache = buf && planCachePath(buf, tracks)
    if (cache && fs.existsSync(cache)) {
        const cached = readJson<Plan | null>(cache, null)
        if (cached?.events && Array.isArray(cached.events)) {
            console.log('  ⚡ Plano carregado do cache.')
            return cached
        }
    }
    const plan = buildPlaybackPlan(midiNotes(midi, tracks), {
        lowPitch: CFG.lowC,
        highPitch: CFG.highC,
        transpose: CFG.transpose,
        maxPoly: CFG.maxPoly,
        holdMs: CFG.holdMs,
        chordWindowMs: CFG.chordWindowMs,
        rollStepMs: CFG.rollStepMs,
    })
    if (cache) saveJson(cache, plan)
    console.log('  ⚙ Plano recalculado.')
    return plan
}
function tracePlan(plan: Plan) {
    console.log('\nDiagnóstico do plano (tempo → teclas):')
    plan.events.forEach((event, index) => {
        const keys = event.keys.map(keyLabel).join(' ')
        console.log(
            `${String(index + 1).padStart(3)} | ${event.time.toFixed(3).padStart(8)}s | ${keys.padEnd(12)} | duração ${event.hold.toFixed(3)}s`,
        )
    })
}
function testPlan(): Plan {
    const events = Array.from({ length: 36 }, (_, i) => ({
        time: i * 0.45,
        hold: CFG.holdMs / 1000,
        keys: [midiToKey(CFG.lowC + i)!],
    }))
    return {
        events,
        duration: 16.5,
        stats: { notes: 36, groups: 36, shift: 0, dropped: 0 },
    }
}

async function playPlanRobust(kb: Keyboard, plan: Plan) {
    const state = { stopped: false, paused: false }
    // The plan already serializes rolled chord notes at 5ms. A second 12ms
    // modifier delay here would destroy that timing, so playback uses the
    // state machine's safe ordering without adding another scheduler delay.
    const inputState = new KeyboardState((events) => kb.send(events), sleep, 0)
    let start = 0,
        pausedAt = 0,
        started = false,
        last = ''
    const stroke = (key: Key): KeyboardStroke => ({
        sc: SCAN[key.name],
        vk: VK[key.name],
        unicode: key.name.charCodeAt(0),
        modifier: key.modifier,
    })
    const releaseAll = () => inputState.reset()
    const stop = () => {
        if (state.stopped) return
        state.stopped = true
        releaseAll()
    }
    const togglePause = () => {
        if (!started || state.stopped) return
        const now = performance.now()
        if (!state.paused) {
            state.paused = true
            pausedAt = now
            releaseAll()
        } else {
            start += now - pausedAt
            state.paused = false
        }
    }
    const onKey = (_: string, key?: readline.Key) => {
        if (!key) return
        if (
            key.name === 'q' ||
            key.name === 'escape' ||
            (key.ctrl && key.name === 'c')
        )
            stop()
        else if (key.name === 'space') togglePause()
    }
    let raw = false
    if (process.stdin.isTTY) {
        readline.emitKeypressEvents(process.stdin)
        process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.on('keypress', onKey)
        raw = true
    }
    let prevStop = false,
        prevPause = false
    let prevPanic = false
    const poll = setInterval(() => {
        const s = kb.isDown(CFG.stopVk),
            p = kb.isDown(CFG.pauseVk),
            panic = kb.isDown(CFG.panicVk)
        if (s && !prevStop) stop()
        if (p && !prevPause) togglePause()
        if (panic && !prevPanic) stop()
        prevStop = s
        prevPause = p
        prevPanic = panic
    }, 25)
    const ui = setInterval(() => {
        if (!started || state.stopped) return
        const elapsed =
                ((state.paused ? pausedAt : performance.now()) - start) / 1000,
            total = plan.duration / CFG.speed
        line(
            `${state.paused ? '⏸' : '▶'} ${fmt(elapsed)}/${fmt(total)} ${last}`,
        )
    }, 150)
    let cleaned = false
    const onExit = () => releaseAll()
    const cleanup = () => {
        if (cleaned) return
        cleaned = true
        clearInterval(poll)
        clearInterval(ui)
        if (raw) {
            process.stdin.removeListener('keypress', onKey)
            restoreTerminal()
        }
        process.removeListener('exit', onExit)
        releaseAll()
        if (activeTerminalCleanup === cleanup) activeTerminalCleanup = null
    }
    activeTerminalCleanup = cleanup
    process.once('exit', onExit)
    console.log(
        `\nControles: [End]/[F11] parar · [Home] pausar · [q]/[Esc] parar · [Espaço] pausar\n`,
    )
    for (let s = CFG.startDelay; s > 0 && !state.stopped; s--) {
        line(`⏳ Foque no jogo... começando em ${s}s`)
        await sleep(1000)
    }
    if (!state.stopped) {
        started = true
        start = performance.now()
        let i = 0
        while (i < plan.events.length && !state.stopped) {
            if (state.paused) {
                await sleep(40)
                continue
            }
            const wait =
                start +
                (plan.events[i].time / CFG.speed) * 1000 -
                performance.now()
            if (wait > 4) {
                await sleep(Math.min(wait - 3, 40))
                continue
            }
            if (wait > 0) {
                await new Promise<void>((resolve) => setImmediate(resolve))
                continue
            }
            const event = plan.events[i++]
            await inputState.press(
                event.keys.map(stroke),
                Math.max(CFG.holdMs, event.hold * 1000),
            )
            last = event.keys.map(keyLabel).join(' ')
        }
        const lastEvent = plan.events.at(-1)
        const tail = lastEvent
            ? (lastEvent.time / CFG.speed) * 1000 +
              Math.max(CFG.holdMs, lastEvent.hold * 1000) +
              100
            : 0
        const remaining =
            Math.max((plan.duration / CFG.speed) * 1000, tail) -
            (performance.now() - start)
        if (!state.stopped && remaining > 0) await sleep(remaining)
    }
    cleanup()
    console.log(state.stopped ? '\n⏹ Interrompido.' : '\n✔ Fim da música.')
}
async function playPlan(kb: Keyboard, plan: Plan) {
    if (youtubePlaybackConsent === false) {
        youtubePlaybackConsent = null
        console.log('MIDI salvo; reprodução cancelada pelo usuário.')
        return
    }
    youtubePlaybackConsent = null
    return playPlanRobust(kb, plan)
}
async function selectTracks(midi: Midi) {
    const usable: number[] = []
    midi.tracks.forEach((track, i) => {
        const percussion = track.instrument.percussion || track.channel === 9
        if (!percussion && track.notes.length) usable.push(i)
        console.log(
            `  [${i + 1}] ${(track.name || '(sem nome)').slice(0, 28).padEnd(28)} ${String(track.notes.length).padStart(5)} notas${percussion ? ' (percussão)' : ''}`,
        )
    })
    const configured =
        flags.tracks && flags.tracks !== true ? String(flags.tracks) : ''
    const answer =
        configured ||
        (flags.yes ? '' : await ask('Faixas (ex: 1,3; Enter = melodia): '))
    let selected: number[]
    if (answer) {
        selected = answer
            .split(',')
            .map((x) => Number(x) - 1)
            .filter((i) => midi.tracks[i])
    } else if (flags.alltracks || flags['all-tracks']) {
        selected = usable
    } else {
        const score = (i: number) => {
            const notes = midi.tracks[i].notes
            const first = notes[0]?.time ?? 0
            const last = notes.at(-1)?.time ?? first
            const span = Math.max(1, last - first)
            const average =
                notes.reduce((sum, note) => sum + note.midi, 0) / notes.length
            const density = notes.length / span
            const range =
                Math.max(...notes.map((note) => note.midi)) -
                Math.min(...notes.map((note) => note.midi))
            return average + range * 0.5 - density * 2
        }
        selected = usable.length
            ? [
                  usable.reduce(
                      (best, i) => (score(i) > score(best) ? i : best),
                      usable[0],
                  ),
              ]
            : []
        if (selected.length)
            console.log(
                `  🎵 Seleção automática: faixa ${selected[0] + 1} (melodia). Use --all-tracks ou --tracks para escolher outra combinação.`,
            )
    }
    if (!selected.length) throw new Error('Nenhuma faixa válida.')
    return selected
}
async function playBuffer(kb: Keyboard, buf: Buffer, title: string) {
    try {
        const midi = new Midi(buf)
        console.log(
            `\n♪ ${title} — duração ${fmt(midi.duration)} — ${midi.tracks.length} faixas`,
        )
        const selected = await selectTracks(midi)
        const plan = buildPlan(midi, selected, buf)
        console.log(
            `Notas: ${plan.stats.notes} · instantes: ${plan.stats.groups} · acordes: ${plan.stats.chords} · roll: ${plan.stats.rolled} · transposição: ${plan.stats.shift} · descartadas: ${plan.stats.dropped}`,
        )
        if (flags.tracePlan || flags['trace-plan']) tracePlan(plan)
        if (!flags.yes)
            await ask(
                `ENTER para iniciar (${CFG.startDelay}s para focar no jogo)... `,
            )
        await playPlan(kb, plan)
    } finally {
        cleanupTerminal()
        restoreTerminal()
    }
}

async function settingsMenu() {
    while (true) {
        console.log(
            `\nConfigurações: velocidade=${CFG.speed}, atraso=${CFG.startDelay}s, transposição manual=${CFG.transpose}, polifonia=${CFG.maxPoly}, hold=${CFG.holdMs}ms, acorde=${CFG.chordWindowMs}ms, roll=${CFG.rollStepMs}ms, panic=F${CFG.panicVk === 0x7a ? '11' : CFG.panicVk}, entrada=${CFG.inputMode}`,
        )
        const choice = await ask(
            'Alterar (speed/delay/transpose/maxpoly/hold/chordWindowMs/rollStepMs/panicVk/inputMode) ou Enter para voltar: ',
        )
        if (!choice) return
        const key = choice.toLowerCase()
        const normalizedKey: string = key === 'inputmode' ? 'inputMode' : key
        if (!(normalizedKey in defaults)) {
            console.log('Opção inválida.')
            continue
        }
        const value = await ask(`Novo valor para ${normalizedKey}: `)
        if (normalizedKey === 'inputMode')
            (CFG as any)[normalizedKey] = (
                ['scan', 'vk', 'unicode', 'message'] as InputMode[]
            ).includes(value as InputMode)
                ? value
                : 'scan'
        else (CFG as any)[normalizedKey] = Number(value)
        saveJson(SETTINGS, {
            startDelay: CFG.startDelay,
            speed: CFG.speed,
            transpose: CFG.transpose,
            maxPoly: CFG.maxPoly,
            holdMs: CFG.holdMs,
            chordWindowMs: CFG.chordWindowMs,
            rollStepMs: CFG.rollStepMs,
            panicVk: CFG.panicVk,
            inputModeNative: CFG.inputMode,
        })
    }
}
async function libraryMenu() {
    while (true) {
        const entries = loadLibrary(true)
        console.log('\n=== Biblioteca ===')
        if (!entries.length) console.log('Biblioteca vazia.')
        else
            entries.forEach((entry, index) =>
                console.log(`  ${index + 1}) ${entry.title} — ${entry.file}`),
            )
        console.log('1) Atualizar/listar\n2) Renomear\n3) Excluir\n4) Voltar')
        const choice = (await ask('Biblioteca: '))
            .replace(/\s/g, '')
            .toLowerCase()
        if (choice === '4' || choice === 'q' || !choice) return
        if (choice === '1') {
            loadLibrary(true)
            console.log('✔ Biblioteca atualizada.')
            continue
        }
        if (!entries.length) {
            console.log('Biblioteca vazia.')
            continue
        }
        const index =
            Number((await ask('Número da música: ')).replace(/[^0-9]/g, '')) - 1
        const entry = entries[index]
        if (!entry) {
            console.log('Escolha inválida.')
            continue
        }
        if (choice === '2') {
            const renamed = renameLibraryEntry(
                entry,
                await ask(`Novo nome para "${entry.title}": `),
            )
            console.log(`✔ Renomeada para ${renamed.title}.`)
        } else if (choice === '3') {
            const confirmation = (
                await ask(`Excluir "${entry.title}" definitivamente? [s/N]: `)
            ).toLowerCase()
            if (confirmation === 's' || confirmation === 'sim') {
                deleteLibraryEntry(entry)
                console.log('✔ Arquivo e registro removidos.')
            }
        } else console.log('Opção inválida.')
    }
}

async function menu(kb: Keyboard) {
    while (true) {
        const library = loadLibrary(false)
        console.log(
            '\n=== Tanzaku ===\n1) Tocar música salva\n2) Buscar e baixar\n3) Abrir MIDI local ou URL\n4) Escala de teste\n5) Configurações\n6) Gerenciar biblioteca\n7) Sair',
        )
        const choice = (await ask('Digite uma opção (1-7) e pressione Enter: '))
            .replace(/\s/g, '')
            .toLowerCase()
        try {
            if (choice === '1') {
                if (!library.length) {
                    console.log('Biblioteca vazia.')
                    continue
                }
                library.forEach((entry, index) =>
                    console.log(`  ${index + 1}) ${entry.title}`),
                )
                const n =
                    Number((await ask('Música: ')).replace(/[^0-9]/g, '')) - 1
                const entry = library[n]
                if (!entry) {
                    console.log('Escolha inválida.')
                    continue
                }
                await playBuffer(
                    kb,
                    fs.readFileSync(path.join(CACHE, entry.file)),
                    entry.title,
                )
            } else if (choice === '2') {
                const found = await acquire(await ask('Nome da música: '))
                if (!found.generated) {
                    const entry = addLibrary(
                        found.title,
                        found.buf,
                        found.source,
                    )
                    console.log(`✔ Salva como ${entry.file}`)
                }
                if ((await ask('Tocar agora? [s/N]: ')).toLowerCase() === 's')
                    await playBuffer(kb, found.buf, found.title)
            } else if (choice === '3') {
                const found = await acquire(await ask('Caminho ou URL: '))
                await playBuffer(kb, found.buf, found.title)
            } else if (choice === '4') {
                await playPlan(kb, testPlan())
            } else if (choice === '5') {
                await settingsMenu()
            } else if (choice === '6') {
                await libraryMenu()
            } else if (choice === '7' || choice === 'q') {
                return
            } else {
                console.log('Opção inválida. Digite um número de 1 a 7.')
            }
        } catch (error) {
            console.error(
                `\n✖ ${error instanceof Error ? error.message : error}`,
            )
        }
    }
}

async function main() {
    if (flags.help || flags.h) {
        console.log(
            'Use sem argumentos para abrir o menu. Flags: --test --dry --trace-plan --check-deps --diagnose-input --input=scan|vk|unicode|message --speed=1 --transpose=0 --maxpoly=6 --chordwindow=20 --rollstep=5 --panicvk=122 --tracks=1,2 --all-tracks --yes',
        )
        return
    }
    if (flags.checkDeps || flags['check-deps']) {
        await checkTranscriptionDependencies()
        return
    }
    const kb = makeKeyboard()
    if (kb.dry) console.log('[DRY-RUN] nenhuma tecla será enviada.')
    if (flags.diagnoseInput || flags['diagnose-input']) {
        await kb.diagnose()
        return
    }
    if (flags.test) {
        await playPlan(kb, testPlan())
        return
    }
    if (rest.length) {
        const found = await acquire(rest.join(' '))
        await playBuffer(kb, found.buf, found.title)
        return
    }
    await menu(kb)
    process.stdin.pause()
}
if (
    require.main === module ||
    path.basename(require.main?.filename ?? '') === 'player.js'
)
    main().catch((error) => {
        cleanupTerminal()
        console.error(`\n✖ ${error instanceof Error ? error.message : error}`)
        process.exitCode = 1
    })
