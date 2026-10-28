import type { TanzakuApi } from '@/shared/api/contracts'
import type { PlaybackStore } from './playback-store'
export type PlaybackContext = {
    api: TanzakuApi
    playback: PlaybackStore
    navigate: (path: string) => void
}
