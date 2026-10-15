import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AppSettings, LibraryEntry, Playlist } from './types'

export type StorageLayout = {
    root: string
    midi: string
    plans: string
    library: string
    playlists: string
    settings: string
}

export type MigrationReport = {
    copiedMidi: number
    copiedPlans: number
    importedLibrary: boolean
    importedSettings: boolean
}

let writeCounter = 0

export function defaultStorageRoot(): string {
    if (process.env.TANZAKU_DATA_DIR)
        return path.resolve(process.env.TANZAKU_DATA_DIR)
    const appData =
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'Tanzaku')
}

export function createStorageLayout(
    root = defaultStorageRoot(),
): StorageLayout {
    const resolved = path.resolve(root)
    return {
        root: resolved,
        midi: path.join(resolved, 'midi'),
        plans: path.join(resolved, 'plans'),
        library: path.join(resolved, 'library.json'),
        playlists: path.join(resolved, 'playlists.json'),
        settings: path.join(resolved, 'settings.json'),
    }
}

export function ensureStorage(layout: StorageLayout): void {
    fs.mkdirSync(layout.midi, { recursive: true })
    fs.mkdirSync(layout.plans, { recursive: true })
}

export function safeFileName(value: string): string {
    const normalized = value
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\.+$/g, '')
    if (!normalized || normalized === '.' || normalized === '..')
        throw new Error('Nome de arquivo inválido.')
    return normalized.slice(0, 160)
}

export function resolveInside(root: string, candidate: string): string {
    const base = path.resolve(root)
    const resolved = path.resolve(candidate)
    if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
        throw new Error(
            'O caminho precisa permanecer dentro da pasta da biblioteca.',
        )
    }
    return resolved
}

export function readJson<T>(file: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T
    } catch {
        return fallback
    }
}

export function writeJson<T>(file: string, value: T): void {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${Date.now()}.${writeCounter++}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 4)}\n`, 'utf8')
    try {
        let lastError: unknown
        for (let attempt = 0; attempt < 8; attempt++) {
            try {
                fs.renameSync(temporary, file)
                return
            } catch (error) {
                lastError = error
                const code = (error as NodeJS.ErrnoException).code
                if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code ?? ''))
                    throw error
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
            }
        }
        throw lastError
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
}

export function readLibrary(layout: StorageLayout): LibraryEntry[] {
    return readJson<LibraryEntry[]>(layout.library, [])
}

export function readPlaylists(layout: StorageLayout): Playlist[] {
    return readJson<Playlist[]>(layout.playlists, [])
}

export function readSettings(layout: StorageLayout): AppSettings {
    return readJson<AppSettings>(layout.settings, {})
}

export function migrateLegacy(
    legacyRoot: string,
    target: StorageLayout,
): MigrationReport {
    ensureStorage(target)
    const source = path.resolve(legacyRoot)
    if (!fs.existsSync(source) || source === target.root) {
        return {
            copiedMidi: 0,
            copiedPlans: 0,
            importedLibrary: false,
            importedSettings: false,
        }
    }

    let copiedMidi = 0
    let copiedPlans = 0
    for (const [folder, destination, extension] of [
        ['midi-cache', target.midi, '.mid'],
        ['.plan-cache', target.plans, '.json'],
    ] as const) {
        const sourceFolder =
            folder === 'midi-cache' ? source : path.join(source, folder)
        if (!fs.existsSync(sourceFolder)) continue
        for (const name of fs.readdirSync(sourceFolder)) {
            if (!name.endsWith(extension)) continue
            const from = path.join(sourceFolder, name)
            const to = path.join(destination, name)
            if (!fs.existsSync(to)) {
                fs.copyFileSync(from, to)
                if (folder === 'midi-cache') copiedMidi++
                else copiedPlans++
            }
        }
    }

    let importedLibrary = false
    const oldLibrary = path.join(source, 'library.json')
    if (fs.existsSync(oldLibrary) && !fs.existsSync(target.library)) {
        fs.copyFileSync(oldLibrary, target.library)
        importedLibrary = true
    }
    let importedSettings = false
    const oldSettings = path.join(source, 'settings.json')
    if (fs.existsSync(oldSettings) && !fs.existsSync(target.settings)) {
        fs.copyFileSync(oldSettings, target.settings)
        importedSettings = true
    }
    return { copiedMidi, copiedPlans, importedLibrary, importedSettings }
}
