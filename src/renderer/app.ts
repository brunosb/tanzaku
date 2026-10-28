import {
    initialState,
    type LibraryEntry,
    type PlaybackPlan,
    type PlaybackState,
    type Playlist,
} from './api.js'
import { activeIndices, positionAt } from './roll-model.js'

const PX_PER_SECOND = 120
const KEY_GROUPS = [
    { label: 'Tom baixo', keys: ['Z', 'X', 'C', 'V', 'B', 'N', 'M'] },
    { label: 'Tom médio', keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J'] },
    { label: 'Tom alto', keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U'] },
]
const app = document.querySelector<HTMLElement>('#app')!
let currentPlan: PlaybackPlan | null = null
let currentState: PlaybackState = initialState()
let stateReceivedAt = performance.now()
let libraryEntries: LibraryEntry[] = []
let modalGeneration = 0
let selectedId = ''
let selectedTitle = 'Selecione uma música'
let playlists: Playlist[] = []
let selectedPlaylistId = ''
let repeatEnabled = false
let inputModalMode:
    | 'playlist'
    | 'youtube'
    | 'rename-playlist'
    | 'rename-midi'
    | null = null
let inputModalTarget = ''
let youtubeProgress: string | null = null
let seeking = false
let seekPreview: number | null = null
let resumeAfterSeek = false
let countdownRemaining: number | null = null
let framePending = false

function rollMarkup(): string {
    return `
        <div class="roll-scroll" id="roll-scroll">
            <div class="roll-content" id="roll-content">
                ${KEY_GROUPS.map(
                    (group) => `
                        <section class="roll-group">
                            <div class="group-heading">${group.label}</div>
                            <div class="timeline-surface">
                                ${group.keys
                                    .map(
                                        (key) => `
                                            <div class="lane-row" data-lane="${key}">
                                                <div class="lane-label">${key}</div>
                                                <div class="lane-track" data-track="${key}"></div>
                                            </div>`,
                                    )
                                    .join('')}
                                <div class="roll-cursor" id="cursor-${group.keys[0]}"></div>
                            </div>
                        </section>`,
                ).join('')}
            </div>
        </div>`
}

function renderShell(): void {
    app.innerHTML = `
        <div class="desktop-shell">
            <header class="window-chrome">
                <div class="window-drag" data-tauri-drag-region><span class="window-mark" data-tauri-drag-region>T</span><span data-tauri-drag-region>Tanzaku</span></div>
                <div class="window-actions">
                    <button class="window-action" id="window-minimize" title="Minimizar">−</button>
                    <button class="window-action" id="window-maximize" title="Maximizar">□</button>
                    <button class="window-action close" id="window-close" title="Fechar">×</button>
                </div>
            </header>
        <div class="app-shell">
            <aside class="sidebar">
                <div class="brand"><span class="brand-mark">T</span><div><strong>Tanzaku</strong><small>Music workspace</small></div></div>
                <div class="sidebar-heading"><span>Sua biblioteca</span><div class="sidebar-actions"><button class="icon-button" id="youtube-import" title="Adicionar pelo YouTube">🔗</button><button class="icon-button" id="import" title="Importar MIDI">＋</button></div></div>
                <div id="library" class="library-list"><div class="empty-state">Carregando biblioteca...</div></div>
                <div class="sidebar-heading playlist-heading"><span>Playlists</span><button class="icon-button" id="playlist-create" title="Criar playlist">＋</button></div>
                <div id="playlists" class="playlist-list"><div class="empty-state">Nenhuma playlist</div></div>
                <div id="playlist-details" class="playlist-details"></div>
                <div class="sidebar-footer"><button class="secondary-button" id="folder">⚙ Armazenamento</button><span id="folder-name"></span></div>
            </aside>
            <main class="main-content">
                <header class="topbar"><div><span class="eyebrow">AGORA TOCANDO</span><h1 id="selected">${selectedTitle}</h1></div><span class="status-pill" id="status">Pronto</span></header>
                <section class="roll-card">
                    <div class="roll-toolbar"><div><strong>Piano roll</strong><small id="plan-summary">Selecione um MIDI para visualizar</small></div><div class="legend"><span><i class="legend-dot natural"></i>Natural</span><span><i class="legend-dot shift"></i>SHIFT</span><span><i class="legend-dot ctrl"></i>CTRL</span></div></div>
                    ${rollMarkup()}
                </section>
            </main>
        </div>
        <footer class="transport-bar">
            <div class="transport-actions"><button class="transport-button primary" id="play-toggle" title="Reproduzir" aria-label="Reproduzir">▶</button><button class="transport-button" id="stop" title="Parar" aria-label="Parar">■</button><button class="transport-button repeat" id="repeat-toggle" title="Repetir música" aria-label="Repetir música">↻</button></div>
            <div class="timeline-control"><span id="position">00:00</span><input id="seek" type="range" min="0" max="0" step="0.01" value="0"><span id="duration">00:00</span></div>
            <label class="speed-control">Velocidade<select id="speed"><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1" selected>1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></label>
        </footer>
        <div class="input-modal" id="input-modal" hidden>
            <div class="input-modal-card">
                <h2 id="input-modal-title">Nova playlist</h2>
                <p id="input-modal-description">Escolha um nome para a playlist.</p>
                <input id="input-modal-value" type="text" autocomplete="off">
                <small id="input-modal-progress"></small>
                <div class="input-modal-actions"><button class="secondary-button" id="input-modal-cancel">Cancelar</button><button class="primary-button" id="input-modal-submit">Continuar</button></div>
            </div>
        </div>
        <div class="action-menu" id="action-menu" hidden></div>
        </div>`
}

function formatTime(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds))
    const hours = Math.floor(safe / 3600)
    const minutes = Math.floor((safe % 3600) / 60)
    const remaining = safe % 60
    if (hours > 0)
        return `${hours.toString().padStart(2, '0')}:${minutes
            .toString()
            .padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`
    return `${minutes.toString().padStart(2, '0')}:${remaining
        .toString()
        .padStart(2, '0')}`
}

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>'"]/g,
        (character) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;',
            })[character] ?? character,
    )
}

