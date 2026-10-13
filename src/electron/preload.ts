import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('wwm', {
    window: {
        minimize: () => invoke('window:minimize'),
        toggleMaximize: () => invoke('window:toggle-maximize'),
        close: () => invoke('window:close'),
    },
    library: {
        list: () => invoke('library:list'),
        open: (id: string) => invoke('library:open', id),
        rename: (id: string, title: string) =>
            invoke('library:rename', id, title),
        remove: (id: string) => invoke('library:delete', id),
        import: () => invoke('library:import'),
        addYoutube: (url: string) => invoke('library:add-youtube', url),
    },
    playback: {
        load: (id: string) => invoke('playback:load', id),
        play: () => invoke('playback:play'),
        pause: () => invoke('playback:pause'),
        stop: () => invoke('playback:stop'),
        seek: (position: number) => invoke('playback:seek', position),
        setSpeed: (speed: number) => invoke('playback:set-speed', speed),
        toggleRepeat: () => invoke('playback:toggle-repeat'),
        onState: (listener: (state: unknown) => void) => {
            const callback = (
                _event: Electron.IpcRendererEvent,
                state: unknown,
            ) => listener(state);
            ipcRenderer.on('playback:state', callback);
            return () => ipcRenderer.removeListener('playback:state', callback);
        },
        onEvent: (listener: (event: unknown) => void) => {
            const callback = (
                _event: Electron.IpcRendererEvent,
                event: unknown,
            ) => listener(event);
            ipcRenderer.on('playback:event', callback);
            return () => ipcRenderer.removeListener('playback:event', callback);
        },
        onPlan: (listener: (plan: unknown) => void) => {
            const callback = (
                _event: Electron.IpcRendererEvent,
                plan: unknown,
            ) => listener(plan);
            ipcRenderer.on('playback:plan', callback);
            return () => ipcRenderer.removeListener('playback:plan', callback);
        },
        onCountdown: (listener: (countdown: unknown) => void) => {
            const callback = (
                _event: Electron.IpcRendererEvent,
                countdown: unknown,
            ) => listener(countdown);
            ipcRenderer.on('playback:countdown', callback);
            return () =>
                ipcRenderer.removeListener('playback:countdown', callback);
        },
    },
    playlists: {
        list: () => invoke('playlist:list'),
        create: (name: string) => invoke('playlist:create', name),
        rename: (id: string, name: string) =>
            invoke('playlist:rename', id, name),
        remove: (id: string) => invoke('playlist:delete', id),
        add: (playlistId: string, trackId: string) =>
            invoke('playlist:add', playlistId, trackId),
        removeTrack: (playlistId: string, trackId: string) =>
            invoke('playlist:remove-track', playlistId, trackId),
        play: (id: string, mode: 'order' | 'shuffle') =>
            invoke('playlist:play', id, mode),
    },
    onTrack: (listener: (track: unknown) => void) => {
        const callback = (_event: Electron.IpcRendererEvent, track: unknown) =>
            listener(track);
        ipcRenderer.on('playback:track', callback);
        return () => ipcRenderer.removeListener('playback:track', callback);
    },
    onYoutubeProgress: (listener: (progress: unknown) => void) => {
        const callback = (
            _event: Electron.IpcRendererEvent,
            progress: unknown,
        ) => listener(progress);
        ipcRenderer.on('youtube:progress', callback);
        return () => ipcRenderer.removeListener('youtube:progress', callback);
    },
    settings: {
        get: () => invoke('settings:get'),
        update: (settings: unknown) => invoke('settings:update', settings),
    },
    overlay: {
        show: () => invoke('overlay:show'),
        hide: () => invoke('overlay:hide'),
        setBounds: (bounds: {
            x: number;
            y: number;
            width: number;
            height: number;
        }) => invoke('overlay:set-bounds', bounds),
    },
    storage: {
        chooseDirectory: () => invoke('storage:choose-directory'),
    },
});
