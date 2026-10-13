import type { PlaybackPlan } from './planner';
import type {
    PlaybackEngine,
    PlaybackEventListener,
    PlaybackListener,
    PlaybackState,
} from './types';

type Clock = () => number;
type Timer = ReturnType<typeof setTimeout>;
type Release = () => void;

export type PlaybackEngineOptions = {
    dispatch?: (event: PlaybackPlan['events'][number], index: number) => void;
    release?: Release;
    clock?: Clock;
    tickMs?: number;
};

export function createPlaybackEngine(
    options: PlaybackEngineOptions = {},
): PlaybackEngine {
    const clock = options.clock ?? (() => performance.now());
    const tickMs = Math.max(16, options.tickMs ?? 33);
    const listeners = new Set<PlaybackListener>();
    const eventListeners = new Set<PlaybackEventListener>();
    let plan: PlaybackPlan = { events: [], duration: 0, stats: {} };
    let state: PlaybackState = {
        status: 'idle',
        position: 0,
        duration: 0,
        speed: 1,
        currentEventIndex: 0,
    };
    let startedAt = 0;
    let generation = 0;
    let eventTimer: Timer | undefined;
    let tickTimer: Timer | undefined;

    const emitState = () => {
        for (const listener of listeners) listener({ ...state });
    };

    const release = () => options.release?.();

    const clearTimers = () => {
        if (eventTimer) clearTimeout(eventTimer);
        if (tickTimer) clearTimeout(tickTimer);
        eventTimer = undefined;
        tickTimer = undefined;
    };

    const positionNow = () => {
        if (state.status !== 'playing') return state.position;
        const elapsed = ((clock() - startedAt) / 1000) * state.speed;
        return Math.max(0, Math.min(state.duration, elapsed));
    };

    const finish = () => {
        clearTimers();
        state.position = state.duration;
        state.status = 'ended';
        release();
        emitState();
    };

    const scheduleEvents = (token: number) => {
        if (token !== generation || state.status !== 'playing') return;

        const position = positionNow();
        while (
            state.currentEventIndex < plan.events.length &&
            plan.events[state.currentEventIndex].time <= position + 0.000001
        ) {
            const index = state.currentEventIndex++;
            const event = plan.events[index];
            options.dispatch?.(event, index);
            for (const listener of eventListeners) listener(event, index);
        }

        const next = plan.events[state.currentEventIndex];
        if (!next) return;
        const delay = Math.max(
            1,
            ((next.time - position) / state.speed) * 1000,
        );
        eventTimer = setTimeout(() => scheduleEvents(token), delay);
    };

    const scheduleTick = (token: number) => {
        if (token !== generation || state.status !== 'playing') return;
        state.position = positionNow();
        if (state.position >= state.duration) {
            finish();
            return;
        }
        emitState();
        tickTimer = setTimeout(() => scheduleTick(token), tickMs);
    };

    return {
        load(nextPlan) {
            clearTimers();
            generation++;
            release();
            plan = nextPlan;
            state = {
                ...state,
                status: 'idle',
                position: 0,
                duration: nextPlan.duration,
                currentEventIndex: 0,
            };
            emitState();
        },

        play() {
            if (!plan.events.length || state.status === 'playing') return;
            if (state.status === 'ended' || state.status === 'stopped') {
                state.position = 0;
                state.currentEventIndex = 0;
            }
            state.status = 'playing';
            startedAt = clock() - (state.position / state.speed) * 1000;
            const token = ++generation;
            emitState();
            scheduleEvents(token);
            scheduleTick(token);
        },

        pause() {
            if (state.status !== 'playing') return;
            state.position = positionNow();
            state.status = 'paused';
            clearTimers();
            generation++;
            release();
            emitState();
        },

        stop() {
            clearTimers();
            generation++;
            release();
            state = {
                ...state,
                status: 'stopped',
                position: 0,
                currentEventIndex: 0,
            };
            emitState();
        },

        seek(positionSeconds) {
            clearTimers();
            generation++;
            release();
            const safePosition = Number.isFinite(positionSeconds)
                ? positionSeconds
                : 0;
            state.position = Math.max(
                0,
                Math.min(state.duration, safePosition),
            );
            state.currentEventIndex = plan.events.findIndex(
                (event) => event.time >= state.position,
            );
            if (state.currentEventIndex < 0)
                state.currentEventIndex = plan.events.length;
            state.status = 'paused';
            emitState();
        },

        setSpeed(speed) {
            const next = Number.isFinite(speed)
                ? Math.max(0.1, Math.min(4, speed))
                : 1;
            if (state.status === 'playing') {
                state.position = positionNow();
                startedAt = clock() - (state.position / next) * 1000;
                clearTimers();
                const token = ++generation;
                scheduleEvents(token);
                scheduleTick(token);
            }
            state.speed = next;
            emitState();
        },

        getState: () => ({ ...state }),

        onStateChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        onEvent(listener) {
            eventListeners.add(listener);
            return () => eventListeners.delete(listener);
        },
    };
}