function statusLabel(status: string): string {
    return (
        {
            idle: 'Pronto',
            loading: 'Carregando',
            countdown: 'Preparando',
            playing: 'Tocando',
            paused: 'Pausado',
            stopped: 'Parado',
            ended: 'Concluído',
        }[status] ?? status
    )
}

function showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const target = document.querySelector<HTMLElement>('#status')
    if (target) {
        target.textContent = 'Erro'
        target.title = message
    }
    console.error(message)
    window.alert(message)
}

function renderLibrary(entries: LibraryEntry[]): void {
    libraryEntries = entries
    const target = document.querySelector('#library')
    if (!target) return
    if (!entries.length) {
        target.innerHTML =
            '<div class="empty-state">Nenhum MIDI ainda.<br>Importe uma música para começar.</div>'
        return
    }
    target.innerHTML = entries
        .map(
            (entry) =>
                `<div class="song-row"><button class="song ${entry.id === selectedId ? 'active' : ''}" data-id="${escapeHtml(entry.id)}"><span class="song-icon">♫</span><span class="song-copy"><strong>${escapeHtml(entry.title)}</strong><small>MIDI local</small></span></button><button class="song-add" data-track-id="${escapeHtml(entry.id)}" title="Adicionar à playlist">＋</button><button class="song-options" data-song-action="menu" data-track-id="${escapeHtml(entry.id)}" title="Opções da música">⋯</button></div>`,
        )
        .join('')
    target
        .querySelectorAll<HTMLButtonElement>('.song')
        .forEach((button) =>
            button.addEventListener(
                'click',
                () => void openSong(button.dataset.id ?? ''),
            ),
        )
    target
        .querySelectorAll<HTMLButtonElement>('.song-add')
        .forEach((button) =>
            button.addEventListener(
                'click',
                () => void addTrackToPlaylist(button.dataset.trackId ?? ''),
            ),
        )
    target
        .querySelectorAll<HTMLButtonElement>('.song-options')
        .forEach((button) =>
            button.addEventListener('click', (event) => {
                event.stopPropagation()
                openSongMenu(button.dataset.trackId ?? '', button)
            }),
        )
}

