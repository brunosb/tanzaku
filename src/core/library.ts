import fs from 'node:fs'
import path from 'node:path'
import {
    readLibrary,
    resolveInside,
    type StorageLayout,
    safeFileName,
    writeJson,
} from './storage'
import type { LibraryEntry } from './types'

export class LibraryService {
    constructor(private readonly layout: StorageLayout) {}

    list(): LibraryEntry[] {
        return readLibrary(this.layout)
    }

    add(entry: LibraryEntry): LibraryEntry {
        const entries = this.list().filter((item) => item.id !== entry.id)
        entries.push(entry)
        writeJson(this.layout.library, entries)
        return entry
    }

    rename(id: string, title: string): LibraryEntry {
        const entries = this.list()
        const entry = entries.find((item) => item.id === id)
        if (!entry) throw new Error('Música não encontrada na biblioteca.')
        const safeTitle = safeFileName(title)
        const oldFile = resolveInside(
            this.layout.midi,
            path.join(this.layout.midi, path.basename(entry.file)),
        )
        const newFile = resolveInside(
            this.layout.midi,
            path.join(this.layout.midi, `${safeTitle}.mid`),
        )
        if (oldFile !== newFile && fs.existsSync(newFile))
            throw new Error('Já existe um MIDI com esse nome.')
        if (oldFile !== newFile && fs.existsSync(oldFile))
            fs.renameSync(oldFile, newFile)
        entry.title = title.trim()
        entry.file = path.basename(newFile)
        writeJson(this.layout.library, entries)
        return entry
    }

    remove(id: string): void {
        const entries = this.list()
        const entry = entries.find((item) => item.id === id)
        if (!entry) throw new Error('Música não encontrada na biblioteca.')
        const file = resolveInside(
            this.layout.midi,
            path.join(this.layout.midi, path.basename(entry.file)),
        )
        if (fs.existsSync(file)) fs.unlinkSync(file)
        writeJson(
            this.layout.library,
            entries.filter((item) => item.id !== id),
        )
    }
}
