import { randomUUID } from 'node:crypto'
import { readPlaylists, type StorageLayout, writeJson } from './storage'
import type { Playlist } from './types'

export class PlaylistService {
    constructor(private readonly layout: StorageLayout) {}

    list(): Playlist[] {
        return readPlaylists(this.layout)
    }

    create(name: string): Playlist {
        const safeName = name.trim().slice(0, 100)
        if (!safeName) throw new Error('Nome de playlist inválido.')
        const playlist: Playlist = {
            id: randomUUID(),
            name: safeName,
            trackIds: [],
            createdAt: new Date().toISOString(),
        }
        writeJson(this.layout.playlists, [...this.list(), playlist])
        return playlist
    }

    addTrack(playlistId: string, trackId: string): Playlist {
        const playlists = this.list()
        const playlist = playlists.find((item) => item.id === playlistId)
        if (!playlist) throw new Error('Playlist não encontrada.')
        if (!playlist.trackIds.includes(trackId))
            playlist.trackIds.push(trackId)
        writeJson(this.layout.playlists, playlists)
        return playlist
    }

    removeTrack(playlistId: string, trackId: string): Playlist {
        const playlists = this.list()
        const playlist = playlists.find((item) => item.id === playlistId)
        if (!playlist) throw new Error('Playlist não encontrada.')
        playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId)
        writeJson(this.layout.playlists, playlists)
        return playlist
    }

    rename(playlistId: string, name: string): Playlist {
        const playlists = this.list()
        const playlist = playlists.find((item) => item.id === playlistId)
        if (!playlist) throw new Error('Playlist não encontrada.')
        const safeName = name.trim().slice(0, 100)
        if (!safeName) throw new Error('Nome de playlist inválido.')
        playlist.name = safeName
        writeJson(this.layout.playlists, playlists)
        return playlist
    }

    remove(playlistId: string): void {
        const playlists = this.list()
        if (!playlists.some((item) => item.id === playlistId))
            throw new Error('Playlist não encontrada.')
        writeJson(
            this.layout.playlists,
            playlists.filter((item) => item.id !== playlistId),
        )
    }
}