function renderPlaylists(entries: Playlist[]): void {
    playlists = entries
    const target = document.querySelector('#playlists')
    if (!target) return
    if (!entries.length) {
        target.innerHTML =
            '<div class="empty-state compact">Crie uma playlist para organizar suas músicas.</div>'
        renderPlaylistDetails()
        return
    }
    target.innerHTML = entries
        .map(
            (playlist) => `
                <div class="playlist-row ${playlist.id === selectedPlaylistId ? 'active' : ''}">
                    <button class="playlist-select" data-playlist-id="${escapeHtml(playlist.id)}" title="Selecionar playlist"><span class="playlist-icon">♫</span><span><strong>${escapeHtml(playlist.name)}</strong><small>${playlist.trackIds.length} músicas</small></span></button>
                    <button class="playlist-action" data-playlist-action="play" data-playlist-id="${escapeHtml(playlist.id)}" title="Tocar em ordem">▶</button>
                    <button class="playlist-action" data-playlist-action="shuffle" data-playlist-id="${escapeHtml(playlist.id)}" title="Tocar aleatoriamente">🔀</button>
                    <button class="playlist-action" data-playlist-action="rename" data-playlist-id="${escapeHtml(playlist.id)}" title="Renomear playlist">✎</button>
                    <button class="playlist-action danger" data-playlist-action="delete" data-playlist-id="${escapeHtml(playlist.id)}" title="Excluir playlist">×</button>
                </div>`,
        )
        .join('')
    target
        .querySelectorAll<HTMLButtonElement>('.playlist-select')
        .forEach((button) =>
            button.addEventListener('click', () => {
                selectedPlaylistId = button.dataset.playlistId ?? ''
                renderPlaylists(playlists)
                renderPlaylistDetails()
            }),
        )
    target
        .querySelectorAll<HTMLButtonElement>('.playlist-action')
        .forEach((button) =>
            button.addEventListener(
                'click',
                () =>
                    void handlePlaylistAction(
                        button.dataset.playlistId ?? '',
                        button.dataset.playlistAction ?? '',
                    ),
            ),
        )
    renderPlaylistDetails()
}

function renderPlaylistDetails(): void {
    const target = document.querySelector<HTMLElement>('#playlist-details')
    if (!target) return
    const playlist = playlists.find((item) => item.id === selectedPlaylistId)
    if (!playlist) {
        target.innerHTML = ''
        return
    }
    const entries = libraryEntries
    const tracks = playlist.trackIds
        .map((id: string) =>
            entries.find((entry: LibraryEntry) => entry.id === id),
        )
        .filter((entry): entry is LibraryEntry => entry !== undefined)
    target.innerHTML = `
        <div class="playlist-details-heading"><strong>${escapeHtml(playlist.name)}</strong><small>${tracks.length} músicas</small></div>
        <div class="playlist-track-list">
            ${tracks.length ? tracks.map((entry: LibraryEntry) => `<div class="playlist-track"><span title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</span><button class="playlist-track-remove" data-playlist-id="${escapeHtml(playlist.id)}" data-track-id="${escapeHtml(entry.id)}" title="Remover da playlist">×</button></div>`).join('') : '<div class="empty-state compact">Nenhuma música nesta playlist.<br>Use ＋ na biblioteca para adicionar.</div>'}
        </div>`
    target
        .querySelectorAll<HTMLButtonElement>('.playlist-track-remove')
        .forEach((button) =>
            button.addEventListener(
                'click',
                () =>
                    void removeTrackFromPlaylist(
                        button.dataset.playlistId ?? '',
                        button.dataset.trackId ?? '',
                    ),
            ),
        )
}

async function removeTrackFromPlaylist(
    playlistId: string,
    trackId: string,
): Promise<void> {
    try {
        const playlist = await window.tanzaku.playlists.removeTrack(
            playlistId,
            trackId,
        )
        playlists = playlists.map((item) =>
            item.id === playlist.id ? playlist : item,
        )
        renderPlaylists(playlists)
    } catch (error) {
        showError(error)
    }
}

