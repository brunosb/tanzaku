import fs from 'node:fs';
import path from 'node:path';
import { Midi } from '@tonejs/midi';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron';
import { KeyboardState } from '../core/keyboard-state';
import { LibraryService } from '../core/library';
import {
    buildPlaybackPlan,
    type Key,
    type MidiNote,
    type PlaybackPlan,
} from '../core/planner';
import { createPlaybackEngine } from '../core/playback-engine';
import { PlaylistService } from '../core/playlists';
import {
    createStorageLayout,
    defaultStorageRoot,
    ensureStorage,
    migrateLegacy,
    readSettings,
    type StorageLayout,
    safeFileName,
    writeJson,
} from '../core/storage';
import { type AppSettings } from '../core/types';
import { transcribeYoutube } from '../core/youtube-acquisition';
import {
    createWindowsKeyboard,
    keyboardStroke,
} from '../platform/windows-input';

let controlWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let layout: StorageLayout;
let library: LibraryService;
let playlistService: PlaylistService;
let loadedId: string | null = null;
let currentPlan: PlaybackPlan | null = null;
let playbackStartToken = 0;
let countdownActive = false;
let repeatEnabled = false;
let queue: { ids: string[]; index: number; shuffle: boolean } | null = null;

const focusCountdownSeconds = 5;

const keyboard = createWindowsKeyboard(false);
const keyboardState = new KeyboardState(
    (events, force) => keyboard.send(events, force),
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
);
const engine = createPlaybackEngine({
    dispatch: (event, index) => {
        void keyboardState.press(
            event.keys.map((key: Key) =>
                keyboardStroke(key.name, key.modifier),
            ),
            event.hold * 1000,
        );
        broadcast('playback:event', { event, index });
    },
    release: () => keyboardState.reset(),
});

function broadcast(channel: string, payload: unknown): void {
    controlWindow?.webContents.send(channel, payload);
    overlayWindow?.webContents.send(channel, payload);
}

function requiredString(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 300)
        throw new Error(`${name} inválido.`);
    return value.trim();
}

