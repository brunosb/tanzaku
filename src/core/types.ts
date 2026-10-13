import type { Key, PlaybackEvent, PlaybackPlan } from './planner';

export type { Key, PlaybackEvent, PlaybackPlan } from './planner';

export type PlaybackStatus =
    | 'idle'
    | 'countdown'
    | 'playing'
    | 'paused'
    | 'stopped'
    | 'ended';

export type PlaybackState = {
    status: PlaybackStatus;
    position: number;
    duration: number;
    speed: number;
    currentEventIndex: number;
};

export type LibraryEntry = {
    id: string;
    title: string;
    file: string;
    sourceUrl?: string;
    duration?: number;
    addedAt?: string;
};

export type Playlist = {
    id: string;
    name: string;
    trackIds: string[];
    createdAt: string;
};

export type AppSettings = {
    storageRoot?: string;
    legacyMigrationDone?: boolean;
    speed?: number;
    maxPoly?: number;
    overlay?: {
        x: number;
        y: number;
        width: number;
        height: number;
        visible: boolean;
    };
};

export type PlaybackListener = (state: PlaybackState) => void;
export type PlaybackEventListener = (
    event: PlaybackEvent,
    index: number,
) => void;

export type PlaybackEngine = {
    load(plan: PlaybackPlan): void;
    play(): void;
    pause(): void;
    stop(): void;
    seek(positionSeconds: number): void;
    setSpeed(speed: number): void;
    getState(): PlaybackState;
    onStateChange(listener: PlaybackListener): () => void;
    onEvent(listener: PlaybackEventListener): () => void;
};