async function handleLibraryAction(
    trackId: string,
    action: string,
): Promise<void> {
    if (!trackId) return
    const entries = libraryEntries
    const entry = entries.find((item) => item.id === trackId)
    if (!entry) return
    if (action === 'delete') {
        if (!window.confirm(`Excluir “${entry.title}” e o arquivo MIDI?`))
            return
        try {
            await window.tanzaku.library.remove(trackId)
            renderLibrary(await window.tanzaku.library.list())
            renderPlaylists(await window.tanzaku.playlists.list())
        } catch (error) {
            showError(error)
        }
    }
}

function closeActionMenu(): void {
    const menu = document.querySelector<HTMLElement>('#action-menu')
    if (menu) menu.hidden = true
}

function openSongMenu(trackId: string, anchor: HTMLElement): void {
    const entries = libraryEntries
    const entry = entries.find((item) => item.id === trackId)
    const menu = document.querySelector<HTMLElement>('#action-menu')
    if (!entry || !menu) return
    menu.innerHTML = `
        <strong>${escapeHtml(entry.title)}</strong>
        <button data-menu-action="rename">✎ Renomear</button>
        <button data-menu-action="delete" class="danger">× Excluir</button>`
    const bounds = anchor.getBoundingClientRect()
    menu.hidden = false
    menu.style.left = `${Math.max(8, bounds.right - 160)}px`
    menu.style.top = `${Math.min(window.innerHeight - 104, bounds.bottom + 4)}px`
    menu.querySelector('[data-menu-action="rename"]')?.addEventListener(
        'click',
        () => {
            closeActionMenu()
            openInputModal('rename-midi', trackId)
        },
    )
    menu.querySelector('[data-menu-action="delete"]')?.addEventListener(
        'click',
        () => {
            closeActionMenu()
            void handleLibraryAction(trackId, 'delete')
        },
    )
}

async function addTrackToPlaylist(trackId: string): Promise<void> {
    if (!selectedPlaylistId) {
        showError(
            new Error('Selecione uma playlist antes de adicionar a música.'),
        )
        return
    }
    try {
        const playlist = await window.tanzaku.playlists.add(
            selectedPlaylistId,
            trackId,
        )
        playlists = playlists.map((item) =>
            item.id === playlist.id ? playlist : item,
        )
        renderPlaylists(playlists)
    } catch (error) {
        showError(error)
    }
}

async function handlePlaylistAction(
    playlistId: string,
    action: string,
): Promise<void> {
    try {
        if (action === 'delete') {
            if (!window.confirm('Excluir esta playlist?')) return
            await window.tanzaku.playlists.remove(playlistId)
            if (selectedPlaylistId === playlistId) selectedPlaylistId = ''
            renderPlaylists(await window.tanzaku.playlists.list())
            return
        }
        if (action === 'rename') {
            openInputModal('rename-playlist', playlistId)
            return
        }
        selectedPlaylistId = playlistId
        renderPlaylists(playlists)
        await window.tanzaku.playlists.play(
            playlistId,
            action === 'shuffle' ? 'shuffle' : 'order',
        )
    } catch (error) {
        showError(error)
    }
}

function openInputModal(
    mode: 'playlist' | 'youtube' | 'rename-playlist' | 'rename-midi',
    targetId = '',
): void {
    modalGeneration++
    inputModalMode = mode
    inputModalTarget = targetId
    const modal = document.querySelector<HTMLElement>('#input-modal')
    const title = document.querySelector('#input-modal-title')
    const description = document.querySelector('#input-modal-description')
    const input = document.querySelector<HTMLInputElement>('#input-modal-value')
    const submit = document.querySelector<HTMLButtonElement>(
        '#input-modal-submit',
    )
    const progress = document.querySelector('#input-modal-progress')
    if (!modal || !title || !description || !input || !submit || !progress)
        return
    title.textContent =
        mode === 'playlist'
            ? 'Nova playlist'
            : mode === 'youtube'
              ? 'Adicionar do YouTube'
              : mode === 'rename-playlist'
                ? 'Renomear playlist'
                : 'Renomear MIDI'
    description.textContent =
        mode === 'playlist' ||
        mode === 'rename-playlist' ||
        mode === 'rename-midi'
            ? 'Informe o novo nome.'
            : 'Cole a URL de um vídeo individual do YouTube.'
    input.placeholder =
        mode === 'playlist' || mode === 'rename-playlist'
            ? 'Nome da playlist'
            : mode === 'rename-midi'
              ? 'Nome do MIDI'
              : 'https://youtube.com/watch?v=...'
    const currentName =
        mode === 'rename-playlist'
            ? (playlists.find((playlist) => playlist.id === targetId)?.name ??
              '')
            : mode === 'rename-midi'
              ? (libraryEntries.find(
                    (entry: LibraryEntry) => entry.id === targetId,
                )?.title ?? '')
              : ''
    input.value = currentName
    if (currentName) input.select()
    progress.textContent = ''
    submit.textContent =
        mode === 'playlist'
            ? 'Criar'
            : mode === 'youtube'
              ? 'Converter'
              : 'Salvar'
    submit.disabled = false
    modal.hidden = false
    input.focus()
}

