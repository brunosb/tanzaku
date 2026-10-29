import { formatTime } from '@/shared/lib/format-time'
import type { PlaybackContext } from '../model/context'
import { activeIndices, positionAt } from './roll-model'

export const KEY_GROUPS = [
    { label: 'Tom baixo', keys: ['Z', 'X', 'C', 'V', 'B', 'N', 'M'] },
    { label: 'Tom médio', keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J'] },
    { label: 'Tom alto', keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U'] },
]

// React owns the container. This controller exclusively owns the notes and
// frame-level updates; native playback remains the only musical clock.
export function mountPiano(root: HTMLElement, runtime: PlaybackContext) {
    let notes: HTMLElement[][] = [],
        previousIndex = 0,
        version = -1
    let previousActive = new Set<number>(),
        previousLanes = new Map<string, string>()
    let frame = 0,
        disposed = false,
        viewportWidth = 0
    const scroll = root.querySelector<HTMLElement>('.roll-scroll')!
    const content = root.querySelector<HTMLElement>('.roll-content')!
    const cursors = [...root.querySelectorAll<HTMLElement>('.roll-cursor')]
    const labels = new Map(
        [...root.querySelectorAll<HTMLElement>('.lane-row')].map((row) => [
            row.dataset.lane!,
            row.querySelector<HTMLElement>('.lane-label')!,
        ]),
    )
    const tracks = new Map(
        [...root.querySelectorAll<HTMLElement>('.lane-track')].map((track) => [
            track.dataset.track!,
            track,
        ]),
    )
    const fit = () => {
        viewportWidth = scroll.clientWidth
        const headings = [
            ...content.querySelectorAll<HTMLElement>('.group-heading'),
        ].reduce(
            (height, heading) =>
                height + heading.getBoundingClientRect().height,
            0,
        )
        const laneCount = KEY_GROUPS.reduce(
            (count, group) => count + group.keys.length,
            0,
        )
        // clientHeight excludes the horizontal scrollbar; reserve group borders and rounding.
        const height = Math.max(
            14,
            Math.min(
                24,
                Math.floor((scroll.clientHeight - headings - 4) / laneCount),
            ),
        )
        root.style.setProperty('--lane-height', `${height}px`)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(scroll)
    fit()
    const draw = () => {
        frame = 0
        if (disposed) return
        const state = runtime.playback.get(),
            plan = runtime.playback.meta().plan
        const position = positionAt(
            state,
            runtime.playback.receivedAt(),
            performance.now(),
        )
        const left = position * 120
        for (const cursor of cursors)
            cursor.style.transform = `translateX(${left}px)`
        for (
            let i = Math.min(previousIndex, state.currentEventIndex);
            i < Math.max(previousIndex, state.currentEventIndex);
            i++
        ) {
            for (const note of notes[i] ?? [])
                note.classList.toggle('played', i < state.currentEventIndex)
        }
        previousIndex = state.currentEventIndex
        const active = activeIndices(state, plan, position)
        for (const i of previousActive)
            if (!active.has(i))
                for (const note of notes[i] ?? [])
                    note.classList.remove('current')
        for (const i of active)
            if (!previousActive.has(i))
                for (const note of notes[i] ?? []) note.classList.add('current')
        previousActive = active
        const lanes = new Map<string, string>()
        for (const i of active)
            for (const key of plan.events[i]?.keys ?? [])
                lanes.set(key.name, key.modifier ?? 'natural')
        for (const [name, modifier] of previousLanes)
            if (lanes.get(name) !== modifier)
                labels.get(name)?.classList.remove('current', 'shift', 'ctrl')
        for (const [name, modifier] of lanes)
            if (previousLanes.get(name) !== modifier) {
                labels.get(name)?.classList.add('current')
                if (modifier !== 'natural')
                    labels.get(name)?.classList.add(modifier)
            }
        previousLanes = lanes
        if (state.status === 'playing') {
            const target = Math.max(0, left - viewportWidth * 0.45)
            if (Math.abs(target - scroll.scrollLeft) > 0.5)
                scroll.scrollLeft = target
            if (!document.hidden) request()
        } else if (
            (state.status === 'stopped' || state.status === 'idle') &&
            state.position === 0
        )
            scroll.scrollLeft = 0
    }
    const request = () => {
        if (!frame && !disposed) frame = requestAnimationFrame(draw)
    }
    const build = () => {
        const meta = runtime.playback.meta()
        if (meta.version === version) return
        version = meta.version
        for (const label of labels.values())
            label.classList.remove('current', 'shift', 'ctrl')
        notes = []
        previousIndex = 0
        previousActive.clear()
        previousLanes.clear()
        const width = `${Math.max(900, meta.plan.duration * 120)}px`
        content.style.width = width
        const fragments = new Map(
            [...tracks.keys()].map((key) => [
                key,
                document.createDocumentFragment(),
            ]),
        )
        meta.plan.events.forEach((event, i) => {
            for (const key of event.keys) {
                const fragment = fragments.get(key.name)
                if (!fragment) continue
                const note = document.createElement('span')
                note.className = `note ${key.modifier ?? 'natural'}`
                note.dataset.index = String(i)
                note.textContent = key.label
                note.title = `${key.label} · ${formatTime(event.time)} · ${event.hold.toFixed(2)}s`
                note.style.left = `${event.time * 120}px`
                note.style.width = `${event.hold * 120}px`
                fragment.append(note)
                ;(notes[i] ??= []).push(note)
            }
        })
        for (const [key, track] of tracks) {
            track.style.width = width
            track.replaceChildren(fragments.get(key)!)
        }
        request()
    }
    const unmeta = runtime.playback.subscribeMeta(build),
        unstate = runtime.playback.subscribe(request)
    const visibility = () => {
        if (document.hidden) {
            cancelAnimationFrame(frame)
            frame = 0
        } else request()
    }
    document.addEventListener('visibilitychange', visibility)
    build()
    return () => {
        disposed = true
        cancelAnimationFrame(frame)
        observer.disconnect()
        unmeta()
        unstate()
        document.removeEventListener('visibilitychange', visibility)
    }
}