function finiteNumber(value: unknown, name: string): number {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${name} inválido.`);
    return number;
}

function rendererFile(): string {
    return path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html');
}

function createWindows(): void {
    controlWindow = new BrowserWindow({
        width: 1180,
        height: 780,
        minWidth: 900,
        minHeight: 560,
        frame: false,
        backgroundColor: '#080b0d',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    overlayWindow = new BrowserWindow({
        width: 1000,
        height: 300,
        frame: false,
        transparent: true,
        show: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    void controlWindow.loadFile(rendererFile());
    void overlayWindow.loadFile(rendererFile(), { query: { overlay: '1' } });
    controlWindow.on('closed', () => {
        controlWindow = null;
        if (overlayWindow) overlayWindow.close();
    });
}

function midiNotes(midi: Midi): MidiNote[] {
    return midi.tracks.flatMap((track) =>
        track.notes.map((note) => ({
            time: note.time,
            pitch: note.midi,
            velocity: note.velocity,
            duration: note.duration,
        })),
    );
}

function loadPlan(id: string): PlaybackPlan {
    const entry = library.list().find((item) => item.id === id);
    if (!entry) throw new Error('Música não encontrada.');
    const file = path.join(layout.midi, path.basename(entry.file));
    const plan = buildPlaybackPlan(midiNotes(new Midi(fs.readFileSync(file))), {
        lowPitch: 48,
        highPitch: 83,
        transpose: 0,
        maxPoly: 6,
        holdMs: 30,
        chordWindowMs: 20,
        rollStepMs: 5,
    });
    if (!plan.events.length)
        throw new Error('O MIDI não possui notas utilizáveis.');
    loadedId = id;
    currentPlan = plan;
    engine.load(plan);
    broadcast('playback:track', { id, title: entry.title });
    broadcast('playback:plan', plan);
    return plan;
}

function rememberStorageRoot(root: string): void {
    const pointerLayout = createStorageLayout(defaultStorageRoot());
    const pointerSettings = readSettings(pointerLayout);
    writeJson(pointerLayout.settings, {
        ...pointerSettings,
        storageRoot: root,
    });
}

function clearLoadedTrack(): void {
    cancelPendingStart();
    queue = null;
    loadedId = null;
    currentPlan = null;
    engine.load({ events: [], duration: 0, stats: {} });
    broadcast('playback:track', {
        id: '',
        title: 'Selecione uma música',
    });
    broadcast('playback:plan', { events: [], duration: 0, stats: {} });
}

function shuffled<T>(values: T[]): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
        const target = Math.floor(Math.random() * (index + 1));
        [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
}

function advanceQueue(): void {
    if (!queue) {
        if (!repeatEnabled || !loadedId) return;
        queue = { ids: [loadedId], index: 0, shuffle: false };
    } else if (queue.index + 1 < queue.ids.length) {
        queue.index++;
    } else if (repeatEnabled) {
        queue.index = 0;
        if (queue.shuffle) queue.ids = shuffled(queue.ids);
    } else {
        queue = null;
        return;
    }

    const nextId = queue.ids[queue.index];
    if (!nextId) return;
    try {
        loadPlan(nextId);
        // Mantém o alvo travado entre músicas da mesma fila.
        engine.play();
    } catch (error) {
        console.error('Falha ao avançar a playlist:', error);
        queue = null;
    }
}

function addMidiToLibrary(
    title: string,
    buffer: Buffer,
    sourceUrl?: string,
): {
    id: string;
    title: string;
    file: string;
    sourceUrl?: string;
    addedAt: string;
} {
    const safeTitle = safeFileName(title);
    let file = `${safeTitle}.mid`;
    let count = 2;
    while (fs.existsSync(path.join(layout.midi, file)))
        file = `${safeTitle} (${count++}).mid`;
    fs.writeFileSync(path.join(layout.midi, file), buffer);
    const entry = {
        id: file,
        title: title.trim(),
        file,
        ...(sourceUrl ? { sourceUrl } : {}),
        addedAt: new Date().toISOString(),
    };
    library.add(entry);
    return entry;
}

async function playPlaylist(
    playlistId: string,
    mode: 'order' | 'shuffle',
): Promise<void> {
    const playlist = playlistService
        .list()
        .find((item) => item.id === playlistId);
    if (!playlist) throw new Error('Playlist não encontrada.');
    const entries = library.list();
    const ids = playlist.trackIds.filter((id) =>
        entries.some((entry) => entry.id === id),
    );
    if (!ids.length) throw new Error('A playlist não possui músicas válidas.');
    queue = {
        ids: mode === 'shuffle' ? shuffled(ids) : ids,
        index: 0,
        shuffle: mode === 'shuffle',
    };
    cancelPendingStart();
    loadPlan(queue.ids[0]);
    await startPlayback();
}

async function startPlayback(): Promise<void> {
    if (
        !currentPlan?.events.length ||
        engine.getState().status === 'playing' ||
        countdownActive
    )
        return;

    const token = ++playbackStartToken;
    countdownActive = true;
    console.log(
        `▶ Reprodução começará em ${focusCountdownSeconds}s. Foque a janela do jogo ou do teste.`,
    );

    for (let remaining = focusCountdownSeconds; remaining > 0; remaining--) {
        broadcast('playback:countdown', { remaining });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (token !== playbackStartToken) {
            countdownActive = false;
            return;
        }
    }

    countdownActive = false;
    broadcast('playback:countdown', { remaining: 0 });
    if (!keyboard.arm()) {
        console.warn('⚠ Não foi possível identificar a janela em foco.');
        return;
    }
    console.log('🎯 Janela-alvo armada para o envio das teclas.');
    engine.play();
}

function cancelPendingStart(): void {
    if (!countdownActive) return;
    playbackStartToken++;
    countdownActive = false;
    broadcast('playback:countdown', { remaining: 0 });
}

function setupIpc(): void {
    ipcMain.handle('window:minimize', () => controlWindow?.minimize());
    ipcMain.handle('window:toggle-maximize', () => {
        if (!controlWindow) return false;
        if (controlWindow.isMaximized()) controlWindow.unmaximize();
        else controlWindow.maximize();
        return controlWindow.isMaximized();
    });
    ipcMain.handle('window:close', () => controlWindow?.close());
    ipcMain.handle('library:list', () => library.list());
    ipcMain.handle('library:open', (_event, id: unknown) => {
        cancelPendingStart();
        queue = null;
        return loadPlan(requiredString(id, 'ID'));
    });
    ipcMain.handle('library:rename', (_event, id: unknown, title: unknown) =>
        library.rename(
            requiredString(id, 'ID'),
            requiredString(title, 'Título'),
        ),
    );
    ipcMain.handle('library:delete', (_event, id: unknown) => {
        const entryId = requiredString(id, 'ID');
        if (loadedId === entryId) {
            cancelPendingStart();
            engine.stop();
        }
        if (queue) {
            queue.ids = queue.ids.filter((trackId) => trackId !== entryId);
            if (!queue.ids.length) queue = null;
        }
        library.remove(entryId);
        return library.list();
    });
    ipcMain.handle('library:import', async () => {
        const selected = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }],
        });
        if (selected.canceled || !selected.filePaths[0]) return null;
        const source = selected.filePaths[0];
        const title = path.basename(source, path.extname(source));
        return addMidiToLibrary(title, fs.readFileSync(source));
    });
    ipcMain.handle('library:add-youtube', async (_event, value: unknown) => {
        const sourceUrl = requiredString(value, 'URL');
        const result = await transcribeYoutube(sourceUrl, (progress) =>
            broadcast('youtube:progress', progress),
        );
        return addMidiToLibrary(result.title, result.buffer, result.sourceUrl);
    });
    ipcMain.handle('playback:load', (_event, id: unknown) => {
        cancelPendingStart();
        queue = null;
        return loadPlan(requiredString(id, 'ID'));
    });
    ipcMain.handle('playback:play', () => startPlayback());
    ipcMain.handle('playback:pause', () => {
        cancelPendingStart();
        engine.pause();
    });
    ipcMain.handle('playback:stop', () => {
        cancelPendingStart();
        queue = null;
        engine.stop();
    });
    ipcMain.handle('playback:toggle-repeat', () => {
        repeatEnabled = !repeatEnabled;
        return repeatEnabled;
    });
    ipcMain.handle('playlist:list', () => playlistService.list());
    ipcMain.handle('playlist:create', (_event, name: unknown) =>
        playlistService.create(requiredString(name, 'Nome')),
    );
    ipcMain.handle('playlist:rename', (_event, id: unknown, name: unknown) =>
        playlistService.rename(
            requiredString(id, 'ID'),
            requiredString(name, 'Nome'),
        ),
    );
    ipcMain.handle('playlist:delete', (_event, id: unknown) => {
        const playlistId = requiredString(id, 'ID');
        playlistService.remove(playlistId);
        return playlistService.list();
    });
    ipcMain.handle(
        'playlist:add',
        (_event, playlistId: unknown, trackId: unknown) => {
            const safeTrackId = requiredString(trackId, 'Música');
            if (!library.list().some((entry) => entry.id === safeTrackId))
                throw new Error('Música não encontrada na biblioteca.');
            return playlistService.addTrack(
                requiredString(playlistId, 'Playlist'),
                safeTrackId,
            );
        },
    );
    ipcMain.handle(
        'playlist:remove-track',
        (_event, playlistId: unknown, trackId: unknown) =>
            playlistService.removeTrack(
                requiredString(playlistId, 'Playlist'),
                requiredString(trackId, 'Música'),
            ),
    );
    ipcMain.handle('playlist:play', (_event, id: unknown, mode: unknown) => {
        const safeMode = mode === 'shuffle' ? 'shuffle' : 'order';
        return playPlaylist(requiredString(id, 'Playlist'), safeMode);
    });
    ipcMain.handle('playback:seek', (_event, position: unknown) =>
        engine.seek(finiteNumber(position, 'Posição')),
    );
    ipcMain.handle('playback:set-speed', (_event, speed: unknown) =>
        engine.setSpeed(finiteNumber(speed, 'Velocidade')),
    );
    ipcMain.handle('settings:get', () => ({
        ...readSettings(layout),
        storageRoot: layout.root,
    }));
    ipcMain.handle('settings:update', (_event, value: unknown) => {
        const current = readSettings(layout);
        const next = {
            ...current,
            ...(value && typeof value === 'object' ? value : {}),
        } as AppSettings;
        if (
            next.storageRoot &&
            path.resolve(next.storageRoot) !== layout.root
        ) {
            layout = createStorageLayout(next.storageRoot);
            ensureStorage(layout);
            library = new LibraryService(layout);
            playlistService = new PlaylistService(layout);
            clearLoadedTrack();
            rememberStorageRoot(layout.root);
        }
        writeJson(layout.settings, next);
        return next;
    });
    ipcMain.handle('overlay:show', () => overlayWindow?.showInactive());
    ipcMain.handle('overlay:hide', () => overlayWindow?.hide());
    ipcMain.handle('overlay:set-bounds', (_event, bounds: unknown) => {
        if (!bounds || typeof bounds !== 'object')
            throw new Error('Bounds inválidos.');
        const value = bounds as Record<string, unknown>;
        const numbers = ['x', 'y', 'width', 'height'].map((key) =>
            Number(value[key]),
        );
        if (numbers.some((number) => !Number.isFinite(number)))
            throw new Error('Bounds inválidos.');
        overlayWindow?.setBounds({
            x: numbers[0],
            y: numbers[1],
            width: Math.max(100, numbers[2]),
            height: Math.max(80, numbers[3]),
        });
    });
    ipcMain.handle('storage:choose-directory', async () => {
        const selected = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
        });
        if (selected.canceled || !selected.filePaths[0]) return null;
        const nextRoot = selected.filePaths[0];
        layout = createStorageLayout(nextRoot);
        ensureStorage(layout);
        library = new LibraryService(layout);
        playlistService = new PlaylistService(layout);
        clearLoadedTrack();
        rememberStorageRoot(layout.root);
        writeJson(layout.settings, {
            ...readSettings(layout),
            storageRoot: nextRoot,
        });
        return nextRoot;
    });
}

app.whenReady().then(() => {
    const defaultLayout = createStorageLayout(defaultStorageRoot());
    const storedRoot = readSettings(defaultLayout).storageRoot;
    layout = createStorageLayout(storedRoot || defaultLayout.root);
    ensureStorage(layout);
    const settings = readSettings(layout);
    if (!settings.legacyMigrationDone && layout.root === defaultLayout.root) {
        migrateLegacy(
            path.resolve(__dirname, '..', '..', 'midi-cache'),
            layout,
        );
        writeJson(layout.settings, {
            ...settings,
            legacyMigrationDone: true,
        });
    }
    library = new LibraryService(layout);
    playlistService = new PlaylistService(layout);
    setupIpc();
    engine.onStateChange((state) => {
        broadcast('playback:state', state);
        if (state.status === 'ended') advanceQueue();
    });
    engine.onEvent((event, index) =>
        broadcast('playback:event', { event, index }),
    );
    globalShortcut.register('F11', () => {
        if (overlayWindow?.isVisible()) overlayWindow.hide();
        else overlayWindow?.showInactive();
    });
    globalShortcut.register('Home', () => {
        cancelPendingStart();
        engine.pause();
    });
    globalShortcut.register('End', () => {
        cancelPendingStart();
        engine.stop();
    });
    createWindows();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