function closeInputModal(): void {
    modalGeneration++
    if (inputModalMode === 'youtube')
        void window.tanzaku.library.cancelYoutube().catch(showError)
    inputModalMode = null
    inputModalTarget = ''
    youtubeProgress = null
    const modal = document.querySelector<HTMLElement>('#input-modal')
    if (modal) modal.hidden = true
    requestRender()
}

async function submitInputModal(): Promise<void> {
    const input = document.querySelector<HTMLInputElement>('#input-modal-value')
    const submit = document.querySelector<HTMLButtonElement>(
        '#input-modal-submit',
    )
    const progress = document.querySelector<HTMLElement>(
        '#input-modal-progress',
    )
    const value = input?.value.trim() ?? ''
    if (!inputModalMode || !value || !submit || submit.disabled) return
    const generation = modalGeneration
    submit.disabled = true
    try {
        if (inputModalMode === 'playlist') {
            const playlist = await window.tanzaku.playlists.create(value)
            selectedPlaylistId = playlist.id
            renderPlaylists(await window.tanzaku.playlists.list())
        } else if (inputModalMode === 'youtube') {
            const entry = await window.tanzaku.library.addYoutube(value)
            renderLibrary(await window.tanzaku.library.list())
            if (generation !== modalGeneration) return
            if (progress) progress.textContent = `Salvo: ${entry.title}`
        } else if (inputModalMode === 'rename-playlist') {
            await window.tanzaku.playlists.rename(inputModalTarget, value)
            renderPlaylists(await window.tanzaku.playlists.list())
        } else if (inputModalMode === 'rename-midi') {
            const entry = await window.tanzaku.library.rename(
                inputModalTarget,
                value,
            )
            renderLibrary(await window.tanzaku.library.list())
            if (selectedId === entry.id) {
                selectedTitle = entry.title
                const title = document.querySelector('#selected')
                if (title) title.textContent = selectedTitle
            }
        }
        if (generation === modalGeneration) closeInputModal()
    } catch (error) {
        if (generation !== modalGeneration) return
        showError(error)
        submit.disabled = false
        if (progress) progress.textContent = 'Não foi possível concluir.'
    }
}

async function openSong(id: string): Promise<void> {
    if (!id) return
    try {
        await window.tanzaku.playback.load(id)
    } catch (error) {
        showError(error)
    }
}

let noteElements: HTMLElement[][] = []
let previousEventIndex = 0
let previousActive = new Set<number>()
let cursors: HTMLElement[] = []
let scrolls: HTMLElement[] = []
const viewportWidths = new Map<HTMLElement, number>()
const viewportObserver = new ResizeObserver((entries) => {
    for (const entry of entries)
        viewportWidths.set(entry.target as HTMLElement, entry.contentRect.width)
})
let laneLabels = new Map<string, HTMLElement>()
let previousLanes = new Map<string, string>()
function renderPlan(plan: PlaybackPlan): void {
    for (const name of previousLanes.keys())
        laneLabels.get(name)?.classList.remove('current', 'shift', 'ctrl')
    previousLanes.clear()
    laneLabels = new Map(
        Array.from(document.querySelectorAll<HTMLElement>('.lane-row')).map(
            (row) => [
                row.dataset.lane ?? '',
                row.querySelector<HTMLElement>('.lane-label')!,
            ],
        ),
    )
    noteElements = []
    previousEventIndex = 0
    previousActive = new Set()
    cursors = Array.from(document.querySelectorAll<HTMLElement>('.roll-cursor'))
    scrolls = Array.from(document.querySelectorAll<HTMLElement>('.roll-scroll'))
    viewportObserver.disconnect()
    viewportWidths.clear()
    for (const scroll of scrolls) {
        viewportWidths.set(scroll, scroll.clientWidth)
        viewportObserver.observe(scroll)
    }
    currentPlan = plan
    const width = Math.max(900, plan.duration * PX_PER_SECOND)
    const content = document.querySelector<HTMLElement>('#roll-content')
    if (content) content.style.width = `${width}px`
    document.querySelectorAll<HTMLElement>('.lane-track').forEach((track) => {
        track.innerHTML = ''
        track.style.width = `${width}px`
    })
    plan.events.forEach((event, index) => {
        for (const key of event.keys) {
            const track = document.querySelector<HTMLElement>(
                `.lane-track[data-track="${CSS.escape(key.name)}"]`,
            )
            if (!track) return
            const note = document.createElement('span')
            note.className = `note ${key.modifier ?? 'natural'}`
            note.dataset.index = String(index)
            note.textContent = key.label
            note.title = `${key.label} · ${formatTime(event.time)} · ${event.hold.toFixed(2)}s`
            note.style.left = `${event.time * PX_PER_SECOND}px`
            note.style.width = `${event.hold * PX_PER_SECOND}px`
            track.append(note)
            ;(noteElements[index] ??= []).push(note)
        }
    })
    const summary = document.querySelector('#plan-summary')
    if (summary)
        summary.textContent = `${plan.events.length} eventos · ${formatTime(plan.duration)}`
    requestRender()
}

function renderFrame(): void {
    framePending = false
    const visualPosition =
        seekPreview ??
        positionAt(currentState, stateReceivedAt, performance.now())
    const duration = Math.max(0.001, currentState.duration)
    const cursorLeft = visualPosition * PX_PER_SECOND
    cursors.forEach((cursor) => {
        cursor.style.transform = `translateX(${cursorLeft}px)`
    })
    const nextIndex = currentState.currentEventIndex
    for (
        let index = Math.min(previousEventIndex, nextIndex);
        index < Math.max(previousEventIndex, nextIndex);
        index++
    ) {
        for (const note of noteElements[index] ?? [])
            note.classList.toggle('played', index < nextIndex)
    }
    previousEventIndex = nextIndex
    const active = activeIndices(currentState, currentPlan, visualPosition)
    for (const index of previousActive)
        if (!active.has(index))
            for (const note of noteElements[index] ?? [])
                note.classList.remove('current')
    for (const index of active)
        if (!previousActive.has(index))
            for (const note of noteElements[index] ?? [])
                note.classList.add('current')
    previousActive = active
    const lanes = new Map<string, string>()
    for (const index of active)
        for (const key of currentPlan?.events[index]?.keys ?? [])
            lanes.set(key.name, key.modifier ?? 'natural')
    for (const [name, modifier] of previousLanes)
        if (lanes.get(name) !== modifier)
            laneLabels.get(name)?.classList.remove('current', 'shift', 'ctrl')
    for (const [name, modifier] of lanes)
        if (previousLanes.get(name) !== modifier) {
            const label = laneLabels.get(name)
            label?.classList.add('current')
            if (modifier !== 'natural') label?.classList.add(modifier)
        }
    previousLanes = lanes
    const seek = document.querySelector<HTMLInputElement>('#seek')
    if (seek && !seeking) {
        seek.max = String(currentState.duration)
        seek.value = String(Math.min(currentState.duration, visualPosition))
    }
    const position = document.querySelector('#position')
    const durationElement = document.querySelector('#duration')
    if (position) position.textContent = formatTime(visualPosition)
    if (durationElement)
        durationElement.textContent = formatTime(currentState.duration)
    const status = document.querySelector('#status')
    if (status)
        status.textContent =
            youtubeProgress ??
            (countdownRemaining === null
                ? (currentState.error ??
                  (currentState.pauseReason === 'focus-lost'
                      ? 'Pausado: o jogo perdeu o foco'
                      : statusLabel(currentState.status)))
                : `Começa em ${countdownRemaining}s`)
    const playToggle = document.querySelector<HTMLButtonElement>('#play-toggle')
    if (playToggle) {
        const playing = currentState.status === 'playing'
        playToggle.textContent = playing ? 'Ⅱ' : '▶'
        playToggle.title = playing ? 'Pausar' : 'Reproduzir'
        playToggle.disabled =
            countdownRemaining !== null ||
            currentState.status === 'loading' ||
            !currentPlan?.events.length
        playToggle.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir')
    }
    const repeatToggle =
        document.querySelector<HTMLButtonElement>('#repeat-toggle')
    if (repeatToggle) {
        repeatToggle.classList.toggle('active', repeatEnabled)
        repeatToggle.title = repeatEnabled
            ? 'Repetição ativada'
            : 'Repetir música'
        repeatToggle.setAttribute(
            'aria-label',
            repeatEnabled ? 'Desativar repetição' : 'Repetir música',
        )
    }
    const speed = document.querySelector<HTMLSelectElement>('#speed')
    if (speed && document.activeElement !== speed)
        speed.value = String(currentState.speed)

    if (currentState.status === 'playing' && !seeking) {
        scrolls.forEach((scroll) => {
            const target = Math.max(
                0,
                cursorLeft - (viewportWidths.get(scroll) ?? 0) * 0.45,
            )
            if (Math.abs(target - scroll.scrollLeft) > 0.5)
                scroll.scrollLeft = target
        })
    } else if (
        !seeking &&
        (currentState.status === 'stopped' || currentState.status === 'idle') &&
        currentState.position === 0
    ) {
        scrolls.forEach((scroll) => {
            scroll.scrollLeft = 0
        })
    }
    void duration
    if (currentState.status === 'playing' && !document.hidden) requestRender()
}

function requestRender(): void {
    if (framePending) return
    framePending = true
    requestAnimationFrame(renderFrame)
}

function bindControls(): void {
    document
        .querySelector('#action-menu')
        ?.addEventListener('click', (event) => event.stopPropagation())
    window.addEventListener('click', closeActionMenu)
    document
        .querySelector('#window-minimize')
        ?.addEventListener(
            'click',
            () => void window.tanzaku.window.minimize().catch(showError),
        )
    document
        .querySelector('#window-maximize')
        ?.addEventListener(
            'click',
            () => void window.tanzaku.window.toggleMaximize().catch(showError),
        )
    document
        .querySelector('#window-close')
        ?.addEventListener(
            'click',
            () => void window.tanzaku.window.close().catch(showError),
        )
    document.querySelector('#play-toggle')?.addEventListener('click', () => {
        if (currentState.status === 'playing')
            void window.tanzaku.playback.pause().catch(showError)
        else void window.tanzaku.playback.play().catch(showError)
    })
    document
        .querySelector('#stop')
        ?.addEventListener(
            'click',
            () => void window.tanzaku.playback.stop().catch(showError),
        )
    document
        .querySelector('#repeat-toggle')
        ?.addEventListener('click', async () => {
            try {
                await window.tanzaku.playback.toggleRepeat()
            } catch (error) {
                showError(error)
            }
        })
    document
        .querySelector('#playlist-create')
        ?.addEventListener('click', () => openInputModal('playlist'))
    document
        .querySelector('#youtube-import')
        ?.addEventListener('click', () => openInputModal('youtube'))
    document
        .querySelector('#input-modal-cancel')
        ?.addEventListener('click', closeInputModal)
    document
        .querySelector('#input-modal-submit')
        ?.addEventListener('click', () => void submitInputModal())
    document
        .querySelector('#input-modal-value')
        ?.addEventListener('keydown', (event) => {
            const key = (event as KeyboardEvent).key
            if (key === 'Enter') void submitInputModal()
            if (key === 'Escape') closeInputModal()
        })
    document.querySelector('#import')?.addEventListener('click', async () => {
        try {
            const entry = await window.tanzaku.library.import()
            if (entry) renderLibrary(await window.tanzaku.library.list())
        } catch (error) {
            showError(error)
        }
    })
    document.querySelector('#seek')?.addEventListener('pointerdown', () => {
        seeking = true
        seekPreview = currentState.position
        resumeAfterSeek = currentState.status === 'playing'
        if (resumeAfterSeek)
            void window.tanzaku.playback.pause().catch(showError)
    })
    document.querySelector('#seek')?.addEventListener('input', (event) => {
        seekPreview = Number((event.target as HTMLInputElement).value)
        requestRender()
    })
    const commitSeek = (value: number): void => {
        if (
            !seeking &&
            seekPreview === null &&
            (document.activeElement as HTMLElement | null)?.id !== 'seek'
        )
            return
        const shouldResume = resumeAfterSeek
        seeking = false
        seekPreview = null
        resumeAfterSeek = false
        void window.tanzaku.playback.seek(value, shouldResume).catch(showError)
    }
    document.querySelector('#seek')?.addEventListener('change', (event) => {
        commitSeek(Number((event.target as HTMLInputElement).value))
    })
    window.addEventListener('pointerup', () => {
        if (!seeking) return
        const seek = document.querySelector<HTMLInputElement>('#seek')
        if (seek) commitSeek(Number(seek.value))
    })
    document
        .querySelector('#speed')
        ?.addEventListener(
            'change',
            (event) =>
                void window.tanzaku.playback
                    .setSpeed(Number((event.target as HTMLSelectElement).value))
                    .catch(showError),
        )
    document.querySelector('#folder')?.addEventListener('click', async () => {
        try {
            const directory = await window.tanzaku.storage.chooseDirectory()
            if (directory) {
                const target = document.querySelector('#folder-name')
                if (target) target.textContent = directory
                selectedId = ''
                selectedTitle = 'Selecione uma música'
                renderLibrary(await window.tanzaku.library.list())
                renderPlaylists(await window.tanzaku.playlists.list())
                const title = document.querySelector('#selected')
                if (title) title.textContent = selectedTitle
            }
        } catch (error) {
            showError(error)
        }
    })
}

renderShell()
bindControls()
void window.tanzaku.library.list().then(renderLibrary).catch(showError)
void window.tanzaku.playlists.list().then(renderPlaylists).catch(showError)
void window.tanzaku.settings
    .get()
    .then((settings: { storageRoot?: string }) => {
        const target = document.querySelector('#folder-name')
        if (target)
            target.textContent = settings.storageRoot ?? 'Padrão do usuário'
    })
    .catch(showError)
window.tanzaku.onTrack((track) => {
    selectedId = track?.id ?? ''
    selectedTitle = track?.title ?? 'Selecione uma música'
    const title = document.querySelector('#selected')
    if (title) title.textContent = selectedTitle
    document
        .querySelectorAll('.song')
        .forEach((item) =>
            item.classList.toggle(
                'active',
                (item as HTMLElement).dataset.id === selectedId,
            ),
        )
})
window.tanzaku?.playback.onState((state: PlaybackState) => {
    currentState = state
    stateReceivedAt = performance.now()
    repeatEnabled = state.repeatEnabled
    if (state.status === 'playing') countdownRemaining = null
    requestRender()
})
window.tanzaku?.playback.onPlan((plan: PlaybackPlan) => renderPlan(plan))
window.tanzaku?.playback.onCountdown((value: { remaining?: number }) => {
    const remaining = Number(value?.remaining)
    countdownRemaining = remaining > 0 ? remaining : null
    requestRender()
})
window.tanzaku?.onYoutubeProgress(
    (value: { stage?: string; percent?: number }) => {
        const percent = Number(value?.percent)
        youtubeProgress = value?.stage
            ? `${value.stage}${Number.isFinite(percent) && percent > 0 ? ` ${percent.toFixed(0)}%` : ''}`
            : null
        const progress = document.querySelector('#input-modal-progress')
        if (progress) progress.textContent = youtubeProgress ?? ''
        requestRender()
    },
)

document.addEventListener('visibilitychange', requestRender)
window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault()
    showError(event.reason)
})
